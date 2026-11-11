/** 销售订单成本扣除 → 结算/计佣共用基数 */

import { roundMoney } from '@/lib/format'
import { getPersonShareAmount } from '@/lib/saleCollaborators'
import type { Product, SalesRecord } from '@/types'

export type OrderCostResolveResult = {
  /** 实际采用的成本扣除 */
  cost: number
  /** 产品配置算出的系统成本 */
  systemCost: number
  /** 是否手工覆盖 */
  isManual: boolean
  /** 订单全额 */
  orderAmount: number
  /** 扣成本后基数（全单） */
  netAmount: number
}

/** 按产品配置估算本单系统成本 */
export function calcSystemOrderCost(
  sale: Pick<SalesRecord, 'totalAmount' | 'quantity'> & { unitPrice?: number },
  product?: Product | null,
): number {
  if (!product) return 0
  const qty = Number(sale.quantity) || 0
  const total = Number(sale.totalAmount) || 0
  if (product.costType === 'percentage') {
    const rate = Number(product.costRate) || 0
    if (rate <= 0) return 0
    // 优先按本单实收比例，避免产品标价与成交价不一致
    return roundMoney(total * (rate / 100))
  }
  const unitCost = Number(product.unitCost) || 0
  if (unitCost <= 0 || qty <= 0) return 0
  return roundMoney(unitCost * qty)
}

/**
 * 解析本单成本扣除。
 * - costDeductionOverride 为 number（含 0）→ 手工覆盖
 * - 否则 → 产品系统成本
 */
export function resolveOrderCostDeduction(
  sale: Pick<SalesRecord, 'totalAmount' | 'quantity' | 'costDeductionOverride'> & {
    unitPrice?: number
  },
  product?: Product | null,
): OrderCostResolveResult {
  const orderAmount = Number(sale.totalAmount) || 0
  const systemCost = calcSystemOrderCost(sale, product)
  const hasOverride =
    sale.costDeductionOverride !== undefined && sale.costDeductionOverride !== null
  const cost = hasOverride
    ? Math.max(0, Number(sale.costDeductionOverride) || 0)
    : systemCost
  const capped = Math.min(cost, Math.max(0, orderAmount))
  return {
    cost: roundMoney(capped),
    systemCost: roundMoney(systemCost),
    isManual: hasOverride,
    orderAmount: roundMoney(orderAmount),
    netAmount: roundMoney(Math.max(0, orderAmount - capped)),
  }
}

export function getSaleNetAmount(
  sale: Pick<SalesRecord, 'totalAmount' | 'quantity' | 'costDeductionOverride'> & {
    unitPrice?: number
  },
  product?: Product | null,
): number {
  return resolveOrderCostDeduction(sale, product).netAmount
}

/** 某人在该单上的计佣/业绩份额（扣成本后按占比分摊） */
export function getPersonCommissionBaseAmount(
  sale: Pick<
    SalesRecord,
    | 'personnelId'
    | 'collaborators'
    | 'shareMode'
    | 'totalAmount'
    | 'quantity'
    | 'costDeductionOverride'
  > & { unitPrice?: number },
  personId: string,
  product?: Product | null,
): number {
  const share = getPersonShareAmount(sale, personId)
  if (share <= 0) return 0
  const total = Number(sale.totalAmount) || 0
  if (total <= 0) return 0
  const { netAmount } = resolveOrderCostDeduction(sale, product)
  return roundMoney(share * (netAmount / total))
}

export function findProductById(
  products: Product[] | undefined,
  productId: string,
): Product | undefined {
  if (!products?.length || !productId) return undefined
  return products.find((p) => p.id === productId)
}

/**
 * 将已按人缩放的销售行，再按「原单净额/全额」比例压到计佣基数。
 * original 为缩放前整单；scaled 为 scaleSaleForPerson 结果。
 */
export function applyCostNetToScaledSale(
  original: SalesRecord,
  scaled: SalesRecord,
  product?: Product | null,
): SalesRecord {
  const fullTotal = Number(original.totalAmount) || 0
  if (fullTotal <= 0) return scaled
  const { cost, netAmount } = resolveOrderCostDeduction(original, product)
  if (cost <= 0) return scaled
  const ratio = netAmount / fullTotal
  return {
    ...scaled,
    totalAmount: roundMoney((Number(scaled.totalAmount) || 0) * ratio),
  }
}
