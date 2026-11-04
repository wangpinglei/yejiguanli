import type { SalesUnit, SalesUnitStatus } from '@/types'

export function isSalesUnitActive(unit: Pick<SalesUnit, 'status'> | null | undefined): boolean {
  if (!unit) return false
  return (unit.status || 'active') !== 'inactive'
}

export function getSalesUnitStatusLabel(status?: SalesUnitStatus | string): string {
  return status === 'inactive' ? '已停用' : '运营中'
}

/** 日常操作可选单位：仅运营中 */
export function filterActiveSalesUnits<T extends Pick<SalesUnit, 'status'>>(units: T[]): T[] {
  return units.filter((u) => isSalesUnitActive(u))
}

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 某月该单位是否仍应计入成本/收入（含月度固定循环）。
 * - 未到开业月：不计
 * - 有停用日：停用当月仍计，次月起不计
 * - 已停用但未填停用日：不计入任何月份（请补停用日以保留停用前历史月）
 */
export function isSalesUnitOperatingInMonth(
  unit: Pick<SalesUnit, 'status' | 'openedAt' | 'closedAt'> | null | undefined,
  yearMonth: string,
): boolean {
  if (!unit || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return false
  const openedYm = (unit.openedAt || '').slice(0, 7)
  if (openedYm && yearMonth < openedYm) return false

  const closedYm = (unit.closedAt || '').slice(0, 7)
  if (closedYm) {
    // 停用当月仍计，次月起停止
    return yearMonth <= closedYm
  }
  if ((unit.status || 'active') === 'inactive') {
    return false
  }
  return true
}
