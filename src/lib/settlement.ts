import type { UnitProductSettlement } from '@/types'

/** 取日期 YYYY-MM-DD 部分 */
export function toDateOnly(value?: string): string {
  if (!value) return ''
  return value.slice(0, 10)
}

/** 销售日是否落在 [from, to]（空表示该端不限制） */
export function isSaleDateInRange(
  saleDate: string,
  from?: string,
  to?: string,
): boolean {
  const d = toDateOnly(saleDate)
  if (!d) return true
  const f = toDateOnly(from)
  const t = toDateOnly(to)
  if (f && d < f) return false
  if (t && d > t) return false
  return true
}

/**
 * 查找单位×产品结算配置。
 * 若配置了生效区间且销售日不在区间内，返回 undefined（调用方按全额结算）。
 */
export function findUnitProductSettlement(
  list: UnitProductSettlement[],
  productId: string,
  unitId: string,
  saleDate?: string,
): UnitProductSettlement | undefined {
  const ups = list.find((x) => x.salesUnitId === unitId && x.productId === productId)
  if (!ups) return undefined
  if (!saleDate) return ups
  if (!isSaleDateInRange(saleDate, ups.effectiveFrom, ups.effectiveTo)) {
    return undefined
  }
  return ups
}

/** 单笔销售的基础结算金额（不含奖励） */
export function calcSaleSettlementBase(
  sale: { totalAmount: number; quantity: number },
  ups?: UnitProductSettlement,
): number {
  if (!ups) return sale.totalAmount
  if (ups.settlementType === 'fixed') {
    return (ups.settlementAmount || 0) * sale.quantity
  }
  return sale.totalAmount * ((ups.settlementRate || 0) / 100)
}

/** 特殊结算奖励（按件） */
export function calcSaleSettlementReward(
  sale: { quantity: number; saleDate?: string },
  ups?: UnitProductSettlement,
): number {
  const rewardAmount = ups?.rewardAmount ?? 0
  if (!ups || rewardAmount <= 0) return 0
  const saleDate = sale.saleDate || ''
  const from = ups.rewardFrom || ups.effectiveFrom
  const to = ups.rewardTo || ups.effectiveTo
  if (saleDate && !isSaleDateInRange(saleDate, from, to)) return 0
  return rewardAmount * (sale.quantity || 0)
}

/** 单笔销售结算收入 = 基础结算 + 特殊奖励 */
export function calcSaleSettlementIncome(
  sale: {
    totalAmount: number
    quantity: number
    saleDate?: string
    productId: string
    salesUnitId: string
  },
  upsList: UnitProductSettlement[],
): number {
  const ups = findUnitProductSettlement(
    upsList,
    sale.productId,
    sale.salesUnitId,
    sale.saleDate,
  )
  return calcSaleSettlementBase(sale, ups) + calcSaleSettlementReward(sale, ups)
}

export function formatSettlementPeriod(ups?: UnitProductSettlement): string {
  if (!ups) return '未配置'
  const from = toDateOnly(ups.effectiveFrom) || '不限'
  const to = toDateOnly(ups.effectiveTo) || '不限'
  if (from === '不限' && to === '不限') return '长期有效'
  return `${from} ~ ${to}`
}
