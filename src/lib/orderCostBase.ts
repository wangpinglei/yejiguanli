/** 销售订单成本扣除 → 结算/计佣共用基数 */

import {
  calcActivityCostDeduction,
  findActivityCostRuleForSale,
  normalizeActivityName,
  type ActivityCostRule,
} from '@/lib/activityCost'
import { roundMoney } from '@/lib/format'
import { getPersonShareAmount } from '@/lib/saleCollaborators'
import type { Product, SalesRecord } from '@/types'

export type OrderCostResolveResult = {
  /** 实际采用的成本扣除 */
  cost: number
  /** 自动口径算出的系统成本（产品或活动规则） */
  systemCost: number
  /** 是否手工覆盖 */
  isManual: boolean
  /** 自动成本是否来自活动规则（非产品） */
  fromActivityRule?: boolean
  /** 订单全额 */
  orderAmount: number
  /** 扣成本后基数（全单） */
  netAmount: number
}

export type OrderCostResolveOptions = {
  activityRules?: ActivityCostRule[]
}

/** 全局活动规则（DataContext 刷新时注入，供工资/结算等统一读口径） */
let sharedActivityCostRules: ActivityCostRule[] | undefined

export function setSharedActivityCostRules(
  rules: ActivityCostRule[] | undefined,
): void {
  sharedActivityCostRules = rules
}

function resolveActivityRules(
  options?: OrderCostResolveOptions,
): ActivityCostRule[] | undefined {
  if (options?.activityRules?.length) return options.activityRules
  return sharedActivityCostRules
}

/** 无手工覆盖时：活动规则（成交日在有效期内）优先，否则产品成本 */
export function calcAutoOrderCost(
  sale: Pick<SalesRecord, 'totalAmount' | 'quantity'> & {
    unitPrice?: number
    activityName?: string
    saleDate?: string
  },
  product?: Product | null,
  options?: OrderCostResolveOptions,
): { cost: number; fromActivityRule: boolean } {
  const rules = resolveActivityRules(options)
  const productCost = calcSystemOrderCost(sale, product)
  const rule = findActivityCostRuleForSale(rules, sale.activityName, sale.saleDate)
  if (rule) {
    const act = calcActivityCostDeduction(rule, Number(sale.totalAmount) || 0)
    if (act != null) {
      return { cost: act, fromActivityRule: true }
    }
  }
  return { cost: productCost, fromActivityRule: false }
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
 * - 否则 → 活动规则（有效期内）或产品系统成本
 */
export function resolveOrderCostDeduction(
  sale: Pick<SalesRecord, 'totalAmount' | 'quantity' | 'costDeductionOverride' | 'synced'> & {
    unitPrice?: number
    activityName?: string
    saleDate?: string
  },
  product?: Product | null,
  options?: OrderCostResolveOptions,
): OrderCostResolveResult {
  const orderAmount = Number(sale.totalAmount) || 0
  const auto = calcAutoOrderCost(sale, product, options)
  const systemCost = auto.cost
  const rawOverride = sale.costDeductionOverride
  const hasStoredOverride =
    rawOverride !== undefined && rawOverride !== null
  const overrideNum = hasStoredOverride ? Math.max(0, Number(rawOverride) || 0) : 0
  let hasOverride = false
  if (hasStoredOverride && overrideNum > 0) {
    hasOverride = true
  } else if (hasStoredOverride && overrideNum === 0) {
    // 生态圈单常见：库里误存 0，会挡住活动规则；若本应命中规则则仍走自动
    const legacySyncedZero =
      sale.synced && auto.fromActivityRule && systemCost > 0
    hasOverride = !legacySyncedZero
  }
  const cost = hasOverride ? overrideNum : systemCost
  const capped = Math.min(cost, Math.max(0, orderAmount))
  return {
    cost: roundMoney(capped),
    systemCost: roundMoney(systemCost),
    isManual: hasOverride,
    fromActivityRule: !hasOverride && auto.fromActivityRule,
    orderAmount: roundMoney(orderAmount),
    netAmount: roundMoney(Math.max(0, orderAmount - capped)),
  }
}

export function getSaleNetAmount(
  sale: Pick<SalesRecord, 'totalAmount' | 'quantity' | 'costDeductionOverride'> & {
    unitPrice?: number
    activityName?: string
    saleDate?: string
  },
  product?: Product | null,
  options?: OrderCostResolveOptions,
): number {
  return resolveOrderCostDeduction(sale, product, options).netAmount
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

function formatProductCostDeductionRemark(
  sale: Pick<SalesRecord, 'quantity'>,
  product?: Product | null,
): string {
  if (!product) return '未关联产品，无自动成本规则'
  if (product.costType === 'percentage') {
    const rate = Number(product.costRate) || 0
    if (rate <= 0) return '产品未配置成本比例'
    return `产品成本：实收×${rate}%`
  }
  const unitCost = Number(product.unitCost) || 0
  const qty = Number(sale.quantity) || 0
  if (unitCost <= 0) return '产品未配置单位成本'
  if (qty <= 0) return `产品成本：¥${unitCost}/件（本单数量0）`
  return `产品成本：¥${unitCost}×${qty}件`
}

function formatActivityCostDeductionRemark(
  rule: ActivityCostRule,
  activityName: string | null | undefined,
): string {
  const name = normalizeActivityName(rule.activityName)
    || normalizeActivityName(activityName)
    || '活动'
  if (rule.costType === 'percentage') {
    return `活动「${name}」：实收×${rule.costValue}%`
  }
  return `活动「${name}」：固定扣除¥${rule.costValue}`
}

function formatAutoOrderCostDeductionRemark(
  sale: Pick<
    SalesRecord,
    'totalAmount' | 'quantity' | 'activityName' | 'saleDate'
  > & { unitPrice?: number },
  product?: Product | null,
  options?: OrderCostResolveOptions,
): string {
  const rules = resolveActivityRules(options)
  const auto = calcAutoOrderCost(sale, product, options)
  if (auto.fromActivityRule) {
    const rule = findActivityCostRuleForSale(
      rules,
      sale.activityName,
      sale.saleDate,
    )
    if (rule) return formatActivityCostDeductionRemark(rule, sale.activityName)
    const act = normalizeActivityName(sale.activityName)
    return act ? `活动「${act}」成本规则` : '活动成本规则'
  }
  return formatProductCostDeductionRemark(sale, product)
}

/** 业绩扣除原因说明（列表 / 结算 / 导出展示） */
export function formatOrderCostDeductionRemark(
  sale: Pick<
    SalesRecord,
    | 'totalAmount'
    | 'quantity'
    | 'costDeductionOverride'
    | 'synced'
    | 'activityName'
    | 'saleDate'
  > & { unitPrice?: number },
  product?: Product | null,
  options?: OrderCostResolveOptions,
): string {
  const resolved = resolveOrderCostDeduction(sale, product, options)
  if (resolved.cost <= 0) return '无业绩扣除'
  const autoReason = formatAutoOrderCostDeductionRemark(sale, product, options)
  if (resolved.isManual) {
    if (Math.abs(resolved.cost - resolved.systemCost) < 0.005) {
      return `本单手工确认（${autoReason}）`
    }
    return `本单手工调整（系统建议：${autoReason}）`
  }
  return autoReason
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
