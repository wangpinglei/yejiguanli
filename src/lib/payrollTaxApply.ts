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
  IIT_SEED_THROUGH_YM,
  listPriorMonthsInIitCycle,
  loadTaxProfile,
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
  /** A = ROUND(MAX(C×税率−速算,0),2) */
  cumulativeTaxDue: number
  /** 是否使用了 2025-12 周期期初 */
  usedCycleOpening: boolean
  openingTaxBase: number
  openingTaxPaid: number
  openingTaxable: number | null
}

function sumPriorFromSnapshots(
  personnelId: string,
  yearMonth: string,
  afterYmExclusive?: string,
) {
  const priors = listPriorMonthsInIitCycle(yearMonth).filter((ym) =>
    afterYmExclusive ? ym > afterYmExclusive : true,
  )
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
  const specialAdditional = roundMoney(profileSpecial)

  const cycle = getIitCycleBounds(yearMonth)
  const monthsInYear = getIitCycleMonthIndex(yearMonth)
  const opening = resolveOpening(profile, yearMonth)
  const throughYm = opening?.throughYm

  const prior = sumPriorFromSnapshots(
    person.id,
    yearMonth,
    opening ? throughYm : undefined,
  )

  // 截至上月累计扣税基数（期初 + 期后至上月的应发−个人社保公积金）
  const priorTaxBase = opening
    ? roundMoney(opening.taxBase + prior.cumulativeIncome - prior.cumulativeSpecialDeduction)
    : roundMoney(prior.cumulativeIncome - prior.cumulativeSpecialDeduction)
  const cumulativeTaxBase = priorTaxBase

  // C = 累计扣税基数 + 本月应发 − 个人社保 − 个人公积金 − 本月专项附加合计
  const autoTaxable = roundMoney(
    priorTaxBase
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

  // B = 已预缴个税
  const priorTaxPaid = opening
    ? roundMoney(opening.taxPaid + prior.taxPaidBeforeThisMonth)
    : prior.taxPaidBeforeThisMonth

  // A = ROUND(MAX(C×税率−速算扣除数, 0), 2)
  const cumulativeTaxDue = calcTaxOnCumulativeTaxable(taxable)
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
    cumulativeTaxDue: tax.cumulativeTaxDue,
    taxPaidBeforeThisMonth: tax.cumulativeTaxPaidBefore,
    systemIncomeTax: tax.incomeTax,
    iitOpeningTaxBase: tax.openingTaxBase,
    iitOpeningTaxPaid: tax.openingTaxPaid,
    iitOpeningTaxable: tax.openingTaxable,
    usedIitCycleOpening: tax.usedCycleOpening,
  }
}
