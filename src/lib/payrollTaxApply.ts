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

/**
 * 本月累计扣税基数 = 上月应纳税所得额 C（优先读上月已保存快照/手工 C）。
 * 无上月快照时退回：期初税基 + Σ(应发−社保−公积金−专项附加)。
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
  const frozenC = readPriorMonthTaxableC(prevEntry)
  if (frozenC != null) return frozenC

  // 上月有录入但尚未落 C 快照：用上月已存应发/代扣拼 C（不改写上月）
  if (prevEntry) {
    const prevPriors = listCarryPriorMonths(prevYm, opening ? throughYm : undefined)
    let base = roundMoney(opening?.taxBase ?? 0)
    if (prevPriors.length > 0) {
      // 再上一月若有冻结 C，则作为上月税基
      const earlierYm = prevPriors[prevPriors.length - 1]
      const earlierEntry = loadPayrollEntries(earlierYm)[person.id]
      const earlierC = readPriorMonthTaxableC(earlierEntry)
      if (earlierC != null) base = earlierC
    }
    const prevPay = Number(prevEntry.payableSnapshot) || 0
    const prevSocial = Number(prevEntry.socialInsurancePersonal) || 0
    const prevHousing = Number(prevEntry.housingFundPersonal) || 0
    const prevSpecial = Number(prevEntry.specialAdditional) || 0
    return roundMoney(base + prevPay - prevSocial - prevHousing - prevSpecial)
  }

  // 上月无工资快照：用期初 + 已有月份累加（含专项附加）兜底
  const prior = sumPriorFromSnapshots(
    person.id,
    yearMonth,
    opening ? throughYm : undefined,
  )
  return opening
    ? roundMoney(
      opening.taxBase
      + prior.cumulativeIncome
      - prior.cumulativeSpecialDeduction
      - prior.cumulativeSpecialAdditional,
    )
    : roundMoney(
      prior.cumulativeIncome
      - prior.cumulativeSpecialDeduction
      - prior.cumulativeSpecialAdditional,
    )
}

/**
 * 本月已预缴 B = 上月 B + 上月本期个税。
 * 优先读上月 taxPaidBeforeSnapshot；否则期初 + 各月本期个税合计。
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
  if (
    prevEntry
    && prevEntry.taxPaidBeforeSnapshot != null
    && Number.isFinite(Number(prevEntry.taxPaidBeforeSnapshot))
  ) {
    return roundMoney(
      Number(prevEntry.taxPaidBeforeSnapshot)
      + getEffectiveIncomeTax(prevEntry),
    )
  }

  return opening
    ? roundMoney(opening.taxPaid + priorTaxPaidSum)
    : roundMoney(priorTaxPaidSum)
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

  // 累计扣税基数 = 上月应纳税所得额 C（首月=期初税基；只读上月快照）
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
