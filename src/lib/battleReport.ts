/**
 * 单位战报计算（与 SalesBattleReport 页同口径）
 */
import {
  filterByMonth,
  getPersonalSales,
  shouldShowOnBattleReport,
  wasEmployedInMonth,
  EMPTY_SALARY,
} from '@/lib/salary'
import { personBelongsToUnitInMonth } from '@/lib/unitAssignment'
import type { Personnel, PerformanceTarget, SalesRecord } from '@/types'

export type PositionGroupMatch = {
  keyword: string
  label: string
  color?: string
} | null

export type BattleReportRow = {
  personId: string
  name: string
  position: string
  targetAmount: number | null
  personalSales: number
  diff: number
  completionRate: number
  positionMatch: PositionGroupMatch
  isExternalPerson: boolean
}

export type UnitBattleReport = {
  salesUnitId: string
  salesUnitName: string
  yearMonth: string
  rows: BattleReportRow[]
  totalTarget: number
  battlePersonalSalesTotal: number
  teamTotal: number
  unitTargetAmount: number
  effectiveTeamTarget: number
  teamDiff: number
  effectiveTeamCompletionRate: number
  targetGap: number
}

export type MatchPositionFn = (position: string) => PositionGroupMatch

function getUnitPersonnel(
  personnel: Personnel[],
  salesRecords: SalesRecord[],
  unitId: string,
  yearMonth: string,
): Personnel[] {
  const monthUnitSales = filterByMonth(salesRecords, yearMonth).filter(
    (r) => r.salesUnitId === unitId,
  )
  return personnel.filter((p) => {
    const belongs = personBelongsToUnitInMonth(p, unitId, yearMonth)
    const hasSales = getPersonalSales(p.id, monthUnitSales, p.name) > 0
    if (!belongs && !hasSales) return false
    if (belongs && wasEmployedInMonth(p, yearMonth)) return true
    return hasSales
  })
}

/**
 * 计算单个销售单位的战报表数据
 */
export function buildUnitBattleReport(options: {
  salesUnitId: string
  salesUnitName: string
  yearMonth: string
  personnel: Personnel[]
  salesRecords: SalesRecord[]
  performanceTargets: PerformanceTarget[]
  matchPositionLabel: MatchPositionFn
}): UnitBattleReport {
  const {
    salesUnitId,
    salesUnitName,
    yearMonth,
    personnel,
    salesRecords,
    performanceTargets,
    matchPositionLabel,
  } = options

  const unitPersonnel = getUnitPersonnel(personnel, salesRecords, salesUnitId, yearMonth)
  const monthUnitSales = filterByMonth(salesRecords, yearMonth).filter(
    (r) => r.salesUnitId === salesUnitId,
  )
  // 销售岗 + 当月有业绩的其他岗位（如服务中心）
  const battlePersonnel = unitPersonnel.filter((p) =>
    shouldShowOnBattleReport(p, monthUnitSales),
  )
  const unitMonthlyRecords = monthUnitSales
  const teamTotal = unitMonthlyRecords.reduce((sum, r) => sum + r.totalAmount, 0)

  const unitTarget = performanceTargets.find(
    (t) => t.salesUnitId === salesUnitId && t.yearMonth === yearMonth && !t.personnelId,
  )
  const unitTargetAmount = unitTarget?.targetAmount || 0

  const personnelTargets = new Map<string, number>()
  performanceTargets.forEach((t) => {
    if (t.salesUnitId === salesUnitId && t.yearMonth === yearMonth && t.personnelId) {
      personnelTargets.set(t.personnelId, t.targetAmount)
    }
  })

  const rows: BattleReportRow[] = battlePersonnel.map((p) => {
    const personalSales = getPersonalSales(p.id, unitMonthlyRecords, p.name)
    const targetAmount = personnelTargets.get(p.id)
    const hasTarget = targetAmount !== undefined
    const diff = hasTarget ? personalSales - (targetAmount as number) : 0
    const completionRate =
      hasTarget && (targetAmount as number) > 0
        ? (personalSales / (targetAmount as number)) * 100
        : 0
    return {
      personId: p.id,
      name: p.name,
      position: p.position || '',
      targetAmount: hasTarget ? (targetAmount as number) : null,
      personalSales,
      diff,
      completionRate,
      positionMatch: matchPositionLabel(p.position || ''),
      isExternalPerson: false,
    }
  })

  const externalRecords = unitMonthlyRecords.filter(
    (r) => !r.personnelId && r.salesPersonName && r.salesPersonName.trim(),
  )
  const externalMap = new Map<string, number>()
  externalRecords.forEach((r) => {
    const name = r.salesPersonName!.trim()
    if (battlePersonnel.some((p) => p.name === name)) return
    externalMap.set(name, (externalMap.get(name) || 0) + r.totalAmount)
  })

  const existingNames = new Set(unitPersonnel.map((p) => p.name))
  externalMap.forEach((sales, name) => {
    if (existingNames.has(name)) return
    rows.push({
      personId: `ext_${name}`,
      name,
      position: '外援',
      targetAmount: null,
      personalSales: sales,
      diff: 0,
      completionRate: 0,
      positionMatch: matchPositionLabel('外援'),
      isExternalPerson: true,
    })
  })

  const totalTarget = rows.reduce((sum, row) => sum + (row.targetAmount || 0), 0)
  const battlePersonalSalesTotal = rows.reduce((sum, row) => sum + row.personalSales, 0)
  const effectiveTeamTarget = totalTarget > 0 ? totalTarget : unitTargetAmount
  const teamDiff = effectiveTeamTarget > 0 ? teamTotal - effectiveTeamTarget : 0
  const effectiveTeamCompletionRate =
    effectiveTeamTarget > 0 ? (teamTotal / effectiveTeamTarget) * 100 : 0
  const targetGap = unitTarget ? unitTargetAmount - totalTarget : 0

  void EMPTY_SALARY

  return {
    salesUnitId,
    salesUnitName,
    yearMonth,
    rows,
    totalTarget,
    battlePersonalSalesTotal,
    teamTotal,
    unitTargetAmount,
    effectiveTeamTarget,
    teamDiff,
    effectiveTeamCompletionRate,
    targetGap,
  }
}
