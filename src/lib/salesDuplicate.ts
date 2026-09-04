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

export function normalizeSaleDate(value?: string): string {
  return String(value || '').slice(0, 10)
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
