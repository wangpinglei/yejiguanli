import { createHash } from 'crypto'
import { Router, Request, Response } from 'express'
import { getDb, generateId, rowToSalesRecord, findProductRowByNameOrAlias } from '../db'
import { parsePerformanceSplitText } from '../lib/parsePerformanceSplit'
import { authMiddleware } from '../auth'
import { getVisibleUnitIds, isSalesRowVisible } from '../middleware'

const router = Router()

const API_KEY =
  process.env.SYNC_API_KEY ||
  process.env.BATTLE_REPORT_API_KEY ||
  'eco-sync-2026-secret'

type PlainObj = Record<string, unknown>

interface SyncOrderInput {
  orderId?: string
  customerName: string
  productName: string
  orderAmount: number
  totalAmount: number
  orderType: string
  salesUnitName: string
  salesPersonName: string
  saleDate: string
  activityName: string
  quantity?: number
  unitPrice?: number
  remark?: string
}

function hasValidSyncApiKey(req: Request): boolean {
  const key =
    req.header('X-API-Key') ||
    (typeof req.query.apiKey === 'string' ? req.query.apiKey : '') ||
    ''
  return key === API_KEY
}

function validateApiKey(req: Request, res: Response): boolean {
  if (!hasValidSyncApiKey(req)) {
    res.status(401).json({ success: false, message: 'API Key 无效' })
    return false
  }
  return true
}

function asStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function asNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pickField(raw: PlainObj, ...keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] != null && asStr(raw[key]) !== '') return raw[key]
  }
  // 也支持中文键
  return undefined
}

/**
 * 把外部订单归一化为内部结构
 * 支持英文字段 + 中文字段（客户姓名/购买产品/…）
 */
function normalizeOrder(raw: PlainObj): SyncOrderInput | null {
  const customerName = asStr(
    pickField(raw, 'customerName', 'customer_name', '客户姓名', '客户名称'),
  )
  const productName = asStr(
    pickField(raw, 'productName', 'product_name', '购买产品', '产品名称'),
  )
  const salesUnitName = asStr(
    pickField(raw, 'salesUnitName', 'sales_unit_name', '销售单位'),
  )
  const salesPersonName = asStr(
    pickField(raw, 'salesPersonName', 'sales_person_name', '销售人员', '销售员'),
  )
  const saleDate = asStr(
    pickField(raw, 'saleDate', 'sale_date', 'orderDate', 'order_date', '成交日期'),
  ).slice(0, 10)
  const orderType = asStr(pickField(raw, 'orderType', 'order_type', '订单类型'))
  const activityName = asStr(
    pickField(raw, 'activityName', 'activity_name', '参加活动', '活动'),
  )
  const orderAmount = asNum(
    pickField(raw, 'orderAmount', 'order_amount', '订单金额'),
  )
  const totalAmount = asNum(
    pickField(raw, 'totalAmount', 'total_amount', '实收金额', '实收'),
  )
  const orderId = asStr(
    pickField(raw, 'orderId', 'order_id', 'externalOrderId', '订单号', '订单编号'),
  )

  if (!saleDate && !customerName && !productName) return null

  return {
    orderId: orderId || undefined,
    customerName,
    productName,
    orderAmount,
    totalAmount: totalAmount || orderAmount,
    orderType,
    salesUnitName,
    salesPersonName,
    saleDate: saleDate || new Date().toISOString().slice(0, 10),
    activityName,
    quantity: asNum(pickField(raw, 'quantity', '数量')) || 1,
    unitPrice: asNum(pickField(raw, 'unitPrice', 'unit_price', '单价')),
    remark: asStr(pickField(raw, 'remark', '备注')) || '外部同步',
  }
}

function buildExternalOrderId(order: SyncOrderInput): string {
  if (order.orderId) return order.orderId
  const fp = [
    order.customerName,
    order.productName,
    order.orderAmount.toFixed(2),
    order.totalAmount.toFixed(2),
    order.orderType,
    order.salesUnitName,
    order.salesPersonName,
    order.saleDate,
    order.activityName,
  ]
    .join('|')
    .toLowerCase()
  return 'auto_' + createHash('sha1').update(fp).digest('hex').slice(0, 16)
}

function findUnitId(db: ReturnType<typeof getDb>, name: string): string {
  if (!name) return ''
  const row = db
    .prepare('SELECT id FROM sales_units WHERE name = ? COLLATE NOCASE LIMIT 1')
    .get(name) as { id: string } | undefined
  return row?.id || ''
}

function findPersonnelId(
  db: ReturnType<typeof getDb>,
  name: string,
  unitId: string,
): string {
  if (!name) return ''
  if (unitId) {
    const inUnit = db
      .prepare(
        'SELECT id FROM personnel WHERE name = ? COLLATE NOCASE AND sales_unit_id = ? LIMIT 1',
      )
      .get(name, unitId) as { id: string } | undefined
    if (inUnit?.id) return inUnit.id
  }
  const row = db
    .prepare('SELECT id FROM personnel WHERE name = ? COLLATE NOCASE LIMIT 1')
    .get(name) as { id: string } | undefined
  return row?.id || ''
}

function findOrCreateProductId(
  db: ReturnType<typeof getDb>,
  name: string,
  unitId: string,
): string {
  if (!name) return ''
  const existing = findProductRowByNameOrAlias(db, name) as { id: string } | null
  if (existing?.id) return existing.id

  const id = generateId('prod')
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO products (
      id, name, category, sales_unit_id, unit_price,
      cost_type, unit_cost, cost_rate, description,
      commission_type, commission_rate, commission_amount, commission_note,
      settlement_type, settlement_rate, settlement_amount, settlement_note
    ) VALUES (?, ?, ?, ?, 0, 'percentage', 0, 0, ?, 'percentage', 0, 0, '', 'percentage', 0, 0, '')
  `).run(id, name, '', unitId || null, `同步自动建档 ${now}`)
  return id
}

function upsertSyncedOrder(order: SyncOrderInput): {
  action: 'added' | 'updated' | 'skipped'
  id: string
} {
  const db = getDb()
  const externalOrderId = buildExternalOrderId(order)

  const deleted = db
    .prepare(
      'SELECT external_order_id FROM deleted_synced_orders WHERE external_order_id = ? LIMIT 1',
    )
    .get(externalOrderId) as { external_order_id?: string } | undefined
  if (deleted?.external_order_id) {
    return { action: 'skipped', id: '' }
  }

  const unitId = findUnitId(db, order.salesUnitName)
  const splitJson = parsePerformanceSplitText(
    order.salesPersonName,
    (name) => findUnitId(db, name),
    (name, uId) => findPersonnelId(db, name, uId),
  )
  let collaboratorsJson = ''
  let personnelId = findPersonnelId(db, order.salesPersonName, unitId)
  let recordUnitId = unitId
  if (splitJson) {
    collaboratorsJson = splitJson
    try {
      const parsed = JSON.parse(splitJson) as {
        shares?: Array<{ personnelId?: string; salesUnitId?: string }>
      }
      const first = parsed.shares?.[0]
      if (first?.personnelId) personnelId = first.personnelId
      if (first?.salesUnitId) recordUnitId = first.salesUnitId
    } catch {
      // ignore
    }
  }
  const productId = findOrCreateProductId(db, order.productName, recordUnitId || unitId)
  const qty = order.quantity && order.quantity > 0 ? order.quantity : 1
  const unitPrice =
    order.unitPrice && order.unitPrice > 0
      ? order.unitPrice
      : qty > 0
        ? order.totalAmount / qty
        : order.totalAmount
  const syncedAt = new Date().toISOString()

  const existing = db
    .prepare(
      'SELECT id, collaborators FROM sales_records WHERE external_order_id = ? LIMIT 1',
    )
    .get(externalOrderId) as { id: string; collaborators?: string } | undefined

  // 同步未带分业绩时，保留库里已有的手工分业绩，避免整单被算回主责单位
  const collaboratorsToSave =
    collaboratorsJson
    || (existing?.collaborators ? String(existing.collaborators) : '')

  if (existing?.id) {
    db.prepare(`
      UPDATE sales_records SET
        sales_unit_id=?, personnel_id=?, product_id=?, quantity=?, unit_price=?,
        total_amount=?, sale_date=?, remark=?,
        synced=1, customer_name=?, sales_unit_name=?, sales_person_name=?,
        product_name=?, order_number=?, order_amount=?, order_type=?, activity_name=?,
        collaborators=?
      WHERE id=?
    `).run(
      recordUnitId || unitId,
      personnelId,
      productId,
      qty,
      unitPrice,
      order.totalAmount,
      order.saleDate,
      order.remark || '外部同步',
      order.customerName,
      order.salesUnitName,
      order.salesPersonName,
      order.productName,
      externalOrderId,
      order.orderAmount,
      order.orderType,
      order.activityName,
      collaboratorsToSave,
      existing.id,
    )
    return { action: 'updated', id: existing.id }
  }

  const id = generateId('sr')
  db.prepare(`
    INSERT INTO sales_records (
      id, sales_unit_id, personnel_id, product_id, quantity, unit_price, total_amount, sale_date, remark,
      synced, external_order_id, customer_name, sales_unit_name, sales_person_name, product_name, synced_at,
      order_number, product_module, order_amount, order_type, activity_name, collaborators
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
  `).run(
    id,
    recordUnitId || unitId,
    personnelId,
    productId,
    qty,
    unitPrice,
    order.totalAmount,
    order.saleDate,
    order.remark || '外部同步',
    externalOrderId,
    order.customerName,
    order.salesUnitName,
    order.salesPersonName,
    order.productName,
    syncedAt,
    externalOrderId,
    order.orderAmount,
    order.orderType,
    order.activityName,
    collaboratorsToSave,
  )
  return { action: 'added', id }
}

function parseOrderList(body: unknown): PlainObj[] {
  if (Array.isArray(body)) return body as PlainObj[]
  if (body && typeof body === 'object') {
    const obj = body as PlainObj
    if (Array.isArray(obj.orders)) return obj.orders as PlainObj[]
    if (Array.isArray(obj.data)) return obj.data as PlainObj[]
    return [obj]
  }
  return []
}

/**
 * @description 外部项目推送/同步销售订单到业绩系统销售记录
 * @link POST /api/sync-orders  Header: X-API-Key
 *
 * 字段（中英均可）：
 * 客户姓名、购买产品、订单金额、实收金额、订单类型、销售单位、销售人员、成交日期、参加活动
 * 可选：orderId / 订单号（用于去重更新）
 */
router.post('/sync-orders', (req, res) => {
  if (!validateApiKey(req, res)) return

  const list = parseOrderList(req.body)
  if (!list.length) {
    res.status(400).json({ success: false, message: '订单数据为空' })
    return
  }

  let added = 0
  let updated = 0
  let skipped = 0
  const errors: string[] = []

  for (const raw of list) {
    try {
      const order = normalizeOrder(raw)
      if (!order) {
        skipped++
        errors.push('无法识别的订单字段')
        continue
      }
      if (!order.productName && !order.customerName) {
        skipped++
        errors.push('缺少客户姓名或购买产品')
        continue
      }
      const result = upsertSyncedOrder(order)
      if (result.action === 'added') added++
      else if (result.action === 'updated') updated++
      else skipped++
    } catch (err) {
      skipped++
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  res.json({
    success: true,
    message: `同步完成：新增 ${added} 笔，更新 ${updated} 笔，跳过 ${skipped} 笔`,
    added,
    updated,
    skipped,
    errors: errors.length ? errors : undefined,
  })
})

/**
 * @description 查询已同步的销售记录（synced=1）
 * @link GET /api/synced-orders
 */
router.get('/synced-orders', (req, res, next) => {
  if (hasValidSyncApiKey(req)) return next()
  return authMiddleware(req, res, next)
}, (req, res) => {
  const db = getDb()
  let rows = db
    .prepare(
      'SELECT * FROM sales_records WHERE synced = 1 ORDER BY sale_date DESC, id DESC',
    )
    .all()

  const yearMonth =
    typeof req.query.yearMonth === 'string' ? req.query.yearMonth : ''
  const salesUnitName =
    typeof req.query.salesUnitName === 'string' ? req.query.salesUnitName : ''

  if (yearMonth) {
    rows = rows.filter((r: { sale_date?: string }) =>
      (r.sale_date || '').startsWith(yearMonth),
    )
  }
  if (salesUnitName) {
    rows = rows.filter(
      (r: { sales_unit_name?: string }) => r.sales_unit_name === salesUnitName,
    )
  }

  // 登录用户按可见单位过滤；API Key 调用保持全量（供外部系统核对）
  if (!hasValidSyncApiKey(req) && req.user) {
    const visibleIds = getVisibleUnitIds(req.user)
    if (visibleIds !== null) {
      rows = rows.filter((r: unknown) => isSalesRowVisible(visibleIds, r as object))
    }
  }

  const orders = rows.map((row: unknown) => {
    const s = rowToSalesRecord(row)
    return {
      id: s.id,
      externalOrderId: s.externalOrderId || '',
      synced: true,
      salesUnitId: s.salesUnitId,
      salesUnitName: s.salesUnitName || '',
      personnelId: s.personnelId,
      salesPersonName: s.salesPersonName || '',
      productId: s.productId,
      productName: s.productName || '',
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      totalAmount: s.totalAmount,
      orderAmount: s.orderAmount || 0,
      orderType: s.orderType || '',
      activityName: s.activityName || '',
      saleDate: s.saleDate,
      customerName: s.customerName || '',
      remark: s.remark,
      syncedAt: s.syncedAt || '',
    }
  })

  res.json({ success: true, count: orders.length, orders })
})

/**
 * @description 从外部系统主动拉取并同步到销售记录
 * @link POST /api/sync-orders/pull  Header: X-API-Key
 * 环境变量：SYNC_SOURCE_URL（完整拉取地址）、SYNC_SOURCE_API_KEY（可选）
 */
router.post('/sync-orders/pull', async (req, res) => {
  if (!validateApiKey(req, res)) return

  const sourceUrl = (
    process.env.SYNC_SOURCE_URL ||
    (typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : '') ||
    ''
  ).trim()
  if (!sourceUrl) {
    res.status(400).json({
      success: false,
      message: '未配置 SYNC_SOURCE_URL，且请求未传 sourceUrl',
    })
    return
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    const sourceKey =
      process.env.SYNC_SOURCE_API_KEY ||
      (typeof req.body?.sourceApiKey === 'string' ? req.body.sourceApiKey : '')
    if (sourceKey) headers['X-API-Key'] = sourceKey

    const upstream = await fetch(sourceUrl, { headers })
    if (!upstream.ok) {
      res.status(502).json({
        success: false,
        message: `上游返回 HTTP ${upstream.status}`,
      })
      return
    }
    const data = (await upstream.json()) as unknown
    const list = parseOrderList(data)

    // 复用 POST /sync-orders 逻辑
    req.body = { orders: list }
    // 直接调用处理
    let added = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    for (const raw of list) {
      try {
        const order = normalizeOrder(raw as PlainObj)
        if (!order) {
          skipped++
          continue
        }
        const result = upsertSyncedOrder(order)
        if (result.action === 'added') added++
        else updated++
      } catch (err) {
        skipped++
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    res.json({
      success: true,
      message: `拉取同步完成：新增 ${added} 笔，更新 ${updated} 笔，跳过 ${skipped} 笔`,
      added,
      updated,
      skipped,
      sourceUrl,
      errors: errors.length ? errors : undefined,
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    })
  }
})

export default router
