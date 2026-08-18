import { matchesRecurringYearMonth, type RecurringLike } from '@/utils/recurringRecord'

/**
 * 结算收入 / 手工成本：预估 vs 确认后的有效金额
 * 已确认（isAdjusted 且有 actualAmount）→ 用实际；否则用预估
 */
export type AmountConfirmRecord = {
  salesUnitId: string
  yearMonth: string
  estimatedAmount: number
  actualAmount?: number
  isAdjusted: boolean
}

export type ManualCostLike = RecurringLike & {
  salesUnitId: string
  totalCost: number
}

export function getEffectiveConfirmAmount(
  records: AmountConfirmRecord[],
  salesUnitId: string,
  yearMonth: string,
  estimatedFallback: number,
): number {
  const hit = records.find(
    (r) => r.salesUnitId === salesUnitId && r.yearMonth === yearMonth,
  )
  if (hit?.isAdjusted && hit.actualAmount != null) return Number(hit.actualAmount) || 0
  return estimatedFallback
}

export function findConfirmRecord<T extends AmountConfirmRecord>(
  records: T[],
  salesUnitId: string,
  yearMonth: string,
): T | undefined {
  return records.find(
    (r) => r.salesUnitId === salesUnitId && r.yearMonth === yearMonth,
  )
}

export function getEstimatedManualCost(
  costRecords: ManualCostLike[],
  salesUnitId: string,
  yearMonth: string,
): number {
  return costRecords
    .filter(
      (c) =>
        c.salesUnitId === salesUnitId && matchesRecurringYearMonth(c, yearMonth),
    )
    .reduce((sum, c) => sum + (Number(c.totalCost) || 0), 0)
}

export function getEffectiveManualCost(
  costSettlements: AmountConfirmRecord[],
  costRecords: ManualCostLike[],
  salesUnitId: string,
  yearMonth: string,
): number {
  return getEffectiveConfirmAmount(
    costSettlements,
    salesUnitId,
    yearMonth,
    getEstimatedManualCost(costRecords, salesUnitId, yearMonth),
  )
}
