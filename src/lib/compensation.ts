import { toDateOnly } from '@/lib/settlement'
import type {
  Personnel,
  PersonnelPayPlan,
  PersonnelRegularCompensation,
  ProductPersonCommission,
  SalaryStructure,
} from '@/types'

const EMPTY_SALARY: SalaryStructure = {
  baseSalary: 0,
  performance: 0,
  performanceCondition: '',
  positionAllowance: 0,
  positionAllowanceCondition: '',
  managementCommissionRate: 0,
  managementCommissionThreshold: 0,
  managementCommissionCondition: '',
  personalCommissionRate: 0,
  personalCommissionThreshold: 0,
  personalCommissionCondition: '',
  internalSalesCommissionType: 'percentage',
  internalSalesCommissionRate: 0,
  internalSalesCommissionAmount: 0,
  internalSalesCommissionThreshold: 0,
  internalSalesCommissionCondition: '',
  internalSalesCommissionRecipientId: '',
}

export type ResolvedPay = {
  salary: SalaryStructure
  socialInsurance: number
  housingFund: number
  /** 当前日期是否落在分销段 */
  isDistribution: boolean
}

function addDays(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00`)
  d.setDate(d.getDate() + delta)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function eachDateInMonth(yearMonth: string): string[] {
  const [y, m] = yearMonth.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const out: string[] = []
  for (let day = 1; day <= last; day += 1) {
    out.push(`${yearMonth}-${String(day).padStart(2, '0')}`)
  }
  return out
}

/** 是否已启用分销分段 */
export function hasDistributionPlan(person: Personnel): boolean {
  return Boolean(toDateOnly(person.highCommissionFrom))
}

/**
 * 某日是否计固定人力成本（底薪/绩效/补贴/社保公积金）
 * - 入职前不计
 * - 离职日次日起不计（离职日含当天仍计）
 * - 分销生效日起不计（含当天）
 */
export function isFixedPayDay(person: Personnel, day: string): boolean {
  const d = toDateOnly(day)
  if (!d) return false
  const hire = toDateOnly(person.hireDate)
  const resign = toDateOnly(person.resignDate)
  const highFrom = toDateOnly(person.highCommissionFrom)
  if (hire && d < hire) return false
  if (resign && d > resign) return false
  if (highFrom && d >= highFrom) return false
  return true
}

/** 指定日是否已进入分销段 */
export function isDistributionDay(person: Personnel, day: string): boolean {
  const highFrom = toDateOnly(person.highCommissionFrom)
  const d = toDateOnly(day)
  if (!highFrom || !d) return false
  return d >= highFrom
}

/** start 含当天；end 为空=当前段；有 end 则 end 不含当天（调薪日归新段） */
export function isPayPlanActiveOn(plan: PersonnelPayPlan, day: string): boolean {
  const d = toDateOnly(day)
  if (!d) return false
  const start = toDateOnly(plan.startDate)
  if (!start || d < start) return false
  const end = toDateOnly(plan.endDate)
  if (end && d >= end) return false
  return true
}

/** 解析某人在 asOfDate 的薪酬段；多段重叠时取 start 最晚的一段 */
export function resolvePayPlanAt(
  person: Personnel,
  asOfDate: string,
): PersonnelPayPlan | null {
  const d = toDateOnly(asOfDate) || asOfDate
  const list = person.payPlans || []
  if (list.length === 0) return null
  const active = list.filter((p) => isPayPlanActiveOn(p, d))
  if (active.length === 0) return null
  active.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
  return active[active.length - 1] || null
}

/**
 * 按「业务日」解析应用哪套固定薪酬
 * - 分销段：用人员当前 salary/社保（一般为 0）
 * - 有薪酬时间轴：用当天生效段（含底薪/绩效/补贴/社保公积金）
 * - 分销前无时间轴：优先用 regularCompensation 快照，否则用当前值
 */
export function resolvePayForDate(person: Personnel, day: string): ResolvedPay {
  const d = toDateOnly(day) || day
  if (isDistributionDay(person, d)) {
    return {
      salary: person.salary || EMPTY_SALARY,
      socialInsurance: person.socialInsurance || 0,
      housingFund: person.housingFund || 0,
      isDistribution: true,
    }
  }
  const plan = resolvePayPlanAt(person, d)
  if (plan) {
    return {
      salary: plan.salary || EMPTY_SALARY,
      socialInsurance: plan.socialInsurance || 0,
      housingFund: plan.housingFund || 0,
      isDistribution: false,
    }
  }
  const snap = person.regularCompensation
  if (snap?.salary) {
    return {
      salary: snap.salary,
      socialInsurance: snap.socialInsurance || 0,
      housingFund: snap.housingFund || 0,
      isDistribution: false,
    }
  }
  return {
    salary: person.salary || EMPTY_SALARY,
    socialInsurance: person.socialInsurance || 0,
    housingFund: person.housingFund || 0,
    isDistribution: false,
  }
}

export type FixedPayMonthTotals = {
  baseSalary: number
  performance: number
  positionAllowance: number
  socialInsurance: number
  housingFund: number
  fixedRatio: number
  /** 计薪日加权后的月薪底薪，用于请假扣款 */
  leaveBaseSalary: number
}

/**
 * 按日历日累加固定人力成本（底薪/绩效/补贴/社保公积金）
 * 月中转正、调薪会按天数拆成两套标准，不会用新薪覆盖整月
 */
export function accumulateFixedPayInMonth(
  person: Personnel,
  yearMonth: string,
  includeDay?: (day: string) => boolean,
): FixedPayMonthTotals {
  const days = eachDateInMonth(yearMonth)
  const calendar = days.length || 1
  let baseSalary = 0
  let performance = 0
  let positionAllowance = 0
  let socialInsurance = 0
  let housingFund = 0
  let fixedDays = 0
  for (const day of days) {
    if (!isFixedPayDay(person, day)) continue
    if (includeDay && !includeDay(day)) continue
    const pay = resolvePayForDate(person, day)
    const s = pay.salary || EMPTY_SALARY
    baseSalary += (Number(s.baseSalary) || 0) / calendar
    performance += (Number(s.performance) || 0) / calendar
    positionAllowance += (Number(s.positionAllowance) || 0) / calendar
    socialInsurance += (Number(pay.socialInsurance) || 0) / calendar
    housingFund += (Number(pay.housingFund) || 0) / calendar
    fixedDays += 1
  }
  const leaveBaseSalary = fixedDays > 0
    ? (baseSalary * calendar) / fixedDays
    : 0
  return {
    baseSalary,
    performance,
    positionAllowance,
    socialInsurance,
    housingFund,
    fixedRatio: fixedDays / calendar,
    leaveBaseSalary,
  }
}

/** 某月固定薪酬按日历日占比（0~1） */
export function getFixedPayRatioInMonth(person: Personnel, yearMonth: string): number {
  const days = eachDateInMonth(yearMonth)
  if (days.length === 0) return 0
  const fixed = days.filter((d) => isFixedPayDay(person, d)).length
  return fixed / days.length
}

/**
 * 取用于计算固定成本的「代表日」薪酬（月内第一个固定计薪日；若无则用月末看快照）
 */
export function resolvePayForMonth(person: Personnel, yearMonth: string): ResolvedPay & {
  fixedRatio: number
} {
  const days = eachDateInMonth(yearMonth)
  const fixedRatio = getFixedPayRatioInMonth(person, yearMonth)
  const firstFixed = days.find((d) => isFixedPayDay(person, d))
  if (firstFixed) {
    return { ...resolvePayForDate(person, firstFixed), fixedRatio }
  }
  // 整月无固定计薪：分销或已离职，用月末规则（金额再乘 ratio=0）
  const last = days[days.length - 1] || `${yearMonth}-01`
  return { ...resolvePayForDate(person, last), fixedRatio }
}

/** 按成交日选择产品提成配置列表（快照 or 当前） */
export function resolvePpcListForSaleDate(
  person: Personnel,
  saleDate: string,
  liveList: ProductPersonCommission[],
): ProductPersonCommission[] {
  if (isDistributionDay(person, saleDate)) {
    return liveList.filter((x) => x.personnelId === person.id)
  }
  const snap = person.regularCompensation?.productCommissions
  if (snap && snap.length > 0) {
    return snap.map((x, idx) => ({
      id: `snap-${person.id}-${idx}`,
      salesUnitId: x.salesUnitId,
      productId: x.productId,
      personnelId: x.personnelId || person.id,
      managementCommissionRate: x.managementCommissionRate || 0,
      managementCommissionThreshold: x.managementCommissionThreshold || 0,
      managementCommissionCondition: x.managementCommissionCondition || '',
      personalCommissionType: x.personalCommissionType || 'percentage',
      personalCommissionRate: x.personalCommissionRate || 0,
      personalCommissionAmount: x.personalCommissionAmount || 0,
      personalCommissionThreshold: x.personalCommissionThreshold || 0,
      personalCommissionCondition: x.personalCommissionCondition || '',
      internalSalesCommissionType: x.internalSalesCommissionType || 'percentage',
      internalSalesCommissionRate: x.internalSalesCommissionRate || 0,
      internalSalesCommissionAmount: x.internalSalesCommissionAmount || 0,
      internalSalesCommissionThreshold: x.internalSalesCommissionThreshold || 0,
      internalSalesCommissionCondition: x.internalSalesCommissionCondition || '',
      internalSalesCommissionRecipientId: x.internalSalesCommissionRecipientId || '',
      rewardAmount: x.rewardAmount || 0,
      rewardFrom: x.rewardFrom || '',
      rewardTo: x.rewardTo || '',
      createdAt: '',
    }))
  }
  return liveList.filter((x) => x.personnelId === person.id)
}

export function dayBefore(ymd: string): string {
  return addDays(toDateOnly(ymd), -1)
}

export function buildRegularCompensationSnapshot(
  person: Personnel,
  ppcList: ProductPersonCommission[],
): PersonnelRegularCompensation {
  return {
    salary: { ...(person.salary || EMPTY_SALARY) },
    socialInsurance: person.socialInsurance || 0,
    housingFund: person.housingFund || 0,
    productCommissions: ppcList
      .filter((x) => x.personnelId === person.id)
      .map((x) => ({
        salesUnitId: x.salesUnitId,
        productId: x.productId,
        personnelId: x.personnelId,
        managementCommissionRate: x.managementCommissionRate || 0,
        managementCommissionThreshold: x.managementCommissionThreshold || 0,
        managementCommissionCondition: x.managementCommissionCondition || '',
        personalCommissionType: x.personalCommissionType || 'percentage',
        personalCommissionRate: x.personalCommissionRate || 0,
        personalCommissionAmount: x.personalCommissionAmount || 0,
        personalCommissionThreshold: x.personalCommissionThreshold || 0,
        personalCommissionCondition: x.personalCommissionCondition || '',
        internalSalesCommissionType: x.internalSalesCommissionType || 'percentage',
        internalSalesCommissionRate: x.internalSalesCommissionRate || 0,
        internalSalesCommissionAmount: x.internalSalesCommissionAmount || 0,
        internalSalesCommissionThreshold: x.internalSalesCommissionThreshold || 0,
        internalSalesCommissionCondition: x.internalSalesCommissionCondition || '',
      internalSalesCommissionRecipientId: x.internalSalesCommissionRecipientId || '',
        rewardAmount: x.rewardAmount || 0,
        rewardFrom: x.rewardFrom || '',
        rewardTo: x.rewardTo || '',
      })),
  }
}
