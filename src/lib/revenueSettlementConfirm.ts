import { calcSaleSettlementIncome } from '@/lib/settlement'
import type {
  RevenueProductSettlement,
  RevenueSettlement,
  SalesRecord,
  UnitProductSettlement,
} from '@/types'

export type ProductSettlementGroup = {
  productId: string
  productName: string
  salesCount: number
  orderAmount: number
  estimatedSettlement: number
}

export type ProductSettlementGroupDetail = ProductSettlementGroup & {
  actualAmount: number
  isAdjusted: boolean
  settlement?: RevenueProductSettlement
  diff: number
}

export type UnitSettlementSummary = {
  estimatedAmount: number
  actualAmount: number
  isAdjusted: boolean
  productGroups: ProductSettlementGroupDetail[]
}

type SaleLike = Pick<
  SalesRecord,
  'productId' | 'productName' | 'totalAmount' | 'quantity' | 'saleDate' | 'salesUnitId'
>

function getProductKey(s: SaleLike): string {
  return (s.productId || '').trim() || `name:${(s.productName || '').trim()}`
}

export function buildProductSettlementGroups(
  unitSales: SaleLike[],
  upsList: UnitProductSettlement[],
  productNameMap: Map<string, string>,
): ProductSettlementGroup[] {
  const map = new Map<string, ProductSettlementGroup>()
  for (const s of unitSales) {
    const productId = getProductKey(s)
    const productName =
      productNameMap.get(s.productId || '')
      || (s.productName || '').trim()
      || '（未匹配产品）'
    const settlementAmt = calcSaleSettlementIncome(s, upsList)
    const hit = map.get(productId)
    if (hit) {
      hit.salesCount += 1
      hit.orderAmount += s.totalAmount || 0
      hit.estimatedSettlement += settlementAmt
    } else {
      map.set(productId, {
        productId,
        productName,
        salesCount: 1,
        orderAmount: s.totalAmount || 0,
        estimatedSettlement: settlementAmt,
      })
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.estimatedSettlement - a.estimatedSettlement,
  )
}

export function findRevenueProductSettlement(
  records: RevenueProductSettlement[],
  salesUnitId: string,
  productId: string,
  yearMonth: string,
): RevenueProductSettlement | undefined {
  return records.find(
    (r) =>
      r.salesUnitId === salesUnitId
      && r.productId === productId
      && r.yearMonth === yearMonth,
  )
}

export function getEffectiveProductSettlement(
  records: RevenueProductSettlement[],
  salesUnitId: string,
  productId: string,
  yearMonth: string,
  estimatedFallback: number,
): number {
  const hit = findRevenueProductSettlement(
    records,
    salesUnitId,
    productId,
    yearMonth,
  )
  if (hit?.isAdjusted && hit.actualAmount != null) {
    return Number(hit.actualAmount) || 0
  }
  return estimatedFallback
}

/** 单位×月结算：优先各产品确认合计；无产品确认时兼容旧版单位级调整 */
export function resolveUnitSettlementIncome(
  unitId: string,
  yearMonth: string,
  unitSales: SaleLike[],
  upsList: UnitProductSettlement[],
  productSettlements: RevenueProductSettlement[],
  legacyUnitSettlement: RevenueSettlement | undefined,
  productNameMap: Map<string, string>,
): UnitSettlementSummary {
  const groups = buildProductSettlementGroups(unitSales, upsList, productNameMap)
  let estimatedAmount = 0
  let actualAmount = 0
  let adjustedProductCount = 0

  const productGroups: ProductSettlementGroupDetail[] = groups.map((g) => {
    estimatedAmount += g.estimatedSettlement
    const settlement = findRevenueProductSettlement(
      productSettlements,
      unitId,
      g.productId,
      yearMonth,
    )
    const isAdjusted = settlement?.isAdjusted || false
    if (isAdjusted) adjustedProductCount += 1
    const effective = getEffectiveProductSettlement(
      productSettlements,
      unitId,
      g.productId,
      yearMonth,
      g.estimatedSettlement,
    )
    actualAmount += effective
    return {
      ...g,
      actualAmount: effective,
      isAdjusted,
      settlement,
      diff: effective - g.estimatedSettlement,
    }
  })

  const hasProductAdjustments = adjustedProductCount > 0
  const legacyAdjusted =
    !hasProductAdjustments
    && legacyUnitSettlement?.isAdjusted
    && legacyUnitSettlement.actualAmount != null

  if (legacyAdjusted) {
    actualAmount = Number(legacyUnitSettlement!.actualAmount) || 0
  }

  return {
    estimatedAmount,
    actualAmount,
    isAdjusted: hasProductAdjustments || Boolean(legacyAdjusted),
    productGroups,
  }
}

/** 跨页面：按单位+月份汇总有效结算收入 */
export function getEffectiveUnitSettlementTotal(
  unitId: string,
  yearMonth: string,
  salesRecords: SalesRecord[],
  upsList: UnitProductSettlement[],
  productSettlements: RevenueProductSettlement[],
  legacyUnitSettlements: RevenueSettlement[],
  productNameMap: Map<string, string>,
): number {
  const unitSales = salesRecords.filter(
    (s) => s.salesUnitId === unitId && (s.saleDate || '').slice(0, 7) === yearMonth,
  )
  const legacy = legacyUnitSettlements.find(
    (r) => r.salesUnitId === unitId && r.yearMonth === yearMonth,
  )
  return resolveUnitSettlementIncome(
    unitId,
    yearMonth,
    unitSales,
    upsList,
    productSettlements,
    legacy,
    productNameMap,
  ).actualAmount
}
