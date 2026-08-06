import { getYearMonth } from '@/lib/format'
import type {
  PerformanceTarget,
  SalesRecord,
  TeamMgmtCommissionRule,
  TeamMgmtCommissionTier,
  UnitProductSettlement,
} from '@/types'

function filterSalesByMonth(records: SalesRecord[], yearMonth?: string): SalesRecord[] {
  if (!yearMonth) return records
  return records.filter((r) => getYearMonth(r.saleDate) === yearMonth)
}

export const DEFAULT_TEAM_MGMT_TIERS: TeamMgmtCommissionTier[] = [
  { minCompletionPercent: 0, commissionRatePercent: 0 },
  { minCompletionPercent: 80, commissionRatePercent: 1 },
  { minCompletionPercent: 100, commissionRatePercent: 2 },
]

/** 产品是否计入团队管理提成基数（无配置视为参与） */
export function isProductInTeamMgmtBase(
  upsList: UnitProductSettlement[],
  productId: string,
  unitId: string,
): boolean {
  const ups = upsList.find(
    (x) => x.productId === productId && x.salesUnitId === unitId,
  )
  return !(ups?.excludeFromTeamMgmt)
}

/** 单位当月可计实收（排除不参与产品） */
export function calcTeamMgmtEligibleSales(
  unitId: string,
  salesRecords: SalesRecord[],
  upsList: UnitProductSettlement[],
  yearMonth?: string,
): number {
  const monthly = filterSalesByMonth(salesRecords, yearMonth)
  return monthly
    .filter(
      (s) =>
        s.salesUnitId === unitId
        && isProductInTeamMgmtBase(upsList, s.productId, unitId),
    )
    .reduce((sum, s) => sum + (s.totalAmount || 0), 0)
}

/** 单位整体月目标（personnelId 为空） */
export function getUnitMonthTarget(
  targets: PerformanceTarget[],
  unitId: string,
  yearMonth: string,
): number {
  const t = targets.find(
    (x) =>
      x.salesUnitId === unitId
      && x.yearMonth === yearMonth
      && !x.personnelId,
  )
  return t?.targetAmount || 0
}

/** 按完成率匹配档位（取 minCompletionPercent <= 完成率 的最高档） */
export function matchTeamMgmtTier(
  tiers: TeamMgmtCommissionTier[],
  completionPercent: number,
): TeamMgmtCommissionTier {
  const list = (tiers?.length ? tiers : DEFAULT_TEAM_MGMT_TIERS)
    .slice()
    .sort((a, b) => b.minCompletionPercent - a.minCompletionPercent)
  const hit = list.find((t) => completionPercent >= t.minCompletionPercent)
  return hit || { minCompletionPercent: 0, commissionRatePercent: 0 }
}

export type TeamMgmtCommissionResult = {
  unitId: string
  eligibleSales: number
  targetAmount: number
  completionPercent: number
  commissionRatePercent: number
  pool: number
  allocations: { personnelId: string; weight: number; amount: number }[]
}

/**
 * 计算某单位当月团队管理提成池及按权重分摊
 * 无单位目标时完成率=0、池=0
 */
export function calcUnitTeamMgmtCommission(
  unitId: string,
  yearMonth: string,
  salesRecords: SalesRecord[],
  upsList: UnitProductSettlement[],
  targets: PerformanceTarget[],
  rule?: TeamMgmtCommissionRule,
): TeamMgmtCommissionResult {
  const eligibleSales = calcTeamMgmtEligibleSales(
    unitId, salesRecords, upsList, yearMonth,
  )
  const targetAmount = getUnitMonthTarget(targets, unitId, yearMonth)
  const completionPercent = targetAmount > 0
    ? (eligibleSales / targetAmount) * 100
    : 0
  const tier = matchTeamMgmtTier(rule?.tiers || [], completionPercent)
  const commissionRatePercent = targetAmount > 0
    ? (tier.commissionRatePercent || 0)
    : 0
  const pool = eligibleSales * (commissionRatePercent / 100)
  const managers = (rule?.managers || []).filter((m) => m.weight > 0)
  const totalWeight = managers.reduce((s, m) => s + m.weight, 0)
  const allocations = managers.map((m) => ({
    personnelId: m.personnelId,
    weight: m.weight,
    amount: totalWeight > 0 ? pool * (m.weight / totalWeight) : 0,
  }))
  return {
    unitId,
    eligibleSales,
    targetAmount,
    completionPercent,
    commissionRatePercent,
    pool,
    allocations,
  }
}

/** 某人当月分到的团队管理提成 */
export function getPersonTeamMgmtCommission(
  personnelId: string,
  unitId: string,
  yearMonth: string | undefined,
  salesRecords: SalesRecord[],
  upsList: UnitProductSettlement[],
  targets: PerformanceTarget[],
  rules: TeamMgmtCommissionRule[],
): number {
  if (!yearMonth) return 0
  const rule = rules.find((r) => r.salesUnitId === unitId)
  if (!rule) return 0
  const result = calcUnitTeamMgmtCommission(
    unitId, yearMonth, salesRecords, upsList, targets, rule,
  )
  return result.allocations.find((a) => a.personnelId === personnelId)?.amount || 0
}
