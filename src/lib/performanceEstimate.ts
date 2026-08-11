/** 业绩测算：结算比例 − 提成比例 后倒推盈亏线实收 */

export type EstimateSnapshot = {
  salesAmount: number
  settlementIncome: number
  otherIncome: number
  /** 固定成本（不含随实收变动的销售提成） */
  totalCost: number
  profit: number
  /** 系统带入的参考结算比例（结算/实收） */
  suggestedRatio: number
  /** 系统带入的参考提成比例（提成/实收） */
  suggestedCommissionRatio: number
}

export function getSettlementToSalesRatio(
  settlementIncome: number,
  salesAmount: number,
): number {
  if (salesAmount <= 0 || settlementIncome <= 0) return 0
  return settlementIncome / salesAmount
}

export function getCommissionToSalesRatio(
  commission: number,
  salesAmount: number,
): number {
  if (salesAmount <= 0 || commission <= 0) return 0
  return commission / salesAmount
}

export function buildEstimateSnapshot(input: {
  salesAmount: number
  settlementIncome: number
  otherIncome: number
  totalCost: number
  suggestedRatio?: number
  suggestedCommissionRatio?: number
}): EstimateSnapshot {
  const profit =
    input.settlementIncome + input.otherIncome - input.totalCost
  return {
    salesAmount: input.salesAmount,
    settlementIncome: input.settlementIncome,
    otherIncome: input.otherIncome,
    totalCost: input.totalCost,
    profit,
    suggestedRatio:
      input.suggestedRatio
      ?? getSettlementToSalesRatio(input.settlementIncome, input.salesAmount),
    suggestedCommissionRatio: input.suggestedCommissionRatio ?? 0,
  }
}

export type PerformanceForecast = {
  predictedSales: number
  predictedSettlement: number
  predictedCommission: number
  predictedProfit: number
  salesDelta: number
  profitDelta: number
  /** 结算比例 − 提成比例 */
  netMarginRatio: number
}

/**
 * 倒推盈亏线（利润 = 0）
 * 利润 = 实收×结算比例 + 其他收入 − 固定成本 − 实收×提成比例
 * ⇒ 实收 = (固定成本 − 其他收入) / (结算比例 − 提成比例)
 */
export function calcBreakEvenSales(input: {
  otherIncome: number
  totalCost: number
  settlementRatio: number
  commissionRatio: number
  currentSales: number
}): {
  requiredSales: number
  remainingSales: number
  requiredSettlement: number
  requiredCommission: number
  netMarginRatio: number
  alreadyAboveLine: boolean
  error?: string
} | null {
  const settlementRatio = input.settlementRatio
  const commissionRatio = Math.max(0, input.commissionRatio)
  if (settlementRatio <= 0) return null

  const netMarginRatio = settlementRatio - commissionRatio
  if (netMarginRatio <= 0) {
    return {
      requiredSales: 0,
      remainingSales: 0,
      requiredSettlement: 0,
      requiredCommission: 0,
      netMarginRatio,
      alreadyAboveLine: false,
      error: '提成比例须小于结算比例，否则无法靠销售覆盖成本',
    }
  }

  const coverNeed = Math.max(0, input.totalCost - input.otherIncome)
  const requiredSales = Math.ceil(coverNeed / netMarginRatio)
  const remainingSales = Math.max(
    0,
    requiredSales - Math.max(0, input.currentSales),
  )
  const requiredSettlement = requiredSales * settlementRatio
  const requiredCommission = requiredSales * commissionRatio

  return {
    requiredSales,
    remainingSales,
    requiredSettlement,
    requiredCommission,
    netMarginRatio,
    alreadyAboveLine: remainingSales <= 0,
  }
}

/**
 * 正向预测：预估利润 = 结算 + 其他 − 固定成本 − 提成
 */
export function calcPerformanceForecast(input: {
  predictedSales: number
  settlementRatio: number
  commissionRatio: number
  otherIncome: number
  totalCost: number
  currentSales: number
  currentProfit: number
}): PerformanceForecast | null {
  const settlementRatio = input.settlementRatio
  const commissionRatio = Math.max(0, input.commissionRatio)
  if (settlementRatio <= 0 || !Number.isFinite(input.predictedSales)) return null

  const predictedSales = Math.max(0, input.predictedSales)
  const predictedSettlement = predictedSales * settlementRatio
  const predictedCommission = predictedSales * commissionRatio
  const predictedProfit =
    predictedSettlement
    + input.otherIncome
    - input.totalCost
    - predictedCommission

  return {
    predictedSales,
    predictedSettlement,
    predictedCommission,
    predictedProfit,
    salesDelta: predictedSales - input.currentSales,
    profitDelta: predictedProfit - input.currentProfit,
    netMarginRatio: settlementRatio - commissionRatio,
  }
}

/** 百分比 → 0~1；须 > 0（结算比例） */
export function parseSettlementRatioPercent(input: string): number {
  const n = Number(String(input).replace(/%/g, '').replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, 100) / 100
}

/** 百分比 → 0~1；允许 0（提成可为 0） */
export function parseCommissionRatioPercent(input: string): number {
  const n = Number(String(input).replace(/%/g, '').replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, 100) / 100
}

export function formatRatioAsPercentInput(ratio: number): string {
  if (ratio <= 0) return ''
  return (ratio * 100).toFixed(2).replace(/\.?0+$/, '')
}

export function parseMoneyInput(input: string): number {
  const n = Number(String(input).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}
