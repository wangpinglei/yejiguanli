/** 把个税/代扣应用到工资行 */

import { roundMoney } from '@/lib/format'
import type { PayrollMonthEntry, PayrollRowResult } from '@/lib/payrollCalc'
import { loadPayrollEntries } from '@/lib/payrollCalc'
import {
  calcTaxOnCumulativeTaxable,
  getEffectiveIncomeTax,
  getIitCycleBounds,
  getIitCycleMonthIndex,
  getIitCycleOpening,
  getIitTaxBaseForA,
  IIT_SEED_THROUGH_YM,
  listPriorMonthsInIitCycle,
  loadTaxProfile,
  MONTHLY_BASIC_DEDUCTION,
  resolveSpecialAdditionalMonthly,
  shouldUseIitCycleOpening,
  type IitCycleOpening,
  type PersonnelTaxProfile,
} from '@/lib/payrollTax'
import { resolvePayForDate } from '@/lib/compensation'
import { isPayrollCommissionOnly } from '@/lib/salary'
import type { Personnel } from '@/types'

export type PayrollTaxResolved = {
  socialInsurancePersonal: number
  housingFundPersonal: number
  specialAdditional: number
  /** 系统计算本期个税 */
  incomeTax: number
  /** 实际采用（含覆盖） */
  effectiveTax: number
  netPay: number
  cumulativeIncome: number
  cumulativeTaxPaidBefore: number
  /** 周期内第 N 月（12月=1 … 11月=12） */
  monthsInYear: number
  cycleStartYm: string
  cycleEndYm: string
  /** 截至上月累计扣税基数 */
  cumulativeTaxBase: number
  /** 本期应发（参与自动 C） */
  payableForTax: number
  /**
   * 自动 C = 累计扣税基数 + 本月应发 − 个人社保 − 个人公积金
   * − 本月专项附加合计
   */
  autoTaxable: number
  /** C：应纳税所得额（手工覆盖优先） */
  taxable: number
  /** 累计减除费用 5000×N */
  cumulativeBasicDeduction: number
  /** A 计税税基 = MAX(C−5000×N, 0) */
  taxBaseForA: number
  /** A = ROUND(MAX((C−5000×N)×税率−速算,0),2) */
  cumulativeTaxDue: number
  /** 是否使用了 2025-12 周期期初 */
  usedCycleOpening: boolean
  openingTaxBase: number
  openingTaxPaid: number
  openingTaxable: number | null
}

function listCarryPriorMonths(yearMonth: string, afterYmExclusive?: string) {
  return listPriorMonthsInIitCycle(yearMonth).filter((ym) =>
    afterYmExclusive ? ym > afterYmExclusive : true,
  )
}

function sumPriorFromSnapshots(
  personnelId: string,
  yearMonth: string,
  afterYmExclusive?: string,
) {
  const priors = listCarryPriorMonths(yearMonth, afterYmExclusive)
  let monthsCounted = 0
  let cumulativeIncome = 0
  let cumulativeSpecialDeduction = 0
  let cumulativeSpecialAdditional = 0
  let taxPaidBeforeThisMonth = 0

  for (const ym of priors) {
    const entry = loadPayrollEntries(ym)[personnelId]
    if (!entry) continue
    const payable = Number(entry.payableSnapshot)
    if (!(payable > 0) && !entry.incomeTax && entry.incomeTaxOverride == null) {
      const hasInput =
        entry.attendanceHours != null
        || entry.score != null
        || entry.otherBonus
        || entry.otherDeduction
        || entry.socialInsurancePersonal != null
      if (!hasInput) continue
    }
    monthsCounted += 1
    cumulativeIncome += Number(entry.payableSnapshot) || 0
    cumulativeSpecialDeduction +=
      (Number(entry.socialInsurancePersonal) || 0)
      + (Number(entry.housingFundPersonal) || 0)
    cumulativeSpecialAdditional += Number(entry.specialAdditional) || 0
    // B 结转：上月 B + 上月本期个税 … = 期初已预缴 + 各月本期个税（有效值）
    taxPaidBeforeThisMonth += getEffectiveIncomeTax(entry)
  }

  return {
    monthsCounted,
    cumulativeIncome: roundMoney(cumulativeIncome),
    cumulativeSpecialDeduction: roundMoney(cumulativeSpecialDeduction),
    cumulativeSpecialAdditional: roundMoney(cumulativeSpecialAdditional),
    taxPaidBeforeThisMonth: roundMoney(taxPaidBeforeThisMonth),
  }
}

/** 读取上月已落盘的 C（不重算、不写回上月） */
function readPriorMonthTaxableC(prevEntry: {
  taxableIncomeOverride?: number | null
  taxableIncomeSnapshot?: number
} | undefined): number | null {
  if (!prevEntry) return null
  if (
    prevEntry.taxableIncomeOverride != null
    && Number.isFinite(Number(prevEntry.taxableIncomeOverride))
  ) {
    return roundMoney(Number(prevEntry.taxableIncomeOverride) || 0)
  }
  if (
    prevEntry.taxableIncomeSnapshot != null
    && Number.isFinite(Number(prevEntry.taxableIncomeSnapshot))
  ) {
    return roundMoney(Number(prevEntry.taxableIncomeSnapshot) || 0)
  }
  return null
}

/** 拼上月 C：手工/快照优先；否则 = 上月税基 + 应发 − 社保 − 公积金 − 专项 */
function resolvePriorMonthTaxableC(options: {
  person: Personnel
  prevYm: string
  prevTaxBase: number
  prevEntry: ReturnType<typeof loadPayrollEntries>[string] | undefined
}): number {
  const { prevTaxBase, prevEntry } = options
  const frozenC = readPriorMonthTaxableC(prevEntry)
  if (frozenC != null) return frozenC
  if (!prevEntry) return 0
  const prevPay = Number(prevEntry.payableSnapshot) || 0
  const prevSocial = Number(prevEntry.socialInsurancePersonal) || 0
  const prevHousing = Number(prevEntry.housingFundPersonal) || 0
  const prevSpecial = Number(prevEntry.specialAdditional) || 0
  return roundMoney(prevTaxBase + prevPay - prevSocial - prevHousing - prevSpecial)
}

/** 上月工资表中的累计扣税基数（快照优先，与 10 月表展示一致） */
function resolveMonthTaxBase(options: {
  person: Personnel
  yearMonth: string
  opening: IitCycleOpening | null
  throughYm?: string
}): number {
  const { person, yearMonth, opening, throughYm } = options
  const priors = listCarryPriorMonths(yearMonth, opening ? throughYm : undefined)
  const entry = loadPayrollEntries(yearMonth)[person.id]
  if (
    entry
    && entry.cumulativeTaxBaseSnapshot != null
    && Number.isFinite(Number(entry.cumulativeTaxBaseSnapshot))
  ) {
    return roundMoney(Number(entry.cumulativeTaxBaseSnapshot) || 0)
  }
  // 期初后首月：与表上「累计扣税基数/本月税基」一致 = 期初税基
  if (priors.length === 0) {
    return roundMoney(opening?.taxBase ?? 0)
  }
  // 无快照时再按结转公式回推（不写回）
  return resolveCumulativeTaxBaseFromPriorC({
    person,
    yearMonth,
    opening,
    throughYm,
  })
}

/**
 * 本月累计扣税基数 = 上月累计扣税基数 + 上月应纳税所得额 C。
 * 例：11 月税基 = 10 月表「累计扣税基数」+ 10 月表「应纳税所得额 C」。
 */
function resolveCumulativeTaxBaseFromPriorC(options: {
  person: Personnel
  yearMonth: string
  opening: IitCycleOpening | null
  throughYm?: string
}): number {
  const { person, yearMonth, opening, throughYm } = options
  const priors = listCarryPriorMonths(yearMonth, opening ? throughYm : undefined)
  if (priors.length === 0) {
    return roundMoney(opening?.taxBase ?? 0)
  }

  const prevYm = priors[priors.length - 1]
  const prevEntry = loadPayrollEntries(prevYm)[person.id]
  const prevTaxBase = resolveMonthTaxBase({
    person,
    yearMonth: prevYm,
    opening,
    throughYm,
  })
  const prevC = resolvePriorMonthTaxableC({
    person,
    prevYm,
    prevTaxBase,
    prevEntry,
  })
  return roundMoney(prevTaxBase + prevC)
}

/**
 * 某工资月当时的「已预缴个税 B」（只读，不写回）。
 * - 期初后首月（如 2026-10）：始终 = 期初手工已预缴（opening.taxPaid）
 * - 其后月份：优先该月保存的 taxPaidBeforeSnapshot；否则 = 再上月 B + 再上月本期个税
 */
function resolveMonthPrepaidB(options: {
  person: Personnel
  yearMonth: string
  opening: IitCycleOpening | null
  throughYm?: string
}): number {
  const { person, yearMonth, opening, throughYm } = options
  const priors = listCarryPriorMonths(yearMonth, opening ? throughYm : undefined)
  // 10 月：B = 期初已预缴（跟 10 月表里手工填的「已预缴个税 B」一致）
  if (priors.length === 0) {
    return roundMoney(opening?.taxPaid ?? 0)
  }

  const entry = loadPayrollEntries(yearMonth)[person.id]
  if (
    entry
    && entry.taxPaidBeforeSnapshot != null
    && Number.isFinite(Number(entry.taxPaidBeforeSnapshot))
  ) {
    return roundMoney(Number(entry.taxPaidBeforeSnapshot) || 0)
  }

  // 无快照：B = 上月 B + 上月本期个税（与界面结转口径一致）
  const prevYm = priors[priors.length - 1]
  const prevB = resolveMonthPrepaidB({
    person,
    yearMonth: prevYm,
    opening,
    throughYm,
  })
  const prevEntry = loadPayrollEntries(prevYm)[person.id]
  const prevTax = prevEntry ? getEffectiveIncomeTax(prevEntry) : 0
  return roundMoney(prevB + prevTax)
}

/**
 * 本月已预缴 B = 上月已预缴 B + 上月本期个税。
 * 例：核算 2026-11 → B = 10 月表「已预缴个税 B」+ 10 月「本期个税」。
 */
function resolvePrepaidTaxB(options: {
  person: Personnel
  yearMonth: string
  opening: IitCycleOpening | null
  throughYm?: string
  priorTaxPaidSum: number
}): number {
  const { person, yearMonth, opening, throughYm, priorTaxPaidSum } = options
  const priors = listCarryPriorMonths(yearMonth, opening ? throughYm : undefined)
  if (priors.length === 0) {
    return roundMoney(opening?.taxPaid ?? 0)
  }

  const prevYm = priors[priors.length - 1]
  const prevEntry = loadPayrollEntries(prevYm)[person.id]
  const prevB = resolveMonthPrepaidB({
    person,
    yearMonth: prevYm,
    opening,
    throughYm,
  })
  const prevTax = prevEntry ? getEffectiveIncomeTax(prevEntry) : 0
  const carried = roundMoney(prevB + prevTax)

  // 若上月完全没有工资录入，退回「期初 + 已有月份本期个税合计」
  if (!prevEntry && priorTaxPaidSum > 0) {
    return opening
      ? roundMoney(opening.taxPaid + priorTaxPaidSum)
      : roundMoney(priorTaxPaidSum)
  }
  return carried
}

function resolveOpening(
  profile: PersonnelTaxProfile,
  yearMonth: string,
): IitCycleOpening | null {
  if (!shouldUseIitCycleOpening(yearMonth)) return null
  const cycle = getIitCycleBounds(yearMonth)
  return (
    getIitCycleOpening(profile, cycle.startYm)
    || {
      taxBase: 0,
      taxPaid: 0,
      taxable: null,
      throughYm: IIT_SEED_THROUGH_YM,
    }
  )
}

export function resolvePayrollTax(options: {
  person: Personnel
  yearMonth: string
  payable: number
  entry: PayrollMonthEntry
}): PayrollTaxResolved {
  const { person, yearMonth, payable, entry } = options
  const profile = loadTaxProfile(
    person.id,
    {
      socialInsurance: person.socialInsurance,
      housingFund: person.housingFund,
    },
    person.taxProfile || null,
  )
  const profileSpecial = resolveSpecialAdditionalMonthly(profile)
  const payAtMid = resolvePayForDate(person, `${yearMonth}-15`)
  const defaultSocialPersonal =
    Number(payAtMid.socialInsurancePersonal) || profile.socialInsurancePersonal
  const defaultHousingPersonal =
    Number(payAtMid.housingFundPersonal) || profile.housingFundPersonal

  const commissionOnly = isPayrollCommissionOnly(person, yearMonth)
  const socialInsurancePersonal = commissionOnly
    ? 0
    : roundMoney(
      entry.socialInsurancePersonal != null
        ? Number(entry.socialInsurancePersonal) || 0
        : defaultSocialPersonal,
    )
  const housingFundPersonal = commissionOnly
    ? 0
    : roundMoney(
      entry.housingFundPersonal != null
        ? Number(entry.housingFundPersonal) || 0
        : defaultHousingPersonal,
    )
  // 已保存的本月专项附加优先，避免下月结转时被档案变更冲掉上月数
  const specialAdditional = roundMoney(
    entry.specialAdditional != null
      ? Number(entry.specialAdditional) || 0
      : profileSpecial,
  )

  const cycle = getIitCycleBounds(yearMonth)
  const monthsInYear = getIitCycleMonthIndex(yearMonth)
  const opening = resolveOpening(profile, yearMonth)
  const throughYm = opening?.throughYm

  const prior = sumPriorFromSnapshots(
    person.id,
    yearMonth,
    opening ? throughYm : undefined,
  )

  // 累计扣税基数 = 上月税基 + 上月 C（首月=期初税基）
  const cumulativeTaxBase = resolveCumulativeTaxBaseFromPriorC({
    person,
    yearMonth,
    opening,
    throughYm,
  })

  // C = 累计扣税基数 + 本月应发 − 个人社保 − 个人公积金 − 本月专项附加合计
  const autoTaxable = roundMoney(
    cumulativeTaxBase
    + payable
    - socialInsurancePersonal
    - housingFundPersonal
    - specialAdditional,
  )
  const taxable =
    entry.taxableIncomeOverride != null
    && Number.isFinite(Number(entry.taxableIncomeOverride))
      ? roundMoney(Number(entry.taxableIncomeOverride) || 0)
      : autoTaxable

  // B = 上月 B + 上月本期个税（只读上月快照）
  const priorTaxPaid = resolvePrepaidTaxB({
    person,
    yearMonth,
    opening,
    throughYm,
    priorTaxPaidSum: prior.taxPaidBeforeThisMonth,
  })

  // A = ROUND(MAX((C−5000×N)×税率−速算扣除数, 0), 2)
  const cumulativeBasicDeduction = roundMoney(
    MONTHLY_BASIC_DEDUCTION * monthsInYear,
  )
  const taxBaseForA = getIitTaxBaseForA(taxable, monthsInYear)
  const cumulativeTaxDue = calcTaxOnCumulativeTaxable(taxable, monthsInYear)
  // 本期个税 = max(A − B, 0)
  const incomeTax = roundMoney(Math.max(0, cumulativeTaxDue - priorTaxPaid))

  const effectiveTax = getEffectiveIncomeTax({
    incomeTax,
    incomeTaxOverride: entry.incomeTaxOverride,
  })
  const netPay = roundMoney(
    payable - socialInsurancePersonal - housingFundPersonal - effectiveTax,
  )

  return {
    socialInsurancePersonal,
    housingFundPersonal,
    specialAdditional,
    incomeTax,
    effectiveTax,
    netPay,
    cumulativeIncome: roundMoney(
      (opening ? opening.taxBase : 0)
      + prior.cumulativeIncome
      + payable,
    ),
    cumulativeTaxPaidBefore: priorTaxPaid,
    monthsInYear,
    cycleStartYm: cycle.startYm,
    cycleEndYm: cycle.endYm,
    cumulativeTaxBase,
    payableForTax: roundMoney(payable),
    autoTaxable,
    taxable,
    cumulativeBasicDeduction,
    taxBaseForA,
    cumulativeTaxDue,
    usedCycleOpening: Boolean(opening),
    openingTaxBase: opening?.taxBase ?? 0,
    openingTaxPaid: opening?.taxPaid ?? 0,
    openingTaxable: opening?.taxable ?? null,
  }
}

/** 结转拆解：上月 B/本期个税、上月税基/C（供 11 月等界面核对） */
export function getIitCarryFromPriorMonth(options: {
  person: Personnel
  yearMonth: string
}): {
  priorYm: string
  priorB: number
  priorPeriodTax: number
  priorTaxBase: number
  priorC: number
} | null {
  const { person, yearMonth } = options
  if (!shouldUseIitCycleOpening(yearMonth)) return null
  const profile = loadTaxProfile(
    person.id,
    {
      socialInsurance: person.socialInsurance,
      housingFund: person.housingFund,
    },
    person.taxProfile || null,
  )
  const opening = resolveOpening(profile, yearMonth)
  const throughYm = opening?.throughYm
  const priors = listCarryPriorMonths(yearMonth, opening ? throughYm : undefined)
  if (priors.length === 0) return null
  const priorYm = priors[priors.length - 1]
  const priorEntry = loadPayrollEntries(priorYm)[person.id]
  const priorB = resolveMonthPrepaidB({
    person,
    yearMonth: priorYm,
    opening,
    throughYm,
  })
  const priorPeriodTax = priorEntry ? getEffectiveIncomeTax(priorEntry) : 0
  const priorTaxBase = resolveMonthTaxBase({
    person,
    yearMonth: priorYm,
    opening,
    throughYm,
  })
  const priorC = resolvePriorMonthTaxableC({
    person,
    prevYm: priorYm,
    prevTaxBase: priorTaxBase,
    prevEntry: priorEntry,
  })
  return {
    priorYm,
    priorB: roundMoney(priorB),
    priorPeriodTax: roundMoney(priorPeriodTax),
    priorTaxBase: roundMoney(priorTaxBase),
    priorC: roundMoney(priorC),
  }
}

export function enrichPayrollRowWithTax(
  row: PayrollRowResult,
  person: Personnel,
  yearMonth: string,
  entry: PayrollMonthEntry,
): PayrollRowResult {
  const tax = resolvePayrollTax({
    person,
    yearMonth,
    payable: row.payable,
    entry,
  })
  return {
    ...row,
    socialInsurancePersonal: tax.socialInsurancePersonal,
    housingFundPersonal: tax.housingFundPersonal,
    specialAdditional: tax.specialAdditional,
    incomeTax: tax.effectiveTax,
    netPay: tax.netPay,
    iitCycleMonthIndex: tax.monthsInYear,
    iitCycleStartYm: tax.cycleStartYm,
    iitCycleEndYm: tax.cycleEndYm,
    cumulativeTaxBase: tax.cumulativeTaxBase,
    payableForTax: tax.payableForTax,
    autoTaxableIncome: tax.autoTaxable,
    cumulativeTaxable: tax.taxable,
    cumulativeBasicDeduction: tax.cumulativeBasicDeduction,
    taxBaseForA: tax.taxBaseForA,
    cumulativeTaxDue: tax.cumulativeTaxDue,
    taxPaidBeforeThisMonth: tax.cumulativeTaxPaidBefore,
    systemIncomeTax: tax.incomeTax,
    iitOpeningTaxBase: tax.openingTaxBase,
    iitOpeningTaxPaid: tax.openingTaxPaid,
    iitOpeningTaxable: tax.openingTaxable,
    usedIitCycleOpening: tax.usedCycleOpening,
  }
}
