import {
  buildSaleNameMaps,
  buildSalesDuplicateFingerprint,
  buildSalesSimilarityFingerprint,
  collectSimilarRecordIds,
  compareSaleDateDesc,
  getSalesRecordFingerprint,
  getSalesRecordSimilarityKey,
  normalizeSaleDate,
} from './salesDuplicate'
import type { SalesRecord } from './../types'

function assertEqual(actual: unknown, expected: unknown, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg || `expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertNotEqual(actual: unknown, expected: unknown, msg?: string) {
  if (actual === expected) {
    throw new Error(msg || `expected not ${String(expected)}`)
  }
}

function baseRecord(partial: Partial<SalesRecord> & { id: string }): SalesRecord {
  return {
    salesUnitId: 'u1',
    personnelId: 'p1',
    productId: 'pr1',
    quantity: 1,
    unitPrice: 1000,
    totalAmount: 1000,
    saleDate: '2026-10-01',
    remark: '',
    customerName: '客户甲',
    orderType: '新购',
    activityName: '无活动',
    ...partial,
  }
}

const maps = buildSaleNameMaps(
  [{ id: 'pr1', name: '产品A' }],
  [{ id: 'p1', name: '熊约燕' }],
  [
    { id: 'u1', name: '深圳运营中心' },
    { id: 'u2', name: '海南' },
  ],
)

{
  const a = buildSalesSimilarityFingerprint({
    customerName: '客户甲',
    productName: '产品A',
    totalAmount: 1000,
    personName: '熊约燕',
    saleDate: '2026-10-01',
  })
  const b = buildSalesSimilarityFingerprint({
    customerName: '客户甲',
    productName: '产品A',
    totalAmount: 1000,
    personName: '熊约燕',
    saleDate: '2026-10-01',
  })
  assertEqual(a, b)
}

{
  const shenzhen = baseRecord({ id: '1', salesUnitId: 'u1', orderType: '新购' })
  const hainan = baseRecord({
    id: '2',
    salesUnitId: 'u2',
    orderType: '续费',
    synced: true,
  })
  assertEqual(
    getSalesRecordSimilarityKey(shenzhen, maps),
    getSalesRecordSimilarityKey(hainan, maps),
  )
  assertNotEqual(
    getSalesRecordFingerprint(shenzhen, maps),
    getSalesRecordFingerprint(hainan, maps),
  )
  const similar = collectSimilarRecordIds([shenzhen, hainan], maps)
  assertEqual(similar.has('1'), true)
  assertEqual(similar.has('2'), true)
}

{
  const a = baseRecord({ id: '1' })
  const b = baseRecord({ id: '2', synced: true })
  assertEqual(
    buildSalesDuplicateFingerprint({
      customerName: a.customerName,
      productName: '产品A',
      orderAmount: a.orderAmount,
      totalAmount: a.totalAmount,
      orderType: a.orderType,
      unitName: '深圳运营中心',
      personName: '熊约燕',
      saleDate: a.saleDate,
      activityName: a.activityName,
    }),
    getSalesRecordFingerprint(b, maps),
  )
  const dupSet = new Set(['1', '2'])
  const similar = collectSimilarRecordIds([a, b], maps, { duplicateIdSet: dupSet })
  assertEqual(similar.size, 0)
}

{
  const a = baseRecord({ id: '1', salesUnitId: 'u1' })
  const b = baseRecord({ id: '2', salesUnitId: 'u2', orderType: '续费' })
  const key = getSalesRecordSimilarityKey(a, maps)
  const similar = collectSimilarRecordIds([a, b], maps, {
    dismissedFingerprints: new Set([key]),
  })
  assertEqual(similar.size, 0)
}

{
  assertEqual(normalizeSaleDate('2026-9-28'), '2026-09-28')
  assertEqual(normalizeSaleDate('2026/10/26'), '2026-10-26')
  const rows = [
    { id: 'sept', saleDate: '2026-9-28' },
    { id: 'oct', saleDate: '2026-10-26' },
  ].sort(compareSaleDateDesc)
  assertEqual(rows[0].id, 'oct', '未补零的9月不应排在10月前面')
  assertEqual(rows[1].id, 'sept')
}

console.log('salesDuplicate.test.ts: ok')
