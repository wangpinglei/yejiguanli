import type { SalesRecord } from '@/types'

export type SaleNameMaps = {
  productNameById: Map<string, string>
  personNameById: Map<string, string>
  unitNameById: Map<string, string>
}

export function buildSaleNameMaps(
  productList: { id: string; name: string }[],
  personList: { id: string; name: string }[],
  unitList: { id: string; name: string }[],
): SaleNameMaps {
  return {
    productNameById: new Map(productList.map((p) => [p.id, p.name || ''])),
    personNameById: new Map(personList.map((p) => [p.id, p.name || ''])),
    unitNameById: new Map(unitList.map((u) => [u.id, u.name || ''])),
  }
}

export function normalizeSaleText(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
}

function isRealYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 两位年份：00–69 为 2000 年代，70–99 为 1900 年代 */
function expandTwoDigitYear(year: number): number {
  if (year >= 100) return year
  return year >= 70 ? 1900 + year : 2000 + year
}

/**
 * 统一为 YYYY-MM-DD。
 * 覆盖未补零的 2026-9-28，以及 Excel 美式短日期被截成 9/28/26 0: 的情况。
 * 截断串按字符串降序会排在所有 2026- 开头的日期前面。
 */
export function normalizeSaleDate(value?: string): string {
  const s = String(value || '').trim()
  if (!s) return ''
  const ymd = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (ymd) {
    const year = Number(ymd[1])
    const month = Number(ymd[2])
    const day = Number(ymd[3])
    if (isRealYmd(year, month, day)) return formatYmd(year, month, day)
  }
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\D|$)/)
  if (mdy) {
    const month = Number(mdy[1])
    const day = Number(mdy[2])
    const year = expandTwoDigitYear(Number(mdy[3]))
    if (isRealYmd(year, month, day)) return formatYmd(year, month, day)
  }
  return s.slice(0, 10)
}

/** 成交日期降序（新在前）；同日再按 id 降序 */
export function compareSaleDateDesc(
  a: { saleDate?: string; id?: string },
  b: { saleDate?: string; id?: string },
): number {
  const dateDiff = normalizeSaleDate(b.saleDate).localeCompare(normalizeSaleDate(a.saleDate))
  if (dateDiff !== 0) return dateDiff
  return String(b.id || '').localeCompare(String(a.id || ''))
}

export function normalizeActivityName(value?: string): string {
  const s = normalizeSaleText(value)
  return !s || s === '无活动' ? '' : s
}

function moneyKey(value?: number): string {
  return Number(value || 0).toFixed(2)
}

/** 列表上能看到的业务字段；不含来源（手动/生态圈） */
export type SaleDuplicateFields = {
  customerName?: string
  productName?: string
  orderAmount?: number
  totalAmount?: number
  orderType?: string
  unitName?: string
  personName?: string
  saleDate?: string
  activityName?: string
}

export function buildSalesDuplicateFingerprint(r: SaleDuplicateFields): string {
  const total = Number(r.totalAmount || 0)
  const order = Number(r.orderAmount || 0) || total
  return [
    normalizeSaleText(r.customerName),
    normalizeSaleText(r.productName),
    moneyKey(order),
    moneyKey(total),
    normalizeSaleText(r.orderType),
    normalizeSaleText(r.unitName),
    normalizeSaleText(r.personName),
    normalizeSaleDate(r.saleDate),
    normalizeActivityName(r.activityName),
  ].join('|')
}

/** 一年内同客同品同实收视为疑似重复（成交日可不同；与销售单位/销售员无关） */
export const SALES_SIMILARITY_MAX_DAYS = 365

/** 疑似相似指纹：客户 + 产品 + 实收金额 */
export type SaleSimilarityFields = {
  customerName?: string
  productName?: string
  totalAmount?: number
}

export function buildSalesSimilarityFingerprint(r: SaleSimilarityFields): string {
  return [
    normalizeSaleText(r.customerName),
    normalizeSaleText(r.productName),
    moneyKey(r.totalAmount),
  ].join('|')
}

function saleDateToUtcMs(value?: string): number | null {
  const ymd = normalizeSaleDate(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** 成交日相距不超过 maxDays（缺日期时仍视为同组，便于人工确认） */
export function saleDatesWithinSimilarityWindow(
  a?: string,
  b?: string,
  maxDays: number = SALES_SIMILARITY_MAX_DAYS,
): boolean {
  const ma = saleDateToUtcMs(a)
  const mb = saleDateToUtcMs(b)
  if (ma == null || mb == null) return true
  return Math.abs(ma - mb) / 86400000 <= maxDays
}

export function resolveSaleProductName(
  s: Pick<SalesRecord, 'productId' | 'productName'>,
  productNameById: Map<string, string>,
): string {
  if (s.productId && productNameById.get(s.productId)) {
    return productNameById.get(s.productId) || ''
  }
  return s.productName || ''
}

export function resolveSalePersonName(
  s: Pick<SalesRecord, 'personnelId' | 'salesPersonName'>,
  personNameById: Map<string, string>,
): string {
  if (s.personnelId && personNameById.get(s.personnelId)) {
    return personNameById.get(s.personnelId) || ''
  }
  return s.salesPersonName || ''
}

export function resolveSaleUnitName(
  s: Pick<SalesRecord, 'salesUnitId' | 'salesUnitName'>,
  unitNameById: Map<string, string>,
): string {
  if (s.salesUnitId && unitNameById.get(s.salesUnitId)) {
    return unitNameById.get(s.salesUnitId) || ''
  }
  return s.salesUnitName || ''
}

export function getSalesRecordFingerprint(
  s: SalesRecord,
  maps: SaleNameMaps,
): string {
  return buildSalesDuplicateFingerprint({
    customerName: s.customerName,
    productName: resolveSaleProductName(s, maps.productNameById),
    orderAmount: s.orderAmount,
    totalAmount: s.totalAmount,
    orderType: s.orderType,
    unitName: resolveSaleUnitName(s, maps.unitNameById),
    personName: resolveSalePersonName(s, maps.personNameById),
    saleDate: s.saleDate,
    activityName: s.activityName,
  })
}

export function getSalesRecordSimilarityKey(
  s: SalesRecord,
  maps: SaleNameMaps,
): string {
  return buildSalesSimilarityFingerprint({
    customerName: s.customerName,
    productName: resolveSaleProductName(s, maps.productNameById),
    totalAmount: s.totalAmount,
  })
}

/**
 * 收集疑似相似记录 id：同客+同品+同实收，且成交日在一年内任意两笔配对；
 * 排除确定重复、已「确认不重复」的指纹。
 */
export function collectSimilarRecordIds(
  records: SalesRecord[],
  maps: SaleNameMaps,
  options?: {
    duplicateIdSet?: Set<string>
    dismissedFingerprints?: Set<string>
    maxDaysApart?: number
  },
): Set<string> {
  const duplicateIdSet = options?.duplicateIdSet || new Set<string>()
  const dismissed = options?.dismissedFingerprints || new Set<string>()
  const maxDays = options?.maxDaysApart ?? SALES_SIMILARITY_MAX_DAYS
  const byKey = new Map<string, SalesRecord[]>()
  for (const s of records) {
    if (duplicateIdSet.has(s.id)) continue
    const customer = normalizeSaleText(s.customerName)
    const product = normalizeSaleText(
      resolveSaleProductName(s, maps.productNameById),
    )
    if (!customer || !product) continue
    const key = getSalesRecordSimilarityKey(s, maps)
    if (!key || dismissed.has(key)) continue
    const list = byKey.get(key) || []
    list.push(s)
    byKey.set(key, list)
  }
  const set = new Set<string>()
  byKey.forEach((group) => {
    if (group.length < 2) return
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (
          saleDatesWithinSimilarityWindow(
            group[i].saleDate,
            group[j].saleDate,
            maxDays,
          )
        ) {
          set.add(group[i].id)
          set.add(group[j].id)
        }
      }
    }
  })
  return set
}

export type SaleRecordGroupMode = 'duplicate' | 'similar'

export type SaleRecordGroupMeta = {
  groupNo: number
  size: number
}

export function getSaleRecordGroupKey(
  s: SalesRecord,
  maps: SaleNameMaps,
  mode: SaleRecordGroupMode,
): string {
  return mode === 'duplicate'
    ? getSalesRecordFingerprint(s, maps)
    : getSalesRecordSimilarityKey(s, maps)
}

/** 按组分在一起：组顺序按指纹字典序，组内成交日新在前 */
export function sortAndGroupSaleRecords(
  records: SalesRecord[],
  maps: SaleNameMaps,
  mode: SaleRecordGroupMode,
): { sorted: SalesRecord[]; meta: Map<string, SaleRecordGroupMeta> } {
  const buckets = new Map<string, SalesRecord[]>()
  for (const s of records) {
    const key = getSaleRecordGroupKey(s, maps, mode)
    const list = buckets.get(key) || []
    list.push(s)
    buckets.set(key, list)
  }
  const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const sorted: SalesRecord[] = []
  const meta = new Map<string, SaleRecordGroupMeta>()
  keys.forEach((key, idx) => {
    const group = [...(buckets.get(key) || [])].sort(compareSaleDateDesc)
    const groupNo = idx + 1
    group.forEach((s) => {
      sorted.push(s)
      meta.set(s.id, { groupNo, size: group.length })
    })
  })
  return { sorted, meta }
}
