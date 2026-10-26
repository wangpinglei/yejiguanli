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

/** 统一为 YYYY-MM-DD；避免 2026-9-28 这类未补零在字符串排序时排到 2026-10 前面 */
export function normalizeSaleDate(value?: string): string {
  const s = String(value || '').trim()
  if (!s) return ''
  const ymd = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
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

/** 疑似相似：客户+产品+实收+销售+成交日；单位/订单类型可不同 */
export type SaleSimilarityFields = {
  customerName?: string
  productName?: string
  totalAmount?: number
  personName?: string
  saleDate?: string
}

export function buildSalesSimilarityFingerprint(r: SaleSimilarityFields): string {
  return [
    normalizeSaleText(r.customerName),
    normalizeSaleText(r.productName),
    moneyKey(r.totalAmount),
    normalizeSaleText(r.personName),
    normalizeSaleDate(r.saleDate),
  ].join('|')
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
    personName: resolveSalePersonName(s, maps.personNameById),
    saleDate: s.saleDate,
  })
}

/**
 * 收集疑似相似记录 id：同 similarity key 出现 >1，且排除已是确定重复、已确认不重复的。
 */
export function collectSimilarRecordIds(
  records: SalesRecord[],
  maps: SaleNameMaps,
  options?: {
    duplicateIdSet?: Set<string>
    dismissedFingerprints?: Set<string>
  },
): Set<string> {
  const duplicateIdSet = options?.duplicateIdSet || new Set<string>()
  const dismissed = options?.dismissedFingerprints || new Set<string>()
  const keyCounts = new Map<string, number>()
  const idToKey = new Map<string, string>()
  for (const s of records) {
    if (duplicateIdSet.has(s.id)) continue
    const key = getSalesRecordSimilarityKey(s, maps)
    if (!key || key === '||||' || dismissed.has(key)) continue
    idToKey.set(s.id, key)
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1)
  }
  const set = new Set<string>()
  idToKey.forEach((key, id) => {
    if ((keyCounts.get(key) || 0) > 1) set.add(id)
  })
  return set
}
