/** 月度固定（循环）记录：按适用月份 + 起止区间判断是否计入某月 */

export type RecurringLike = {
  date: string
  isRecurring?: boolean
  recurringMonths?: number[]
  recurringStartDate?: string
  recurringEndDate?: string
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** 记录是否应计入指定年月（YYYY-MM） */
export function matchesRecurringYearMonth(
  record: RecurringLike,
  yearMonth: string,
): boolean {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return false
  const monthNum = parseInt(yearMonth.slice(5, 7), 10)

  if (!record.isRecurring) {
    return (record.date || '').slice(0, 7) === yearMonth
  }

  const months = record.recurringMonths?.length
    ? record.recurringMonths
    : ALL_MONTHS
  if (!months.includes(monthNum)) return false

  const startYm = (record.recurringStartDate || record.date || '').slice(0, 7)
  if (startYm && yearMonth < startYm) return false

  const endYm = (record.recurringEndDate || '').slice(0, 7)
  if (endYm && yearMonth > endYm) return false

  return true
}

/** 展开循环记录在起止区间内命中的所有 YYYY-MM（结束日缺省为 endCapYm） */
export function listRecurringYearMonths(
  record: RecurringLike,
  endCapYm: string,
): string[] {
  if (!record.isRecurring) {
    const ym = (record.date || '').slice(0, 7)
    return ym ? [ym] : []
  }

  const startYm = (record.recurringStartDate || record.date || '').slice(0, 7)
  if (!startYm) return []
  const endYm = (record.recurringEndDate || '').slice(0, 7) || endCapYm
  const months = record.recurringMonths?.length
    ? record.recurringMonths
    : ALL_MONTHS

  const result: string[] = []
  let y = parseInt(startYm.slice(0, 4), 10)
  let m = parseInt(startYm.slice(5, 7), 10)
  const ey = parseInt(endYm.slice(0, 4), 10)
  const em = parseInt(endYm.slice(5, 7), 10)
  let guard = 0
  while (y < ey || (y === ey && m <= em)) {
    if (months.includes(m)) {
      result.push(`${y}-${String(m).padStart(2, '0')}`)
    }
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
    guard += 1
    if (guard > 240) break
  }
  return result
}

export { ALL_MONTHS as RECURRING_ALL_MONTHS }
