/** 把个税/代扣应用到工资行 */

import { roundMoney } from '@/lib/format'
import type { PayrollMonthEntry, PayrollRowResult } from '@/lib/payrollCalc'
import { loadPayrollEntries } from '@/lib/payrollCalc'
import {
  calcIitDetail,
  getEffectiveIncomeTax,
  getIitCycleBounds,
  getIitCycleMonthIndex,
  listPriorMonthsInIitCycle,
  loadTaxProfile,
  MONTHLY_BASIC_DEDUCTION,
  resolveSpecialAdditionalMonthly,
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
  /** 累计扣税基数 */
  cumulativeTaxBase: number
  /** C */
  taxable: number
  /** A */
  cumulativeTaxDue: number
}

function sumPriorFromSnapshots(personnelId: string, yearMonth: string) {
  const priors = listPriorMonthsInIitCycle(yearMonth)
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
  // 个人代扣：本月录入 > 当月生效薪酬方案 > 个税扣除档案
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
  // 方案个人代扣优先；旧方案为 0 时回退档案（兼容未拆分前的数据）
  const defaultSocialPersonal =
    Number(payAtMid.socialInsurancePersonal) || profile.socialInsurancePersonal
  const defaultHousingPersonal =
    Number(payAtMid.housingFundPersonal) || profile.housingFundPersonal

  // 非内部/仅提成：不代扣社保公积金个人部分
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
  // 专项附加只认人员档案（覆盖额或勾选项合计），不认本月录入覆盖
  const specialAdditional = roundMoney(profileSpecial)

  const prior = sumPriorFromSnapshots(person.id, yearMonth)
  const cycle = getIitCycleBounds(yearMonth)
  const monthsInYear = getIitCycleMonthIndex(yearMonth)
  const cumulativeIncome = roundMoney(prior.cumulativeIncome + payable)
  const cumulativeSpecialDeduction = roundMoney(
    prior.cumulativeSpecialDeduction + socialInsurancePersonal + housingFundPersonal,
  )
  const cumulativeSpecialAdditional = roundMoney(
    prior.cumulativeSpecialAdditional + specialAdditional,
  )
  const detail = calcIitDetail({
    cumulativeIncome,
    cumulativeSpecialDeduction,
    cumulativeSpecialAdditional,
    cumulativeBasicDeduction: MONTHLY_BASIC_DEDUCTION * monthsInYear,
    taxPaidBeforeThisMonth: prior.taxPaidBeforeThisMonth,
  })
  const incomeTax = detail.currentMonthTax

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
    cycleStartYm: cycle.startYm,
    cycleEndYm: cycle.endYm,
    cumulativeTaxBase: detail.cumulativeTaxBase,
    taxable: detail.taxable,
    cumulativeTaxDue: detail.cumulativeTaxDue,
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
    cumulativeTaxable: tax.taxable,
    cumulativeTaxDue: tax.cumulativeTaxDue,
    taxPaidBeforeThisMonth: tax.cumulativeTaxPaidBefore,
    systemIncomeTax: tax.incomeTax,
  }
}
