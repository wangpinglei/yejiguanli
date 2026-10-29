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
