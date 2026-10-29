/** 工资核算本地原型：出勤 + 考核分影响底薪/绩效 */

export const PAYROLL_STANDARD_WORK_DAYS = 21.75

export const PAYROLL_SCOPE_STORAGE_KEY = 'pm_payroll_scope_unit_ids'
export const PAYROLL_ENTRY_STORAGE_KEY = 'pm_payroll_entries'

export interface PayrollMonthEntry {
  personnelId: string
  /** 实际出勤天数，空则默认按满勤 */
  attendanceDays: number | null
  /** 绩效考核分 0–100，空则按 100 分 */
  score: number | null
  otherBonus: number
  otherDeduction: number
  note: string
}

export interface PayrollRowInput {
  personnelId: string
  name: string
  unitId: string
  unitName: string
  standardBaseSalary: number
  standardPerformance: number
  /** 系统业绩提成（个人+内部销售+团队管理） */
  commission: number
  entry: PayrollMonthEntry
}

export interface PayrollRowResult extends PayrollRowInput {
  attendanceDays: number
  attendanceRatio: number
  score: number
  scoreRatio: number
  paidBaseSalary: number
  paidPerformance: number
  payable: number
}

export function isLikelyOpsCenterName(name: string): boolean {
  return /运营中心/.test(name || '')
}

export function loadPayrollScopeUnitIds(): string[] {
  try {
    const raw = localStorage.getItem(PAYROLL_SCOPE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function savePayrollScopeUnitIds(ids: string[]): void {
  localStorage.setItem(PAYROLL_SCOPE_STORAGE_KEY, JSON.stringify(ids))
}

export function loadPayrollEntries(yearMonth: string): Record<string, PayrollMonthEntry> {
  try {
    const raw = localStorage.getItem(PAYROLL_ENTRY_STORAGE_KEY)
    if (!raw) return {}
    const all = JSON.parse(raw) as Record<string, Record<string, PayrollMonthEntry>>
    return all[yearMonth] || {}
  } catch {
    return {}
  }
}

export function savePayrollEntries(
  yearMonth: string,
  entries: Record<string, PayrollMonthEntry>,
): void {
  let all: Record<string, Record<string, PayrollMonthEntry>> = {}
  try {
    const raw = localStorage.getItem(PAYROLL_ENTRY_STORAGE_KEY)
    if (raw) all = JSON.parse(raw)
  } catch {
    all = {}
  }
  all[yearMonth] = entries
  localStorage.setItem(PAYROLL_ENTRY_STORAGE_KEY, JSON.stringify(all))
}

export function createEmptyPayrollEntry(personnelId: string): PayrollMonthEntry {
  return {
    personnelId,
    attendanceDays: null,
    score: null,
    otherBonus: 0,
    otherDeduction: 0,
    note: '',
  }
}

/** 出勤系数：实际出勤 / 应出勤，封顶 1 */
export function getAttendanceRatio(
  attendanceDays: number,
  standardDays = PAYROLL_STANDARD_WORK_DAYS,
): number {
  if (standardDays <= 0) return 0
  return Math.min(1, Math.max(0, attendanceDays / standardDays))
}

/** 考核得分系数：0–100 → 0–1 */
export function getScoreRatio(score: number): number {
  return Math.min(1, Math.max(0, score / 100))
}

export function calcPayrollRow(input: PayrollRowInput): PayrollRowResult {
  const attendanceDays =
    input.entry.attendanceDays == null
      ? PAYROLL_STANDARD_WORK_DAYS
      : Number(input.entry.attendanceDays) || 0
  const score = input.entry.score == null ? 100 : Number(input.entry.score) || 0
  const attendanceRatio = getAttendanceRatio(attendanceDays)
  const scoreRatio = getScoreRatio(score)
  const paidBaseSalary = input.standardBaseSalary * attendanceRatio
  const paidPerformance = input.standardPerformance * attendanceRatio * scoreRatio
  const otherBonus = Number(input.entry.otherBonus) || 0
  const otherDeduction = Number(input.entry.otherDeduction) || 0
  const payable =
    input.commission + paidBaseSalary + paidPerformance + otherBonus - otherDeduction

  return {
    ...input,
    attendanceDays,
    attendanceRatio,
    score,
    scoreRatio,
    paidBaseSalary,
    paidPerformance,
    payable,
  }
}
