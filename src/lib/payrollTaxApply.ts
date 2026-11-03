/** 把个税/代扣应用到工资行 */

import { roundMoney } from '@/lib/format'
import type { PayrollMonthEntry, PayrollRowResult } from '@/lib/payrollCalc'
import { loadPayrollEntries } from '@/lib/payrollCalc'
import {
  calcCurrentMonthIit,
  calcSpecialAdditionalMonthly,
  getEffectiveIncomeTax,
  listPriorMonthsInYear,
  loadTaxProfile,
  MONTHLY_BASIC_DEDUCTION,
} from '@/lib/payrollTax'
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
  monthsInYear: number
}

function sumPriorFromSnapshots(personnelId: string, yearMonth: string) {
  const priors = listPriorMonthsInYear(yearMonth)
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
      // 有录入出勤等也算一个月
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

export function resolvePayrollTax(options: {
  person: Personnel
  yearMonth: string
  payable: number
  entry: PayrollMonthEntry
}): PayrollTaxResolved {
  const { person, yearMonth, payable, entry } = options
  const profile = loadTaxProfile(person.id, {
    socialInsurance: person.socialInsurance,
    housingFund: person.housingFund,
  })
  const profileSpecial = calcSpecialAdditionalMonthly(profile.special)

  const socialInsurancePersonal = roundMoney(
    entry.socialInsurancePersonal != null
      ? Number(entry.socialInsurancePersonal) || 0
      : profile.socialInsurancePersonal,
  )
  const housingFundPersonal = roundMoney(
    entry.housingFundPersonal != null
      ? Number(entry.housingFundPersonal) || 0
      : profile.housingFundPersonal,
  )
  const specialAdditional = roundMoney(
    entry.specialAdditional != null
      ? Number(entry.specialAdditional) || 0
      : profileSpecial,
  )

  const prior = sumPriorFromSnapshots(person.id, yearMonth)
  const monthsInYear = prior.monthsCounted + 1
  const cumulativeIncome = roundMoney(prior.cumulativeIncome + payable)
  const incomeTax = calcCurrentMonthIit({
    cumulativeIncome,
    cumulativeSpecialDeduction: roundMoney(
      prior.cumulativeSpecialDeduction + socialInsurancePersonal + housingFundPersonal,
    ),
    cumulativeSpecialAdditional: roundMoney(
      prior.cumulativeSpecialAdditional + specialAdditional,
    ),
    cumulativeBasicDeduction: MONTHLY_BASIC_DEDUCTION * monthsInYear,
    taxPaidBeforeThisMonth: prior.taxPaidBeforeThisMonth,
  })

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
    cumulativeIncome,
    cumulativeTaxPaidBefore: prior.taxPaidBeforeThisMonth,
    monthsInYear,
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
  }
}
