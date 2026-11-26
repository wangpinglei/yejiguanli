import { generateId, getDb } from '../db'

type SyncOrderFailureFields = {
  orderId?: string
  customerName?: string
  productName?: string
  salesUnitName?: string
  salesPersonName?: string
  saleDate?: string
}

export type SyncOrderFailureCode =
  | 'invalid_fields'
  | 'missing_required'
  | 'deleted_blocklist'
  | 'db_error'
  | 'upstream_error'

export type SyncFailureSource = 'push' | 'pull'

export type LogSyncOrderFailureInput = {
  reason: string
  code: SyncOrderFailureCode
  source: SyncFailureSource
  raw?: unknown
  order?: SyncOrderFailureFields
}

const MAX_PAYLOAD = 6000

function trimPayload(raw: unknown): string {
  if (raw == null) return ''
  try {
    const s = JSON.stringify(raw)
    return s.length <= MAX_PAYLOAD ? s : `${s.slice(0, MAX_PAYLOAD)}…`
  } catch {
    const s = String(raw)
    return s.length <= MAX_PAYLOAD ? s : `${s.slice(0, MAX_PAYLOAD)}…`
  }
}

export function logSyncOrderFailure(input: LogSyncOrderFailureInput): void {
  const db = getDb()
  const order = input.order || {}
  const externalOrderId =
    (order.orderId && String(order.orderId).trim())
    || ''
  db.prepare(`
    INSERT INTO sync_order_failures (
      id, created_at, source, failure_code, reason,
      external_order_id, customer_name, product_name,
      sales_unit_name, sales_person_name, sale_date, payload_json
    ) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId('sof'),
    input.source,
    input.code,
    input.reason.slice(0, 500),
    externalOrderId,
    order.customerName || '',
    order.productName || '',
    order.salesUnitName || '',
    order.salesPersonName || '',
    order.saleDate || '',
    trimPayload(input.raw),
  )
}

export type SyncOrderFailureRow = {
  id: string
  createdAt: string
  source: string
  failureCode: string
  reason: string
  externalOrderId: string
  customerName: string
  productName: string
  salesUnitName: string
  salesPersonName: string
  saleDate: string
  payloadJson: string
}

export function listSyncOrderFailures(options?: {
  limit?: number
  offset?: number
}): { total: number; items: SyncOrderFailureRow[] } {
  const db = getDb()
  const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200)
  const offset = Math.max(Number(options?.offset) || 0, 0)
  const totalRow = db
    .prepare('SELECT COUNT(*) AS c FROM sync_order_failures')
    .get() as { c: number }
  const rows = db
    .prepare(
      `SELECT * FROM sync_order_failures
       ORDER BY created_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<Record<string, unknown>>

  const items: SyncOrderFailureRow[] = rows.map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at || ''),
    source: String(r.source || ''),
    failureCode: String(r.failure_code || ''),
    reason: String(r.reason || ''),
    externalOrderId: String(r.external_order_id || ''),
    customerName: String(r.customer_name || ''),
    productName: String(r.product_name || ''),
    salesUnitName: String(r.sales_unit_name || ''),
    salesPersonName: String(r.sales_person_name || ''),
    saleDate: String(r.sale_date || ''),
    payloadJson: String(r.payload_json || ''),
  }))

  return { total: Number(totalRow?.c) || 0, items }
}