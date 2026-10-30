/** 工资核算本地原型：出勤小时 + 考核分影响底薪/绩效；保密费/岗位补贴不受考勤影响 */

import { MONTHLY_STANDARD_HOURS, WORK_HOURS_PER_DAY } from '@/lib/salary'

/** 月应出勤小时 = 21.75 × 7.5 */
export const PAYROLL_STANDARD_HOURS = MONTHLY_STANDARD_HOURS

/** @deprecated 请用 PAYROLL_STANDARD_HOURS */
export const PAYROLL_STANDARD_WORK_DAYS = MONTHLY_STANDARD_HOURS / WORK_HOURS_PER_DAY

export const PAYROLL_SCOPE_STORAGE_KEY = 'pm_payroll_scope_unit_ids'
export const PAYROLL_ENTRY_STORAGE_KEY = 'pm_payroll_entries'

export interface PayrollMonthEntry {
  personnelId: string
  /** 实际出勤小时，空则默认按满勤 */
  attendanceHours: number | null
  /** @deprecated 旧字段（天），读取时按 ×7.5 迁到 attendanceHours */
  attendanceDays?: number | null
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
  /** 标准保密费（不受考勤影响） */
  standardConfidentialityFee: number
  /** 标准岗位补贴（不受考勤影响） */
  standardPositionAllowance: number
  standardPerformance: number
  /** 系统业绩提成（个人+内部销售+团队管理） */
  commission: number
  entry: PayrollMonthEntry
}

export interface PayrollRowResult extends PayrollRowInput {
  attendanceHours: number
  attendanceRatio: number
  score: number
  scoreRatio: number
  paidBaseSalary: number
  paidConfidentialityFee: number
  paidPositionAllowance: number
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

/** 兼容旧「出勤天数」字段：有 hours 用 hours，否则天数 × 7.5 */
export function normalizePayrollEntry(
  personnelId: string,
  raw?: Partial<PayrollMonthEntry> | null,
): PayrollMonthEntry {
  const base = createEmptyPayrollEntry(personnelId)
  if (!raw) return base

  let attendanceHours: number | null =
    raw.attendanceHours === undefined || raw.attendanceHours === null
      ? null
      : Number(raw.attendanceHours)

  if (
    (attendanceHours === null || Number.isNaN(attendanceHours)) &&
    raw.attendanceDays != null &&
    raw.attendanceDays !== undefined
  ) {
    const days = Number(raw.attendanceDays)
    attendanceHours = Number.isFinite(days) ? days * WORK_HOURS_PER_DAY : null
  }
  if (attendanceHours != null && Number.isNaN(attendanceHours)) {
    attendanceHours = null
  }

  return {
    personnelId,
    attendanceHours,
    score: raw.score === undefined ? null : raw.score,
    otherBonus: Number(raw.otherBonus) || 0,
    otherDeduction: Number(raw.otherDeduction) || 0,
    note: raw.note || '',
  }
}

export function loadPayrollEntries(yearMonth: string): Record<string, PayrollMonthEntry> {
  try {
    const raw = localStorage.getItem(PAYROLL_ENTRY_STORAGE_KEY)
    if (!raw) return {}
    const all = JSON.parse(raw) as Record<string, Record<string, Partial<PayrollMonthEntry>>>
    const month = all[yearMonth] || {}
    const result: Record<string, PayrollMonthEntry> = {}
    for (const [pid, entry] of Object.entries(month)) {
      result[pid] = normalizePayrollEntry(pid, entry)
    }
    return result
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
  const cleaned: Record<string, PayrollMonthEntry> = {}
  for (const [pid, entry] of Object.entries(entries)) {
    cleaned[pid] = normalizePayrollEntry(pid, entry)
  }
  all[yearMonth] = cleaned
  localStorage.setItem(PAYROLL_ENTRY_STORAGE_KEY, JSON.stringify(all))
}

export function createEmptyPayrollEntry(personnelId: string): PayrollMonthEntry {
  return {
    personnelId,
    attendanceHours: null,
    score: null,
    otherBonus: 0,
    otherDeduction: 0,
    note: '',
  }
}

/** 出勤系数：实际小时 / 应出勤小时，封顶 1 */
export function getAttendanceRatio(
  attendanceHours: number,
  standardHours = PAYROLL_STANDARD_HOURS,
): number {
  if (standardHours <= 0) return 0
  return Math.min(1, Math.max(0, attendanceHours / standardHours))
}

/** 考核得分系数：0–100 → 0–1 */
export function getScoreRatio(score: number): number {
  return Math.min(1, Math.max(0, score / 100))
}

export function calcPayrollRow(input: PayrollRowInput): PayrollRowResult {
  const entry = normalizePayrollEntry(input.personnelId, input.entry)
  const attendanceHours =
    entry.attendanceHours == null
      ? PAYROLL_STANDARD_HOURS
      : Number(entry.attendanceHours) || 0
  const score = entry.score == null ? 100 : Number(entry.score) || 0
  const attendanceRatio = getAttendanceRatio(attendanceHours)
  const scoreRatio = getScoreRatio(score)
  const paidBaseSalary = input.standardBaseSalary * attendanceRatio
  const paidConfidentialityFee = Number(input.standardConfidentialityFee) || 0
  const paidPositionAllowance = Number(input.standardPositionAllowance) || 0
  const paidPerformance = input.standardPerformance * attendanceRatio * scoreRatio
  const otherBonus = Number(entry.otherBonus) || 0
  const otherDeduction = Number(entry.otherDeduction) || 0
  const payable =
    input.commission
    + paidBaseSalary
    + paidConfidentialityFee
    + paidPositionAllowance
    + paidPerformance
    + otherBonus
    - otherDeduction

  return {
    ...input,
    entry,
    attendanceHours,
    attendanceRatio,
    score,
    scoreRatio,
    paidBaseSalary,
    paidConfidentialityFee,
    paidPositionAllowance,
    paidPerformance,
    payable,
  }
}

/** 按单位汇总工资表应发（用于成本「工资表」口径） */
export function sumPayrollPayableByUnit(
  rows: Array<Pick<PayrollRowResult, 'unitId' | 'payable'>>,
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[row.unitId] = (map[row.unitId] || 0) + (Number(row.payable) || 0)
  }
  return map
}

export function hasPayrollEntriesForMonth(yearMonth: string): boolean {
  const entries = loadPayrollEntries(yearMonth)
  return Object.keys(entries).length > 0
}
