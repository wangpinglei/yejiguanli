/**
 * 工资个税：专项附加扣除档案 + 累计预扣预缴
 * 档案主存人员 taxProfile（服务器）；本机 localStorage 仅作迁移兜底。
 */

import { roundMoney } from '@/lib/format'
import { loadPayrollEntries, type PayrollMonthEntry } from '@/lib/payrollCalc'

export const PAYROLL_TAX_PROFILE_KEY = 'pm_personnel_tax_profiles'

/** 住房租金城市档次（元/月） */
export type HousingRentTier = 'tier1500' | 'tier1100' | 'tier800'

/** 住房租金三档：直辖市/省会等 1500；户籍人口超100万市 1100；其他 800 */
export const HOUSING_RENT_TIER_OPTIONS = [
  {
    key: 'tier1500' as const,
    amount: 1500,
    label: '直辖市/省会/计划单列市等',
  },
  {
    key: 'tier1100' as const,
    amount: 1100,
    label: '市辖区户籍人口超过100万',
  },
  {
    key: 'tier800' as const,
    amount: 800,
    label: '市辖区户籍人口不超过100万',
  },
] as const

export const HOUSING_RENT_TIER_AMOUNT: Record<HousingRentTier, number> = {
  tier1500: 1500,
  tier1100: 1100,
  tier800: 800,
}

/** 专项附加扣除固定标准（元/月，除非另行说明） */
export const SPECIAL_ADDITIONAL_STANDARDS = {
  childEducationPerChild: 2000,
  infantCarePerChild: 2000,
  elderOnlyChild: 3000,
  elderNonOnlyChildMax: 1500,
  housingLoanInterest: 1000,
  /** @deprecated 请用 HOUSING_RENT_TIER_AMOUNT；保留兼容旧展示 */
  housingRent: 1100,
  continuingEduDegree: 400,
  continuingEduQualificationYear: 3600,
} as const

export type ContinuingEduMode = 'none' | 'degree' | 'qualification'

export interface SpecialAdditionalDeduction {
  childEducationEnabled: boolean
  childEducationCount: number
  infantCareEnabled: boolean
  infantCareCount: number
  elderSupportEnabled: boolean
  /** 独生子女 → 用 3000；否则用 elderSupportAmount（≤1500） */
  elderIsOnlyChild: boolean
  elderSupportAmount: number
  housingLoanEnabled: boolean
  housingRentEnabled: boolean
  /** 住房租金城市档：1500 / 1100 / 800；缺省按 1100 */
  housingRentTier: HousingRentTier
  continuingEduMode: ContinuingEduMode
  /** 大病医疗本月摊销（一期手工） */
  seriousIllnessMonthly: number
}

export function normalizeHousingRentTier(raw: unknown): HousingRentTier {
  if (raw === 'tier1500' || raw === 'tier1100' || raw === 'tier800') return raw
  const n = Number(raw)
  if (n === 1500) return 'tier1500'
  if (n === 800) return 'tier800'
  return 'tier1100'
}

export function getHousingRentMonthlyAmount(
  special: Pick<SpecialAdditionalDeduction, 'housingRentEnabled' | 'housingRentTier'>,
): number {
  if (!special.housingRentEnabled) return 0
  const tier = normalizeHousingRentTier(special.housingRentTier)
  return HOUSING_RENT_TIER_AMOUNT[tier]
}

export type TaxProfileChangeLog = {
  at: string
  operator: string
  operatorId?: string
  /** 调整后专项附加月额 */
  amount: number
  remark?: string
}

/** 个税周期期初（如 2025-12 周期截至 2026-09） */
export type IitCycleOpening = {
  /** 期初累计扣税基数（其后月份结转为上月 C） */
  taxBase: number
  /** 期初已预扣个税（其后 B=上月B+上月本期个税） */
  taxPaid: number
  /** 应纳税所得额 C；null=不手填 */
  taxable: number | null
  /** 期初截止工资月 */
  throughYm: string
}

export interface PersonnelTaxProfile {
  personnelId: string
  special: SpecialAdditionalDeduction
  /** 社保个人缴纳默认（工资代扣） */
  socialInsurancePersonal: number
  /** 公积金个人缴纳默认 */
  housingFundPersonal: number
  /**
   * 专项附加月额覆盖。有值（含 0）时优先于勾选项合计，用于一键/批量调整。
   * null/undefined = 按 special 勾选项计算。
   */
  specialAdditionalOverride?: number | null
  /** 专项附加一键调整记录 */
  specialAdditionalLogs?: TaxProfileChangeLog[]
  /**
   * 按周期起点存期初，例如 key=`2025-12` → 截至 throughYm 的税基/已扣/C
   */
  iitCycleOpenings?: Record<string, IitCycleOpening>
  updatedAt: string
}

/** 首期手工期初：2025-12 周期，补到 2026-09 */
export const IIT_SEED_CYCLE_START = '2025-12'
export const IIT_SEED_THROUGH_YM = '2026-09'

export function shouldUseIitCycleOpening(yearMonth: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false
  const { startYm } = getIitCycleBounds(yearMonth)
  return startYm === IIT_SEED_CYCLE_START && yearMonth > IIT_SEED_THROUGH_YM
}

/** 期初手工录入月（2026-10）：默认此月改期初 B/税基；有工资/人员编辑权时可在后续月份补录 */
export function isIitOpeningEditMonth(yearMonth: string): boolean {
  if (!shouldUseIitCycleOpening(yearMonth)) return false
  const priorsAfterSeed = listPriorMonthsInIitCycle(yearMonth).filter(
    (ym) => ym > IIT_SEED_THROUGH_YM,
  )
  return priorsAfterSeed.length === 0
}

export function getIitCycleOpening(
  profile: Pick<PersonnelTaxProfile, 'iitCycleOpenings'> | null | undefined,
  cycleStartYm: string = IIT_SEED_CYCLE_START,
): IitCycleOpening | null {
  const raw = profile?.iitCycleOpenings?.[cycleStartYm]
  if (!raw || typeof raw !== 'object') return null
  return {
    taxBase: roundMoney(Number(raw.taxBase) || 0),
    taxPaid: roundMoney(Number(raw.taxPaid) || 0),
    taxable:
      raw.taxable == null || raw.taxable === undefined
        ? null
        : roundMoney(Number(raw.taxable) || 0),
    throughYm: raw.throughYm || IIT_SEED_THROUGH_YM,
  }
}

export function upsertIitCycleOpening(
  profile: PersonnelTaxProfile,
  patch: Partial<IitCycleOpening>,
  cycleStartYm: string = IIT_SEED_CYCLE_START,
): PersonnelTaxProfile {
  const prev = getIitCycleOpening(profile, cycleStartYm) || {
    taxBase: 0,
    taxPaid: 0,
    taxable: null,
    throughYm: IIT_SEED_THROUGH_YM,
  }
  const next: IitCycleOpening = {
    taxBase: patch.taxBase != null ? roundMoney(Number(patch.taxBase) || 0) : prev.taxBase,
    taxPaid: patch.taxPaid != null ? roundMoney(Number(patch.taxPaid) || 0) : prev.taxPaid,
    taxable:
      patch.taxable === undefined
        ? prev.taxable
        : patch.taxable == null
          ? null
          : roundMoney(Number(patch.taxable) || 0),
    throughYm: patch.throughYm || prev.throughYm || IIT_SEED_THROUGH_YM,
  }
  return {
    ...profile,
    iitCycleOpenings: {
      ...(profile.iitCycleOpenings || {}),
      [cycleStartYm]: next,
    },
    updatedAt: new Date().toISOString(),
  }
}

/** 综合所得税率表（累计预扣） */
const IIT_BRACKETS: Array<{ upTo: number; rate: number; quick: number }> = [
  { upTo: 36000, rate: 0.03, quick: 0 },
  { upTo: 144000, rate: 0.1, quick: 2520 },
  { upTo: 300000, rate: 0.2, quick: 16920 },
  { upTo: 420000, rate: 0.25, quick: 31920 },
  { upTo: 660000, rate: 0.3, quick: 52920 },
  { upTo: 960000, rate: 0.35, quick: 85920 },
  { upTo: Infinity, rate: 0.45, quick: 181920 },
]

export const MONTHLY_BASIC_DEDUCTION = 5000

export function createEmptySpecialAdditional(): SpecialAdditionalDeduction {
  return {
    childEducationEnabled: false,
    childEducationCount: 0,
    infantCareEnabled: false,
    infantCareCount: 0,
    elderSupportEnabled: false,
    elderIsOnlyChild: true,
    elderSupportAmount: 0,
    housingLoanEnabled: false,
    housingRentEnabled: false,
    housingRentTier: 'tier1100',
    continuingEduMode: 'none',
    seriousIllnessMonthly: 0,
  }
}

export function createEmptyTaxProfile(
  personnelId: string,
  defaults?: { socialInsurance?: number; housingFund?: number },
): PersonnelTaxProfile {
  return {
    personnelId,
    special: createEmptySpecialAdditional(),
    // 一期：用档案社保/公积金预填个人代扣
    socialInsurancePersonal: Number(defaults?.socialInsurance) || 0,
    housingFundPersonal: Number(defaults?.housingFund) || 0,
    updatedAt: new Date().toISOString(),
  }
}

export function calcSpecialAdditionalMonthly(special: SpecialAdditionalDeduction): number {
  const s = SPECIAL_ADDITIONAL_STANDARDS
  let total = 0
  if (special.childEducationEnabled) {
    total += Math.max(0, Number(special.childEducationCount) || 0) * s.childEducationPerChild
  }
  if (special.infantCareEnabled) {
    total += Math.max(0, Number(special.infantCareCount) || 0) * s.infantCarePerChild
  }
  if (special.elderSupportEnabled) {
    if (special.elderIsOnlyChild) total += s.elderOnlyChild
    else {
      total += Math.min(
        s.elderNonOnlyChildMax,
        Math.max(0, Number(special.elderSupportAmount) || 0),
      )
    }
  }
  // 房贷与租金互斥：同时勾选时优先房贷
  if (special.housingLoanEnabled) total += s.housingLoanInterest
  else total += getHousingRentMonthlyAmount(special)

  if (special.continuingEduMode === 'degree') total += s.continuingEduDegree
  else if (special.continuingEduMode === 'qualification') {
    total += roundMoney(s.continuingEduQualificationYear / 12)
  }

  total += Math.max(0, Number(special.seriousIllnessMonthly) || 0)
  return roundMoney(total)
}

/** 档案专项附加月额：覆盖值优先，否则按勾选项合计 */
export function resolveSpecialAdditionalMonthly(
  profile: Pick<PersonnelTaxProfile, 'special' | 'specialAdditionalOverride'>,
): number {
  if (
    profile.specialAdditionalOverride != null
    && Number.isFinite(Number(profile.specialAdditionalOverride))
  ) {
    return roundMoney(Number(profile.specialAdditionalOverride) || 0)
  }
  return calcSpecialAdditionalMonthly(profile.special || createEmptySpecialAdditional())
}

export function loadAllTaxProfiles(): Record<string, PersonnelTaxProfile> {
  try {
    const raw = localStorage.getItem(PAYROLL_TAX_PROFILE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, PersonnelTaxProfile>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function loadTaxProfile(
  personnelId: string,
  defaults?: { socialInsurance?: number; housingFund?: number },
  serverProfile?: Partial<PersonnelTaxProfile> | null,
): PersonnelTaxProfile {
  const empty = createEmptyTaxProfile(personnelId, defaults)
  if (serverProfile && typeof serverProfile === 'object') {
    return {
      ...empty,
      ...serverProfile,
      special: (() => {
        const merged = {
          ...createEmptySpecialAdditional(),
          ...(serverProfile.special || {}),
        }
        return {
          ...merged,
          housingRentTier: normalizeHousingRentTier(merged.housingRentTier),
        }
      })(),
      personnelId,
      socialInsurancePersonal:
        serverProfile.socialInsurancePersonal != null
          ? Number(serverProfile.socialInsurancePersonal) || 0
          : empty.socialInsurancePersonal,
      housingFundPersonal:
        serverProfile.housingFundPersonal != null
          ? Number(serverProfile.housingFundPersonal) || 0
          : empty.housingFundPersonal,
      specialAdditionalOverride:
        serverProfile.specialAdditionalOverride != null
          ? Number(serverProfile.specialAdditionalOverride)
          : empty.specialAdditionalOverride ?? null,
      specialAdditionalLogs: Array.isArray(serverProfile.specialAdditionalLogs)
        ? serverProfile.specialAdditionalLogs
        : [],
      iitCycleOpenings:
        serverProfile.iitCycleOpenings
        && typeof serverProfile.iitCycleOpenings === 'object'
          ? serverProfile.iitCycleOpenings
          : empty.iitCycleOpenings,
    }
  }
  // 兼容：尚未同步服务器时读本机缓存
  const all = loadAllTaxProfiles()
  const hit = all[personnelId]
  if (hit) {
    return {
      ...empty,
      ...hit,
      special: { ...createEmptySpecialAdditional(), ...(hit.special || {}) },
      personnelId,
    }
  }
  return empty
}

/** @deprecated 请走人员 updatePersonnel({ taxProfile }) 写服务器 */
export function saveTaxProfile(profile: PersonnelTaxProfile): void {
  const all = loadAllTaxProfiles()
  all[profile.personnelId] = {
    ...profile,
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(PAYROLL_TAX_PROFILE_KEY, JSON.stringify(all))
}

export function clearLocalTaxProfile(personnelId: string): void {
  const all = loadAllTaxProfiles()
  if (!(personnelId in all)) return
  delete all[personnelId]
  localStorage.setItem(PAYROLL_TAX_PROFILE_KEY, JSON.stringify(all))
}

export type IitBracketResolved = {
  rate: number
  quick: number
  /** ROUND(MAX(税基×rate−quick, 0), 2) */
  tax: number
}

/**
 * A 计税税基 = MAX(应纳税所得额 C − 5000×N, 0)
 * N = 个税周期内第几个月
 */
export function getIitTaxBaseForA(
  taxableIncome: number,
  monthsInCycle: number,
): number {
  const n = Math.max(0, Math.floor(Number(monthsInCycle) || 0))
  return roundMoney(
    Math.max(0, (Number(taxableIncome) || 0) - MONTHLY_BASIC_DEDUCTION * n),
  )
}

/** 按计税税基命中预扣率表一档 */
export function resolveIitBracket(taxBaseForA: number): IitBracketResolved {
  const t = Math.max(0, Number(taxBaseForA) || 0)
  if (t <= 0) return { rate: 0.03, quick: 0, tax: 0 }
  for (const b of IIT_BRACKETS) {
    if (t <= b.upTo) {
      return {
        rate: b.rate,
        quick: b.quick,
        tax: roundMoney(Math.max(0, t * b.rate - b.quick)),
      }
    }
  }
  const last = IIT_BRACKETS[IIT_BRACKETS.length - 1]
  return {
    rate: last.rate,
    quick: last.quick,
    tax: roundMoney(Math.max(0, t * last.rate - last.quick)),
  }
}

/**
 * A = ROUND(MAX((C−5000×N)×税率−速算扣除数, 0), 2)
 * 若只传 taxable，则视为已扣减除费用的计税税基（兼容旧调用）
 */
export function calcTaxOnCumulativeTaxable(
  taxable: number,
  monthsInCycle?: number,
): number {
  const base =
    monthsInCycle == null
      ? Math.max(0, Number(taxable) || 0)
      : getIitTaxBaseForA(taxable, monthsInCycle)
  return resolveIitBracket(base).tax
}

/**
 * 个税累计周期：应发所属月的「上年12月 → 本年11月」。
 * 例：2026-03 → 2025-12～2026-11；2026-12 → 2026-12～2027-11。
 */
export function getIitCycleBounds(yearMonth: string): {
  startYm: string
  endYm: string
} {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return { startYm: yearMonth, endYm: yearMonth }
  }
  const year = Number(yearMonth.slice(0, 4))
  const month = Number(yearMonth.slice(5, 7))
  if (month === 12) {
    return {
      startYm: `${year}-12`,
      endYm: `${year + 1}-11`,
    }
  }
  return {
    startYm: `${year - 1}-12`,
    endYm: `${year}-11`,
  }
}

/** 入职日期 → YYYY-MM；无法解析则 null */
export function getHireYearMonth(hireDate?: string | null): string | null {
  if (!hireDate) return null
  const s = String(hireDate).trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})/)
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}`
  }
  const slash = s.match(/^(\d{4})\/(\d{1,2})/)
  if (slash) {
    return `${slash[1]}-${String(Number(slash[2])).padStart(2, '0')}`
  }
  return null
}

/**
 * 本工资月在个税周期内的序号 N（用于 5000×N）。
 * - 周期：上年 12 月 → 本年 11 月；12 月起新周期 N 从 1 再计
 * - 起算月 = max(本周期起点, 入职月)；无入职日期则从周期起点计（12月=1…11月=12）
 * - 例：2026-06-28 入职 → 2026-06 N=1 … 2026-10 N=5 … 2026-11 N=6；2026-12 N=1
 */
export function getIitCycleMonthIndex(
  yearMonth: string,
  hireDate?: string | null,
): number {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return 1
  const { startYm } = getIitCycleBounds(yearMonth)
  const hireYm = getHireYearMonth(hireDate)
  let startCountYm = startYm
  if (hireYm && hireYm > startYm) {
    startCountYm = hireYm
  }
  if (yearMonth < startCountYm) return 1
  const y1 = Number(startCountYm.slice(0, 4))
  const m1 = Number(startCountYm.slice(5, 7))
  const y2 = Number(yearMonth.slice(0, 4))
  const m2 = Number(yearMonth.slice(5, 7))
  const n = (y2 - y1) * 12 + (m2 - m1) + 1
  return Math.max(1, Math.min(12, n))
}

function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const year = Number(yearMonth.slice(0, 4))
  const month = Number(yearMonth.slice(5, 7))
  const total = year * 12 + (month - 1) + deltaMonths
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/** 本周期内、早于当前工资月的 yearMonth 列表 */
export function listPriorMonthsInIitCycle(yearMonth: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return []
  const { startYm } = getIitCycleBounds(yearMonth)
  const list: string[] = []
  let cursor = startYm
  while (cursor < yearMonth) {
    list.push(cursor)
    cursor = shiftYearMonth(cursor, 1)
  }
  return list
}

/** @deprecated 请用 listPriorMonthsInIitCycle（12月–次年11月周期） */
export function listPriorMonthsInYear(yearMonth: string): string[] {
  return listPriorMonthsInIitCycle(yearMonth)
}

export type CumulativeTaxInput = {
  /** 含本月的累计收入（应发） */
  cumulativeIncome: number
  /** 累计专项扣除：社保个人+公积金个人 */
  cumulativeSpecialDeduction: number
  /** 累计专项附加扣除 */
  cumulativeSpecialAdditional: number
  /** 累计减除费用：5000 × 周期内月序号 */
  cumulativeBasicDeduction: number
  /** 本周期截至上月已预扣个税 B */
  taxPaidBeforeThisMonth: number
}

export type IitCalcDetail = {
  /** 累计扣税基数 = Σ(应发 − 个人社保 − 个人公积金) */
  cumulativeTaxBase: number
  /** C 累计预缴应纳税所得额 */
  taxable: number
  /** A 累计应扣税金额 */
  cumulativeTaxDue: number
  /** B 已预缴 */
  taxPaidBefore: number
  /** 本月应扣 = max(A−B, 0) */
  currentMonthTax: number
}

export function calcIitDetail(input: CumulativeTaxInput): IitCalcDetail {
  const cumulativeTaxBase = roundMoney(
    input.cumulativeIncome - input.cumulativeSpecialDeduction,
  )
  const taxable = roundMoney(
    cumulativeTaxBase
    - input.cumulativeSpecialAdditional
    - input.cumulativeBasicDeduction,
  )
  const cumulativeTaxDue = calcTaxOnCumulativeTaxable(taxable)
  const taxPaidBefore = roundMoney(input.taxPaidBeforeThisMonth || 0)
  const currentMonthTax = roundMoney(Math.max(0, cumulativeTaxDue - taxPaidBefore))
  return {
    cumulativeTaxBase,
    taxable,
    cumulativeTaxDue,
    taxPaidBefore,
    currentMonthTax,
  }
}

export function calcCurrentMonthIit(input: CumulativeTaxInput): number {
  return calcIitDetail(input).currentMonthTax
}

export type MonthTaxSnapshot = {
  payable: number
  socialPersonal: number
  housingPersonal: number
  specialAdditional: number
  tax: number
}

/**
 * 从 localStorage 工资录入汇总某人本年截至上月的累计（仅统计有录入或有税字段的月份）
 * payableByMonth: 调用方传入各月应发（因应发依赖系统提成，需在页面侧算好）
 */
export function sumPriorYearTaxBase(
  personnelId: string,
  yearMonth: string,
  payableByMonth: Record<string, number>,
): {
  monthsCounted: number
  cumulativeIncome: number
  cumulativeSpecialDeduction: number
  cumulativeSpecialAdditional: number
  taxPaidBeforeThisMonth: number
} {
  const priors = listPriorMonthsInIitCycle(yearMonth)
  let monthsCounted = 0
  let cumulativeIncome = 0
  let cumulativeSpecialDeduction = 0
  let cumulativeSpecialAdditional = 0
  let taxPaidBeforeThisMonth = 0

  for (const ym of priors) {
    const entries = loadPayrollEntries(ym)
    const entry = entries[personnelId]
    const payable = Number(payableByMonth[ym])
    if (!entry && !(payable > 0)) continue
    monthsCounted += 1
    cumulativeIncome += payable || 0
    if (entry) {
      cumulativeSpecialDeduction +=
        (Number(entry.socialInsurancePersonal) || 0)
        + (Number(entry.housingFundPersonal) || 0)
      cumulativeSpecialAdditional += Number(entry.specialAdditional) || 0
      const tax = entry.incomeTaxOverride != null && entry.incomeTaxOverride !== undefined
        ? Number(entry.incomeTaxOverride) || 0
        : Number(entry.incomeTax) || 0
      taxPaidBeforeThisMonth += tax
    }
  }

  return {
    monthsCounted,
    cumulativeIncome: roundMoney(cumulativeIncome),
    cumulativeSpecialDeduction: roundMoney(cumulativeSpecialDeduction),
    cumulativeSpecialAdditional: roundMoney(cumulativeSpecialAdditional),
    taxPaidBeforeThisMonth: roundMoney(taxPaidBeforeThisMonth),
  }
}

/** 扩展工资月录入上的个税字段类型（与 PayrollMonthEntry 合并使用） */
export type PayrollTaxEntryFields = {
  socialInsurancePersonal: number | null
  housingFundPersonal: number | null
  specialAdditional: number | null
  /** 系统算得的本期个税 */
  incomeTax: number
  /** 手工覆盖；null=用系统值 */
  incomeTaxOverride: number | null
}

export function getEffectiveIncomeTax(entry: Pick<PayrollMonthEntry, 'incomeTax' | 'incomeTaxOverride'>): number {
  if (entry.incomeTaxOverride != null && entry.incomeTaxOverride !== undefined) {
    return roundMoney(Number(entry.incomeTaxOverride) || 0)
  }
  return roundMoney(Number(entry.incomeTax) || 0)
}
