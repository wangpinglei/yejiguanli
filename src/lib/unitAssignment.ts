import { isFixedPayDay } from '@/lib/compensation'
import { toDateOnly } from '@/lib/settlement'
import type { Personnel, PersonnelUnitAssignment } from '@/types'

function eachDateInMonth(yearMonth: string): string[] {
  const [y, m] = yearMonth.split('-').map(Number)
  if (!y || !m) return []
  const last = new Date(y, m, 0).getDate()
  const out: string[] = []
  for (let day = 1; day <= last; day += 1) {
    out.push(`${yearMonth}-${String(day).padStart(2, '0')}`)
  }
  return out
}

/** start 含当天；end 为空=当前段；有 end 则 end 不含当天（转岗日归新单位） */
export function isAssignmentActiveOn(
  a: PersonnelUnitAssignment,
  day: string,
): boolean {
  const d = toDateOnly(day)
  if (!d) return false
  const start = toDateOnly(a.startDate)
  if (!start || d < start) return false
  const end = toDateOnly(a.endDate)
  if (end && d >= end) return false
  return true
}

/**
 * 解析某人在 asOfDate 的所属单位。
 * 有时间轴则按段查找；否则 fallback 当前 salesUnitId。
 */
export function resolveUnitIdAt(
  person: Personnel,
  asOfDate: string,
): string {
  const d = toDateOnly(asOfDate) || asOfDate
  const list = person.unitAssignments || []
  if (list.length > 0) {
    const hit = list.find((a) => isAssignmentActiveOn(a, d))
    if (hit?.salesUnitId) return hit.salesUnitId
  }
  return person.salesUnitId || ''
}

/** 该月是否在指定单位有归属天数（或无时间轴时看当前单位） */
export function personBelongsToUnitInMonth(
  person: Personnel,
  unitId: string,
  yearMonth?: string,
): boolean {
  if (!yearMonth) {
    return resolveUnitIdAt(person, new Date().toISOString().slice(0, 10)) === unitId
  }
  const list = person.unitAssignments || []
  if (list.length === 0) return person.salesUnitId === unitId
  const days = eachDateInMonth(yearMonth)
  return days.some((d) => resolveUnitIdAt(person, d) === unitId)
}

/**
 * 固定人力成本在该单位的月占比：
 * （在岗且归属该单位的天数）/ 当月日历天数
 */
export function getUnitFixedPayRatioInMonth(
  person: Personnel,
  unitId: string,
  yearMonth: string,
): number {
  const days = eachDateInMonth(yearMonth)
  if (days.length === 0) return 0
  const count = days.filter(
    (d) => isFixedPayDay(person, d) && resolveUnitIdAt(person, d) === unitId,
  ).length
  return count / days.length
}
