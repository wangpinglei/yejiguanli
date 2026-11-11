import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ExcelJS from 'exceljs'

import { Calculator, CheckSquare, FileSpreadsheet, Pencil, Save } from 'lucide-react'

import { PageHeader } from '@/components/PageHeader'
import ViewerWatermark from '@/components/ViewerWatermark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useData } from '@/context/DataContext'
import { usePermissions } from '@/hooks/usePermissions'
import {
  commissionOrderAdjApi,
  payrollEntriesApi,
  payrollUnitScoreRulesApi,
  type PayrollEntriesMonthPayload,
} from '@/lib/api'
import { hydrateCommissionOrderAdjScopes } from '@/lib/commissionOrderAdj'
import { formatCurrency, formatDateTime, formatDisplayPersonName } from '@/lib/format'
import {
  calcPayrollRow,
  createEmptyPayrollEntry,
  formatAdjLinesComment,
  formatAdjLinesNote,
  loadPayrollEntries,
  loadPayrollScopeUnitIds,
  normalizePayrollEntry,
  PAYROLL_STANDARD_HOURS,
  savePayrollEntries,
  savePayrollScopeUnitIds,
  type PayrollMonthEntry,
  type PayrollRowResult,
} from '@/lib/payrollCalc'
import { resolvePayForDate } from '@/lib/compensation'
import {
  formatScoreRuleSummary,
  normalizeScoreRuleItems,
  resolveScoreFromItems,
  type PayrollScoreRuleItem,
} from '@/lib/payrollScoreRules'
import MPayrollAdjCell from '@/pages/Payroll/components/m-payroll-adj-cell'
import MInsurancePersonalDialog from '@/pages/Payroll/components/m-insurance-personal-dialog'
import MPayrollEntryLinks, {
  type PayrollCalcPhase,
  type PayrollEntryMode,
} from '@/pages/Payroll/components/m-payroll-entry-links'
import MPayrollScoreRuleDialog from '@/pages/Payroll/components/m-payroll-score-rule-dialog'
import MSpecialAdditionalDialog from '@/pages/Payroll/components/m-special-additional-dialog'
import MPayPlanDialog from '@/pages/Personnel/components/m-pay-plan-dialog'
import { resolvePayrollCommissionTotal } from '@/lib/payrollCommissionDetail'
import {
  enrichPayrollRowWithTax,
  getIitCarryFromPriorMonth,
  resolvePayrollTax,
} from '@/lib/payrollTaxApply'
import {
  getIitCycleBounds,
  getIitTaxBaseForA,
  IIT_SEED_THROUGH_YM,
  isIitOpeningEditMonth,
  loadTaxProfile,
  MONTHLY_BASIC_DEDUCTION,
  resolveIitBracket,
  resolveSpecialAdditionalMonthly,
  shouldUseIitCycleOpening,
  upsertIitCycleOpening,
  type PersonnelTaxProfile,
} from '@/lib/payrollTax'
import type { Personnel } from '@/types'
import {
  calculateMonthlySalary,
  filterByMonth,
  getPersonalSales,
  isPayrollCommissionOnly,
  isPersonnelOnDutyInMonth,
} from '@/lib/salary'
import { personBelongsToUnitInMonth } from '@/lib/unitAssignment'

/** 工资表金额统一展示两位小数 */
function money(amount: number): string {
  return formatCurrency(amount, 2)
}

function showPayrollCol(
  mode: PayrollEntryMode,
  col:
    | 'core'
    | 'salary'
    | 'attendance'
    | 'commission'
    | 'score'
    | 'adjust'
    | 'insurance'
    | 'special'
    | 'tax',
): boolean {
  // 最终工资表不展示出勤三列（仅在考勤录入步骤显示）
  if (mode === 'all') return col !== 'attendance' && col !== 'commission'
  if (mode === 'attendance') {
    return col === 'core' || col === 'attendance' || col === 'salary'
  }
  if (mode === 'commission') {
    return col === 'core' || col === 'commission'
  }
  if (mode === 'score') {
    return col === 'core' || col === 'score' || col === 'salary'
  }
  if (mode === 'insurance') {
    return col === 'core' || col === 'insurance' || col === 'salary'
  }
  if (mode === 'otherDeduct') {
    // 提成查阅 → 加/减项明细 → 应发 → 专项附加
    return col === 'core' || col === 'salary' || col === 'adjust' || col === 'special'
  }
  // tax
  return col === 'core' || col === 'special' || col === 'tax' || col === 'salary'
}

function payrollColSpan(mode: PayrollEntryMode, scoreItemCount = 0): number {
  // 与表头条件保持一致：单位+姓名=2
  if (mode === 'attendance') return 2 + 1 + 1 + 2 + 1 // 标准底薪 + 实际/缺勤/应出勤 + 实发底薪
  // 本月业绩 + 个人/内部/团队 + 提成合计 + 明细状态 + 操作
  if (mode === 'commission') return 2 + 1 + 3 + 1 + 1 + 1
  // 标准绩效 + 评分项 + 考核分合计 + 实发绩效
  if (mode === 'score') return 2 + 1 + Math.max(0, scoreItemCount) + 1 + 1
  if (mode === 'insurance') return 2 + 1 + 4 + 1 // 应发 + 企业/个人四列 + 操作
  // 提成 + 加项 + 减项 + 应发 + 专项附加 + 操作
  if (mode === 'otherDeduct') return 2 + 1 + 1 + 1 + 1 + 1 + 1
  // 应发 + 专项 + 期初三列 + 个税/实发（期初列仅 10 月起展示，colSpan 取上限）
  if (mode === 'tax') return 2 + 1 + 1 + 3 + 2
  return 18 // 最终表含企业/个人四列、专项、不含出勤三列
}

type PayrollRowView = PayrollRowResult & {
  personalSales: number
  hasCommissionOrderAdj: boolean
  commissionPersonal: number
  commissionInternal: number
  commissionTeamMgmt: number
}

function getArchiveSpecialAdditional(person: Personnel): number {
  const profile = loadTaxProfile(
    person.id,
    {
      socialInsurance: person.socialInsurance,
      housingFund: person.housingFund,
    },
    person.taxProfile as Partial<PersonnelTaxProfile> | undefined,
  )
  return resolveSpecialAdditionalMonthly(profile)
}

/** 档案社保公积金（方案优先；个人其次个税档案）；非内部/仅提成一律为 0 */
function getArchiveInsurance(person: Personnel, yearMonth: string) {
  if (isPayrollCommissionOnly(person, yearMonth)) {
    return {
      socialEmployer: 0,
      housingEmployer: 0,
      socialPersonal: 0,
      housingPersonal: 0,
    }
  }
  const pay = resolvePayForDate(person, `${yearMonth}-15`)
  return {
    socialEmployer: Number(pay.socialInsurance) || Number(person.socialInsurance) || 0,
    housingEmployer: Number(pay.housingFund) || Number(person.housingFund) || 0,
    socialPersonal:
      Number(pay.socialInsurancePersonal)
      || Number(person.taxProfile?.socialInsurancePersonal)
      || 0,
    housingPersonal:
      Number(pay.housingFundPersonal)
      || Number(person.taxProfile?.housingFundPersonal)
      || 0,
  }
}

/** 跳转人员「调整薪酬」并定位字段 */
function getPersonnelPayHref(
  personnelId: string,
  focus?: 'baseSalary' | 'confidentialityFee' | 'performance' | 'positionAllowance',
): string {
  const q = new URLSearchParams({ pay: personnelId })
  if (focus) q.set('focus', focus)
  return `/personnel?${q.toString()}`
}

/**
 * 工资核算
 * - 纳入单位名单、出勤、考核等录入存服务端（本机 localStorage 作缓存）
 * - 底薪/保密费/岗位补贴/绩效标准、业绩提成读系统现有数据
 */
export default function Payroll() {
  const {
    products,
    productPersonCommissions,
    teamMgmtCommissionRules,
    performanceTargets,
    unitProductSettlements,
    updatePersonnel,
  } = useData()
  const {
    visibleSalesUnits: salesUnits,
    visiblePersonnel: personnel,
    visibleSalesRecords: salesRecords,
    canEdit,
    canEditPersonnel,
  } = usePermissions()
  /** 档案调整：有人员编辑或工资核算编辑权才可真正改写 */
  const canAdjustPayrollArchive = canEditPersonnel || canEdit('payroll')

  function ensureCanAdjustPayrollArchive(actionLabel: string): boolean {
    if (canAdjustPayrollArchive) return true
    alert(`无该编辑权限，无法${actionLabel}。请联系管理员开通「人员管理」或「工资核算」编辑权限。`)
    return false
  }

  const [yearMonth, setYearMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [scopeUnitIds, setScopeUnitIds] = useState<string[]>(() => loadPayrollScopeUnitIds())
  const [draftScopeIds, setDraftScopeIds] = useState<string[]>(() => loadPayrollScopeUnitIds())
  const [entries, setEntries] = useState<Record<string, PayrollMonthEntry>>({})
  // 空串=尚未按纳入名单初始化；有纳入时默认落到第一个单位
  const [filterUnitId, setFilterUnitId] = useState('')
  const [calcPhase, setCalcPhase] = useState<PayrollCalcPhase>('idle')
  const [entryMode, setEntryMode] = useState<PayrollEntryMode>('all')
  const [savedTip, setSavedTip] = useState('')
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncSaving, setSyncSaving] = useState(false)
  const [syncSummary, setSyncSummary] = useState<PayrollEntriesMonthPayload['summary'] | null>(null)
  const [canMigrateLocal, setCanMigrateLocal] = useState(false)
  const [insuranceAdjust, setInsuranceAdjust] = useState<{
    mode: 'single' | 'batch'
    person: Personnel | null
  } | null>(null)
  const [historyPerson, setHistoryPerson] = useState<Personnel | null>(null)
  const [specialAdjust, setSpecialAdjust] = useState<{
    mode: 'single' | 'batch' | 'history'
    person: Personnel | null
  } | null>(null)
  /** unitId → 评分项；空数组表示该单位未配置规则 */
  const [scoreRulesByUnit, setScoreRulesByUnit] = useState<
    Record<string, PayrollScoreRuleItem[]>
  >({})
  const [scoreRuleDialogOpen, setScoreRuleDialogOpen] = useState(false)
  const [scoreRuleSaving, setScoreRuleSaving] = useState(false)

  const teamMgmtContext = useMemo(
    () => ({
      rules: teamMgmtCommissionRules,
      targets: performanceTargets,
      upsList: unitProductSettlements,
    }),
    [teamMgmtCommissionRules, performanceTargets, unitProductSettlements],
  )

  const unitCandidates = useMemo(
    () =>
      [...salesUnits].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [salesUnits],
  )

  const scopedUnits = useMemo(
    () => salesUnits.filter((u) => scopeUnitIds.includes(u.id)),
    [salesUnits, scopeUnitIds],
  )

  const filterUnitName = useMemo(
    () => scopedUnits.find((u) => u.id === filterUnitId)?.name || '',
    [scopedUnits, filterUnitId],
  )

  const activeScoreRuleItems = useMemo(
    () => (filterUnitId ? scoreRulesByUnit[filterUnitId] || [] : []),
    [filterUnitId, scoreRulesByUnit],
  )

  // 筛选下拉仅含上方已选单位；默认第一个，不提供「全部」
  useEffect(() => {
    if (scopedUnits.length === 0) {
      if (filterUnitId) setFilterUnitId('')
      return
    }
    const isValidUnit = scopedUnits.some((u) => u.id === filterUnitId)
    if (!filterUnitId || filterUnitId === 'all' || !isValidUnit) {
      setFilterUnitId(scopedUnits[0].id)
    }
  }, [scopedUnits, filterUnitId])

  useEffect(() => {
    let cancelled = false
    async function loadScoreRules() {
      if (scopedUnits.length === 0) {
        setScoreRulesByUnit({})
        return
      }
      try {
        const payload = await payrollUnitScoreRulesApi.get()
        if (cancelled) return
        const next: Record<string, PayrollScoreRuleItem[]> = {}
        for (const unit of scopedUnits) {
          next[unit.id] = []
        }
        for (const rule of payload.rules || []) {
          const uid = String(rule.unitId || '').trim()
          if (!uid) continue
          next[uid] = normalizeScoreRuleItems(rule.items)
        }
        setScoreRulesByUnit(next)
      } catch (err) {
        console.error(err)
      }
    }
    void loadScoreRules()
    return () => {
      cancelled = true
    }
  }, [scopedUnits])

  function applyScopeFromPayload(payload: PayrollEntriesMonthPayload) {
    if (Array.isArray(payload.scopeUnitIds) && payload.scopeUnitIds.length > 0) {
      setScopeUnitIds(payload.scopeUnitIds)
      setDraftScopeIds(payload.scopeUnitIds)
      savePayrollScopeUnitIds(payload.scopeUnitIds)
      window.dispatchEvent(new Event('payroll-scope-changed'))
    }
  }

  function applyMonthPayload(
    payload: PayrollEntriesMonthPayload,
    options?: { mirrorLocal?: boolean },
  ) {
    const next: Record<string, PayrollMonthEntry> = {}
    for (const [pid, raw] of Object.entries(payload.entries || {})) {
      next[pid] = normalizePayrollEntry(pid, raw as Partial<PayrollMonthEntry>)
    }
    setEntries(next)
    if (options?.mirrorLocal !== false) {
      savePayrollEntries(payload.yearMonth, next)
    }
    applyScopeFromPayload(payload)
    setSyncSummary(payload.summary || null)
  }

  useEffect(() => {
    let cancelled = false
    async function loadMonth() {
      setSyncLoading(true)
      setCanMigrateLocal(false)
      try {
        const [payload, adjPayload] = await Promise.all([
          payrollEntriesApi.getMonth(yearMonth),
          commissionOrderAdjApi.getMonth(yearMonth).catch((err) => {
            console.error(err)
            return null
          }),
        ])
        if (cancelled) return
        if (adjPayload?.scopes?.length) {
          hydrateCommissionOrderAdjScopes(adjPayload.scopes)
        }
        const serverCount = Object.keys(payload.entries || {}).length
        const local = loadPayrollEntries(yearMonth)
        if (serverCount === 0 && Object.keys(local).length > 0) {
          // 服务端尚空：保留本机数据并提示上传，避免误清缓存
          setEntries(local)
          applyScopeFromPayload(payload)
          setSyncSummary(payload.summary || null)
          setCanMigrateLocal(true)
          return
        }
        applyMonthPayload(payload)
        setCanMigrateLocal(false)
      } catch (err) {
        if (cancelled) return
        // 服务端失败时回退本机缓存，避免页面空白
        const local = loadPayrollEntries(yearMonth)
        setEntries(local)
        setSyncSummary(null)
        setCanMigrateLocal(Object.keys(local).length > 0)
        console.error(err)
      } finally {
        if (!cancelled) setSyncLoading(false)
      }
    }
    void loadMonth()
    return () => {
      cancelled = true
    }
  }, [yearMonth])

  function handleToggleDraftUnit(unitId: string, checked: boolean) {
    setDraftScopeIds((prev) => {
      if (checked) return prev.includes(unitId) ? prev : [...prev, unitId]
      return prev.filter((id) => id !== unitId)
    })
  }

  function handleStartPayroll() {
    if (draftScopeIds.length === 0) {
      alert('请先选择至少一个单位')
      return
    }
    savePayrollScopeUnitIds(draftScopeIds)
    setScopeUnitIds(draftScopeIds)
    window.dispatchEvent(new Event('payroll-scope-changed'))
    // 默认只核算列表中的第一个单位，可在工资表里再切换
    setFilterUnitId(draftScopeIds[0])
    setCalcPhase('wizard')
    setEntryMode('attendance')
    void payrollEntriesApi
      .saveMonth({
        yearMonth,
        entries,
        scopeUnitIds: draftScopeIds,
      })
      .then((payload) => {
        applyMonthPayload(payload)
      })
      .catch((err) => {
        console.error(err)
        alert(err instanceof Error ? err.message : '纳入单位同步失败，请稍后重试保存')
      })
    window.setTimeout(() => {
      document.getElementById('payroll-month-table')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 50)
  }

  function updateEntry(personnelId: string, patch: Partial<PayrollMonthEntry>) {
    setEntries((prev) => {
      const base = prev[personnelId] || createEmptyPayrollEntry(personnelId)
      return {
        ...prev,
        [personnelId]: { ...base, ...patch, personnelId },
      }
    })
  }

  function updateScoreItem(
    personnelId: string,
    unitId: string,
    itemId: string,
    value: number | null,
  ) {
    const items = scoreRulesByUnit[unitId] || []
    setEntries((prev) => {
      const base = prev[personnelId] || createEmptyPayrollEntry(personnelId)
      const scoreItemScores = {
        ...(base.scoreItemScores || {}),
        [itemId]: value,
      }
      const score = resolveScoreFromItems(items, scoreItemScores)
      return {
        ...prev,
        [personnelId]: {
          ...base,
          personnelId,
          scoreItemScores,
          score,
        },
      }
    })
  }

  async function handleSaveScoreRule(items: PayrollScoreRuleItem[]) {
    if (!filterUnitId) return
    if (!canEdit('payroll')) {
      alert('无工资核算编辑权限，无法保存评分规则')
      return
    }
    setScoreRuleSaving(true)
    try {
      const payload = await payrollUnitScoreRulesApi.save({
        unitId: filterUnitId,
        items,
      })
      const nextItems = normalizeScoreRuleItems(payload.items)
      setScoreRulesByUnit((prev) => ({
        ...prev,
        [filterUnitId]: nextItems,
      }))
      // 规则变更后，按新项重算本单位已录入分项对应的考核分
      setEntries((prev) => {
        const next = { ...prev }
        for (const row of rows) {
          if (row.unitId !== filterUnitId) continue
          const base = next[row.personnelId] || createEmptyPayrollEntry(row.personnelId)
          const score = resolveScoreFromItems(nextItems, base.scoreItemScores)
          next[row.personnelId] = {
            ...base,
            personnelId: row.personnelId,
            score: nextItems.length > 0 ? score : base.score,
          }
        }
        return next
      })
      setScoreRuleDialogOpen(false)
      setSavedTip(nextItems.length > 0 ? '评分规则已保存' : '评分规则已清除')
      window.setTimeout(() => setSavedTip(''), 2000)
    } catch (err) {
      console.error(err)
      alert('保存评分规则失败')
    } finally {
      setScoreRuleSaving(false)
    }
  }

  async function handleSaveEntries() {
    const next: Record<string, PayrollMonthEntry> = { ...entries }
    for (const row of rows) {
      const person = personnel.find((p) => p.id === row.personnelId)
      if (!person) continue
      const base = next[row.personnelId] || createEmptyPayrollEntry(row.personnelId)
      const tax = resolvePayrollTax({
        person,
        yearMonth,
        payable: row.payable,
        entry: base,
      })
      next[row.personnelId] = {
        ...base,
        socialInsurancePersonal: tax.socialInsurancePersonal,
        housingFundPersonal: tax.housingFundPersonal,
        specialAdditional: tax.specialAdditional,
        incomeTax: tax.incomeTax,
        payableSnapshot: row.payable,
        // 冻结本月税基 / C / B，供下月只读结转（不改写历史手工）
        cumulativeTaxBaseSnapshot: tax.cumulativeTaxBase,
        taxableIncomeSnapshot: tax.taxable,
        taxPaidBeforeSnapshot: tax.cumulativeTaxPaidBefore,
      }
    }
    setEntries(next)
    savePayrollEntries(yearMonth, next)
    setSyncSaving(true)
    try {
      const payload = await payrollEntriesApi.saveMonth({
        yearMonth,
        entries: next,
        scopeUnitIds: scopeUnitIds.length > 0 ? scopeUnitIds : draftScopeIds,
      })
      applyMonthPayload(payload)
      const who = payload.summary?.updatedBy || '已同步'
      const when = payload.summary?.updatedAt
        ? formatDateTime(payload.summary.updatedAt)
        : ''
      setSavedTip(
        `${yearMonth} 已同步到服务器${who ? ` · ${who}` : ''}${when ? ` · ${when}` : ''}`,
      )
      setCanMigrateLocal(false)
    } catch (err) {
      console.error(err)
      setSavedTip(`${yearMonth} 已存本机缓存，服务器同步失败`)
      alert(err instanceof Error ? err.message : '同步服务器失败')
    } finally {
      setSyncSaving(false)
      window.setTimeout(() => setSavedTip(''), 4000)
    }
  }

  async function handleMigrateLocalToServer() {
    const local = loadPayrollEntries(yearMonth)
    if (Object.keys(local).length === 0) {
      alert('本机没有可上传的录入')
      return
    }
    if (!confirm(`将本机 ${yearMonth} 的 ${Object.keys(local).length} 人录入上传到服务器？`)) {
      return
    }
    setSyncSaving(true)
    try {
      const payload = await payrollEntriesApi.saveMonth({
        yearMonth,
        entries: local,
        scopeUnitIds: scopeUnitIds.length > 0 ? scopeUnitIds : loadPayrollScopeUnitIds(),
      })
      applyMonthPayload(payload)
      setSavedTip(`${yearMonth} 本机数据已上传服务器`)
      setCanMigrateLocal(false)
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : '上传失败')
    } finally {
      setSyncSaving(false)
      window.setTimeout(() => setSavedTip(''), 4000)
    }
  }

  async function handleSaveIitOpening(
    person: Personnel,
    patch: {
      taxBase?: number
      taxPaid?: number
      taxable?: number | null
    },
  ) {
    const profile = loadTaxProfile(
      person.id,
      {
        socialInsurance: person.socialInsurance,
        housingFund: person.housingFund,
      },
      person.taxProfile as Partial<PersonnelTaxProfile> | undefined,
    )
    const next = upsertIitCycleOpening(profile, {
      ...patch,
      throughYm: IIT_SEED_THROUGH_YM,
    })
    await updatePersonnel(person.id, { taxProfile: next })
    setSavedTip(`已保存 ${formatDisplayPersonName(person.name)} 个税期初`)
    window.setTimeout(() => setSavedTip(''), 2000)
  }

  const rows: PayrollRowView[] = useMemo(() => {
    if (scopedUnits.length === 0) return []

    const unitNameMap = new Map(salesUnits.map((u) => [u.id, u.name]))
    const list: PayrollRowView[] = []
    const monthSales = filterByMonth(salesRecords, yearMonth)

    for (const unit of scopedUnits) {
      if (filterUnitId !== 'all' && filterUnitId !== unit.id) continue

      const people = personnel.filter(
        (p) =>
          isPersonnelOnDutyInMonth(p, yearMonth) &&
          personBelongsToUnitInMonth(p, unit.id, yearMonth),
      )

      for (const person of people) {
        const calc = calculateMonthlySalary(
          person,
          salesRecords,
          products,
          yearMonth,
          undefined,
          productPersonCommissions,
          teamMgmtContext,
          unit.id,
        )
        const commissionResolved = resolvePayrollCommissionTotal({
          personnelId: person.id,
          unitId: unit.id,
          yearMonth,
          personnel,
          salesUnits,
          salesRecords,
          products,
          productPersonCommissions,
          teamMgmtRules: teamMgmtCommissionRules,
          performanceTargets,
          unitProductSettlements,
          systemParts: {
            personal: calc.personalCommission || 0,
            internal: calc.internalSalesCommission || 0,
            teamMgmt: calc.managementCommission || 0,
          },
        })
        const commission = commissionResolved.total

        const rawEntry = entries[person.id] || createEmptyPayrollEntry(person.id)
        // 个人代扣/专项附加只认人员档案，不认本月录入覆盖
        const entry: PayrollMonthEntry = {
          ...rawEntry,
          socialInsurancePersonal: null,
          housingFundPersonal: null,
          specialAdditional: null,
        }
        const baseRow = calcPayrollRow({
          personnelId: person.id,
          name: person.name,
          unitId: unit.id,
          unitName: unitNameMap.get(unit.id) || unit.name,
          commissionOnly: isPayrollCommissionOnly(person, yearMonth),
          standardBaseSalary: calc.baseSalary,
          standardConfidentialityFee: calc.confidentialityFee,
          standardPositionAllowance: calc.positionAllowance,
          standardPerformance: calc.performance,
          commission,
          entry,
        })
        const taxed = enrichPayrollRowWithTax(baseRow, person, yearMonth, entry)
        list.push({
          ...taxed,
          personalSales: getPersonalSales(person.id, monthSales, person.name, products),
          hasCommissionOrderAdj: Boolean(commissionResolved.hasOrderAdj),
          commissionPersonal: commissionResolved.personal || 0,
          commissionInternal: commissionResolved.internal || 0,
          commissionTeamMgmt: commissionResolved.teamMgmt || 0,
        })
      }
    }

    // 内部员工在前，非内部（仅提成）沉底；同组内按单位、姓名
    return list.sort((a, b) => {
      const aExt = a.commissionOnly ? 1 : 0
      const bExt = b.commissionOnly ? 1 : 0
      if (aExt !== bExt) return aExt - bExt
      return `${a.unitName}-${a.name}`.localeCompare(
        `${b.unitName}-${b.name}`,
        'zh-CN',
      )
    })
  }, [
    scopedUnits,
    filterUnitId,
    personnel,
    yearMonth,
    salesRecords,
    products,
    productPersonCommissions,
    teamMgmtContext,
    entries,
    salesUnits,
  ])

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.commission += row.commission
        acc.paidBaseSalary += row.paidBaseSalary
        acc.paidConfidentialityFee += row.paidConfidentialityFee
        acc.paidPositionAllowance += row.paidPositionAllowance
        acc.paidPerformance += row.paidPerformance
        acc.payable += row.payable
        acc.socialPersonal += row.socialInsurancePersonal || 0
        acc.housingPersonal += row.housingFundPersonal || 0
        acc.incomeTax += row.incomeTax || 0
        acc.netPay += row.netPay || 0
        return acc
      },
      {
        commission: 0,
        paidBaseSalary: 0,
        paidConfidentialityFee: 0,
        paidPositionAllowance: 0,
        paidPerformance: 0,
        payable: 0,
        socialPersonal: 0,
        housingPersonal: 0,
        incomeTax: 0,
        netPay: 0,
      },
    )
  }, [rows])

  async function handleExportExcel() {
    if (rows.length === 0) {
      alert('当前没有可导出的工资行，请先选择单位并确认月份')
      return
    }
    const header = [
      '月份',
      '单位',
      '姓名',
      '标准底薪',
      '保密费',
      '岗位补贴',
      '标准绩效',
      '业绩提成',
      '实际出勤',
      '缺勤时间',
      '应出勤时间',
      '考核分',
      '实发底薪',
      '实发绩效',
      '其他加项',
      '加项明细',
      '其他减项',
      '减项明细',
      '应发合计',
      '社保企业',
      '社保个人',
      '公积金企业',
      '公积金个人',
      '专项附加',
      '本期个税',
      '实发',
    ]
    const bonusCol = header.indexOf('其他加项') + 1
    const deductCol = header.indexOf('其他减项') + 1
    // Excel 会把 "2026-10" 自动当成日期显示成 Oct-26，导出用中文月份文本避免误识别
    const monthLabel = /^\d{4}-\d{2}$/.test(yearMonth)
      ? `${yearMonth.slice(0, 4)}年${Number(yearMonth.slice(5, 7))}月`
      : yearMonth

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'yejiguanli'
    const sheet = workbook.addWorksheet('工资表', {
      views: [{ state: 'frozen', ySplit: 1 }],
    })
    sheet.addRow(header)
    sheet.getRow(1).font = { bold: true }

    rows.forEach((r) => {
      const entry = entries[r.personnelId] || createEmptyPayrollEntry(r.personnelId)
      const person = personnel.find((p) => p.id === r.personnelId)
      const archive = person
        ? getArchiveInsurance(person, yearMonth)
        : {
          socialEmployer: 0,
          housingEmployer: 0,
          socialPersonal: r.socialInsurancePersonal || 0,
          housingPersonal: r.housingFundPersonal || 0,
        }
      const bonusNote =
        entry.otherBonusNote
        || (entry.otherBonusLines?.length
          ? formatAdjLinesNote(entry.otherBonusLines)
          : '')
      const deductNote =
        entry.otherDeductionNote
        || (entry.otherDeductionLines?.length
          ? formatAdjLinesNote(entry.otherDeductionLines)
          : '')
      const bonusComment = formatAdjLinesComment(
        entry.otherBonusLines || [],
        entry.otherBonusNote || '',
      )
      const deductComment = formatAdjLinesComment(
        entry.otherDeductionLines || [],
        entry.otherDeductionNote || '',
      )

      const row = sheet.addRow([
        monthLabel,
        r.unitName,
        r.name,
        Number(r.standardBaseSalary.toFixed(2)),
        Number(r.paidConfidentialityFee.toFixed(2)),
        Number(r.paidPositionAllowance.toFixed(2)),
        Number(r.standardPerformance.toFixed(2)),
        Number(r.commission.toFixed(2)),
        Number(r.attendanceHours.toFixed(2)),
        Number(r.absenceHours.toFixed(2)),
        Number(r.expectedAttendanceHours.toFixed(2)),
        Number(r.score.toFixed(1)),
        Number(r.paidBaseSalary.toFixed(2)),
        Number(r.paidPerformance.toFixed(2)),
        Number((entry.otherBonus || 0).toFixed(2)),
        bonusNote,
        Number((entry.otherDeduction || 0).toFixed(2)),
        deductNote,
        Number(r.payable.toFixed(2)),
        Number(archive.socialEmployer.toFixed(2)),
        Number(archive.socialPersonal.toFixed(2)),
        Number(archive.housingEmployer.toFixed(2)),
        Number(archive.housingPersonal.toFixed(2)),
        Number((r.specialAdditional || 0).toFixed(2)),
        Number((r.incomeTax || 0).toFixed(2)),
        Number((r.netPay || 0).toFixed(2)),
      ])

      if (bonusComment) {
        row.getCell(bonusCol).note = bonusComment
        // 有批注时浅底色，便于发现
        row.getCell(bonusCol).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF7ED' },
        }
      }
      if (deductComment) {
        row.getCell(deductCol).note = deductComment
        row.getCell(deductCol).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF2F2' },
        }
      }
    })

    sheet.columns.forEach((col) => {
      let max = 10
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = String(cell.value ?? '').length
        if (len > max) max = len
      })
      col.width = Math.min(Math.max(max + 2, 10), 28)
    })

    // 文件名：单位名称 + 月份（与筛选/导出内容一致）
    const unitNames = Array.from(new Set(rows.map((r) => r.unitName).filter(Boolean)))
    const hit = scopedUnits.find((u) => u.id === filterUnitId)
    let unitLabel = hit?.name || unitNames[0] || '工资表'
    if (!hit && unitNames.length > 1) {
      unitLabel = unitNames.length <= 3
        ? unitNames.join('、')
        : `${unitNames.slice(0, 2).join('、')}等${unitNames.length}家`
    }
    const safeUnit = unitLabel
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '')
      .slice(0, 60) || '工资表'

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeUnit}_${monthLabel}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="relative space-y-6">
      <ViewerWatermark />
      <PageHeader
        title="工资核算"
        description="先选择单位并去核算，再按月录入出勤与考核分，生成可导出工资表。出勤/考核暂存本机。"
      />

      <Card className="border-amber-200/80 bg-amber-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">本期默认公式（可再改）</CardTitle>
          <CardDescription>
            应发 = 提成 + 实发底薪 + 保密费 + 岗位补贴 + 实发绩效 + 其他加项 − 其他减项；月出勤系数{' '}
            21.75 × 7.5 = {PAYROLL_STANDARD_HOURS} 小时；未填缺勤按满勤（缺勤=0），未填考核分按 100 分。
            加项/减项悬停金额可开「明细」录入多行；导出 Excel 时明细写入加项/减项单元格批注。
            实发=应发−社保个人−公积金个人−本期个税。
            社保/公积金企业与个人固定取薪酬方案（可「去调整」/批量写入档案并记修改记录）；本期个税可改。人员关闭「内部员工」后只核算提成。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>实发底薪 = 标准底薪 × (实际出勤 / 应出勤)；应出勤固定 {PAYROLL_STANDARD_HOURS}，实际出勤 = 应出勤 − 缺勤</p>
          <p>保密费、岗位补贴 = 标准金额全额（不受考勤影响）</p>
          <p>
            实发绩效 = 标准绩效 × (实际出勤 / 应出勤) × (考核分 / 100)
          </p>
          <p>业绩提成 = 系统个人提成 + 内部销售提成 + 团队管理提成（只读）</p>
          <p>非内部员工：应发 = 提成 + 其他加项 − 其他减项（不显示出勤/考核/固定薪酬）</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckSquare className="h-5 w-5" />
            1. 选择单位
          </CardTitle>
          <CardDescription>
            勾选要核算的单位后点「去核算工资」。工资表默认先显示所选中的第一个单位。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraftScopeIds([])}>
              清空勾选
            </Button>
            <Button type="button" size="sm" onClick={handleStartPayroll}>
              <Calculator className="mr-1.5 h-3.5 w-3.5" />
              去核算工资
            </Button>
            {savedTip && <span className="text-sm text-emerald-700 self-center">{savedTip}</span>}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unitCandidates.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={draftScopeIds.includes(u.id)}
                  onCheckedChange={(c) => handleToggleDraftUnit(u.id, c === true)}
                />
                <span className="truncate">{u.name}</span>
              </label>
            ))}
            {unitCandidates.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无销售单位</p>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            当前已选单位：
            {scopedUnits.length === 0
              ? '无（请勾选后点「去核算工资」）'
              : scopedUnits.map((u) => u.name).join('、')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calculator className="h-5 w-5" />
              2. 月度工资表
            </CardTitle>
            <MPayrollEntryLinks
              phase={calcPhase}
              mode={entryMode}
              onPhaseChange={setCalcPhase}
              onModeChange={setEntryMode}
            />
          </div>
          <CardDescription>
            {calcPhase === 'idle' && (
              <>默认不展示录入项与工资明细。请先在上方「选择单位」后点「去核算工资」，依次完成考勤、提成核对、绩效分数、社保公积金、其他预扣、个税录入，再生成工资表。</>
            )}
            {calcPhase === 'wizard' && (
              <>请按步骤填写本月录入项；完成后点「生成工资表」。标准底薪/保密费/岗位补贴/绩效可点姓名跳转调整。</>
            )}
            {calcPhase === 'result' && (
              <>工资表已生成。出勤明细仅在核算「考勤录入」步骤中填写，本表按核算结果展示应发/实发。</>
            )}
          </CardDescription>
          {calcPhase === 'wizard' && entryMode === 'attendance' && (
            <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              步骤 1/6 考勤录入 — 应出勤固定 {PAYROLL_STANDARD_HOURS} 小时；填写缺勤后，
              实际出勤 = 应出勤 − 缺勤。
            </p>
          )}
          {calcPhase === 'wizard' && entryMode === 'commission' && (
            <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
              步骤 2/6 提成核对 — 系统按销售记录汇总，不在此录入。核对每人业绩与提成；有疑问点「查看明细」逐单调整，回写后合计与页脚「提成合计」一致。
            </p>
          )}
          {calcPhase === 'wizard' && entryMode === 'score' && (
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <p>
                步骤 3/6 绩效分数录入 —
                {activeScoreRuleItems.length > 0
                  ? ' 按本单位规则分项打分，合计为考核分（0–100）。'
                  : ' 请填写考核分（0–100）；也可点「编辑评分规则」为本单位配置分项。'}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-800/80">
                  {filterUnitName || '当前单位'}：
                  {formatScoreRuleSummary(activeScoreRuleItems)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-emerald-300 bg-white px-2 text-xs text-emerald-900"
                  disabled={!filterUnitId}
                  onClick={() => setScoreRuleDialogOpen(true)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  编辑评分规则
                </Button>
              </div>
            </div>
          )}
          {calcPhase === 'wizard' && entryMode === 'insurance' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              步骤 4/6 社保公积金录入 — 企业/个人按人员档案固定展示；不对时点上方「批量调整社保公积金」或行内「去调整」写入薪酬方案/个税档案（有修改记录）。
            </p>
          )}
          {calcPhase === 'wizard' && entryMode === 'otherDeduct' && (
            <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
              步骤 5/6 其他预扣项目 — 录入加项/减项明细与金额；
              专项附加按个税档案展示，不对时点上方「批量调整专项附加」或右侧操作列「去调整」。
            </p>
          )}
          {calcPhase === 'wizard' && entryMode === 'tax' && (() => {
            const cycle = getIitCycleBounds(yearMonth)
            const useOpening = shouldUseIitCycleOpening(yearMonth)
            return (
              <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                步骤 6/6 个税扣除预报 — 累计周期{' '}
                <strong>
                  {cycle.startYm}～{cycle.endYm}
                </strong>
                。N=本周期内自 max(周期起点, 入职月) 起算的月序（12 月起新周期从 1
                再计；每人可能不同，见行内），减除费用 {MONTHLY_BASIC_DEDUCTION}×N。
                累计扣税基数=上月应纳税所得额C（首月取期初）；
                C=累计扣税基数+本月应发−个人社保−个人公积金−本月专项附加合计；
                B=上月B+上月本期个税；
                A=ROUND(MAX((C−{MONTHLY_BASIC_DEDUCTION}×N)×{'{3,10,20,25,30,35,45}%'}−速算扣除数, 0), 2)；
                本期个税=max(A−B, 0)。
                {useOpening && (
                  <>
                    {' '}
                    请填写截至 {IIT_SEED_THROUGH_YM} 的已预扣个税、累计扣税基数；应纳税所得额可改。
                  </>
                )}
                {' '}完成后点「生成工资表」。
              </p>
            )
          })()}
        </CardHeader>
        <CardContent className="space-y-4">
          {calcPhase === 'idle' ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              尚未开始核算。请先在上方选择单位并点「去核算工资」，按考勤 → 提成核对 → 绩效分数 → 社保公积金 → 其他预扣 → 个税依次录入后生成工资表。
            </div>
          ) : (
          <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="payrollMonth">核算月份</Label>
              <Input
                id="payrollMonth"
                type="month"
                className="w-[180px]"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>核算单位</Label>
              <Select
                value={filterUnitId || undefined}
                onValueChange={setFilterUnitId}
                disabled={scopedUnits.length === 0}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="请先在上方选择单位" />
                </SelectTrigger>
                <SelectContent>
                  {scopedUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                仅显示上方已选单位；默认第一个，可在此切换
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={syncSaving || syncLoading}
              onClick={() => void handleSaveEntries()}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {syncSaving ? '同步中…' : '保存本月录入'}
            </Button>
            {canMigrateLocal && (
              <Button
                type="button"
                variant="secondary"
                disabled={syncSaving || syncLoading}
                onClick={() => void handleMigrateLocalToServer()}
              >
                上传本机数据
              </Button>
            )}
            <Button type="button" onClick={() => void handleExportExcel()}>
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
              导出 Excel
            </Button>
            {entryMode === 'insurance' && (
              <Button
                type="button"
                variant="secondary"
                disabled={rows.length === 0}
                onClick={() => {
                  if (!ensureCanAdjustPayrollArchive('批量调整社保公积金')) return
                  setInsuranceAdjust({ mode: 'batch', person: null })
                }}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                批量调整社保公积金
              </Button>
            )}
            {entryMode === 'otherDeduct' && (
              <Button
                type="button"
                variant="secondary"
                disabled={rows.length === 0}
                onClick={() => {
                  if (!ensureCanAdjustPayrollArchive('批量调整专项附加')) return
                  setSpecialAdjust({ mode: 'batch', person: null })
                }}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                批量调整专项附加
              </Button>
            )}
            <Badge variant="secondary" className="h-8 px-3">
              {rows.length} 人
            </Badge>
            {syncLoading && (
              <span className="self-center text-xs text-muted-foreground">正在从服务器拉取…</span>
            )}
            {savedTip && (
              <span className="self-center text-sm text-emerald-700">{savedTip}</span>
            )}
            {!savedTip && syncSummary?.updatedAt && (
              <span className="self-center text-xs text-muted-foreground">
                最近修改：{syncSummary.updatedBy || '—'}
                {' · '}
                {formatDateTime(syncSummary.updatedAt)}
                {syncSummary.uploadedAt
                  ? ` · 首次上传 ${formatDateTime(syncSummary.uploadedAt)}`
                  : ''}
              </span>
            )}
          </div>

          {scopedUnits.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              尚未选择单位，请先在上方勾选并点「去核算工资」。
            </p>
          ) : (
            <div id="payroll-month-table" className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">单位</TableHead>
                    <TableHead className="min-w-[88px]">姓名</TableHead>
                    {showPayrollCol(entryMode, 'salary') &&
                      entryMode !== 'score' &&
                      entryMode !== 'otherDeduct' && (
                      <TableHead className="text-right">标准底薪</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') && entryMode === 'all' && (
                      <TableHead className="text-right">保密费</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') && entryMode === 'all' && (
                      <TableHead className="text-right">岗位补贴</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') &&
                      (entryMode === 'all' || entryMode === 'score') && (
                      <TableHead className="text-right">标准绩效</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') &&
                      (entryMode === 'all' || entryMode === 'otherDeduct') && (
                      <TableHead className="text-right min-w-[100px] bg-violet-50/80">
                        业绩提成
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'commission') && (
                      <TableHead className="min-w-[100px] bg-violet-50/80 text-right">
                        本月业绩
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'commission') && (
                      <TableHead className="min-w-[88px] bg-violet-50/80 text-right">
                        个人提成
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'commission') && (
                      <TableHead className="min-w-[88px] bg-violet-50/80 text-right">
                        内部销售
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'commission') && (
                      <TableHead className="min-w-[88px] bg-violet-50/80 text-right">
                        团队管理
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'commission') && (
                      <TableHead className="min-w-[100px] bg-violet-50/80 text-right">
                        提成合计
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'commission') && (
                      <TableHead className="min-w-[88px] bg-violet-50/80 text-center">
                        明细调整
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'commission') && (
                      <TableHead className="min-w-[96px] bg-violet-50/80">操作</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'attendance') && (
                      <TableHead className="w-[100px] min-w-[100px] bg-sky-50/80 text-right">
                        实际出勤
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'attendance') && (
                      <TableHead className="w-[100px] min-w-[100px] bg-sky-50/80 text-center">
                        缺勤时间
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'attendance') && (
                      <TableHead className="w-[100px] min-w-[100px] bg-sky-50/80 text-right">
                        应出勤时间
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'score') &&
                      entryMode === 'score' &&
                      activeScoreRuleItems.map((item) => (
                        <TableHead
                          key={item.id}
                          className="min-w-[92px] bg-emerald-50/80 text-center"
                        >
                          {item.name}
                          <div className="text-[10px] font-normal text-muted-foreground">
                            满分 {item.maxScore}
                          </div>
                        </TableHead>
                      ))}
                    {showPayrollCol(entryMode, 'score') && (
                      <TableHead
                        className={
                          entryMode === 'score' && activeScoreRuleItems.length > 0
                            ? 'min-w-[88px] bg-emerald-50/80 text-right'
                            : 'min-w-[88px] bg-emerald-50/80'
                        }
                      >
                        {entryMode === 'score' && activeScoreRuleItems.length > 0
                          ? '考核分合计'
                          : '绩效分数'}
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') &&
                      (entryMode === 'all' || entryMode === 'attendance') && (
                      <TableHead className="text-right">实发底薪</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') &&
                      (entryMode === 'all' || entryMode === 'score') && (
                      <TableHead className="text-right">实发绩效</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'adjust') && (
                      <TableHead
                        className={
                          entryMode === 'otherDeduct'
                            ? 'min-w-[148px] bg-orange-50/80'
                            : 'min-w-[148px]'
                        }
                      >
                        加项 / 明细
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'adjust') && (
                      <TableHead
                        className={
                          entryMode === 'otherDeduct'
                            ? 'min-w-[148px] bg-orange-50/80'
                            : 'min-w-[148px]'
                        }
                      >
                        减项 / 明细
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') &&
                      (entryMode === 'all' ||
                        entryMode === 'insurance' ||
                        entryMode === 'otherDeduct' ||
                        entryMode === 'tax') && (
                      <TableHead className="text-right font-semibold">应发</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'insurance') && (
                      <TableHead className="min-w-[96px] bg-amber-50/80 text-right">
                        社保企业
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'insurance') && (
                      <TableHead className="min-w-[96px] bg-amber-50/80 text-right">
                        社保个人
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'insurance') && (
                      <TableHead className="min-w-[96px] bg-amber-50/80 text-right">
                        公积金企业
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'insurance') && (
                      <TableHead className="min-w-[96px] bg-amber-50/80 text-right">
                        公积金个人
                      </TableHead>
                    )}
                    {entryMode === 'insurance' && (
                      <TableHead className="min-w-[140px] bg-amber-50/80">操作</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'special') && (
                      <TableHead className="text-right min-w-[96px] bg-orange-50/80">
                        专项附加
                      </TableHead>
                    )}
                    {entryMode === 'otherDeduct' && (
                      <TableHead className="min-w-[140px] bg-orange-50/80">操作</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'tax') && shouldUseIitCycleOpening(yearMonth) && (
                      <TableHead className="min-w-[110px] bg-violet-50/80 text-right">
                        已预缴个税 B
                        <div className="text-[10px] font-normal text-muted-foreground">
                          上月B+上月本期个税
                        </div>
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'tax') && shouldUseIitCycleOpening(yearMonth) && (
                      <TableHead className="min-w-[120px] bg-violet-50/80 text-right">
                        累计扣税基数
                        <div className="text-[10px] font-normal text-muted-foreground">
                          =上月应纳税所得额C
                        </div>
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'tax') && shouldUseIitCycleOpening(yearMonth) && (
                      <TableHead className="min-w-[120px] bg-violet-50/80 text-right">
                        应纳税所得额 C
                        <div className="text-[10px] font-normal text-muted-foreground">
                          税基+应发−社保公积金−专项
                        </div>
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'tax') && (
                      <TableHead className="min-w-[220px] bg-amber-50/80">
                        本期个税
                        <div className="text-[10px] font-normal text-muted-foreground whitespace-normal">
                          max(A−B, 0)
                        </div>
                      </TableHead>
                    )}
                    {showPayrollCol(entryMode, 'tax') && (
                      <TableHead className="text-right font-semibold min-w-[100px] bg-amber-50/80">实发</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const entry = entries[row.personnelId] || createEmptyPayrollEntry(row.personnelId)
                    const onlyCommission = row.commissionOnly
                    return (
                      <TableRow key={`${row.unitId}-${row.personnelId}`}>
                        <TableCell className="text-xs text-muted-foreground">{row.unitName}</TableCell>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link
                              to={getPersonnelPayHref(row.personnelId)}
                              className="max-w-[140px] truncate underline-offset-2 hover:underline"
                              title={`${row.name}（打开调整薪酬）`}
                            >
                              {formatDisplayPersonName(row.name, {
                                stripDistributionPrefix: row.commissionOnly,
                              })}
                            </Link>
                            {onlyCommission && (
                              <Badge
                                variant="outline"
                                className="border-violet-200 px-1 py-0 text-[10px] text-violet-700"
                              >
                                非内部·仅提成
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {showPayrollCol(entryMode, 'salary') &&
                          entryMode !== 'score' &&
                          entryMode !== 'otherDeduct' && (
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {onlyCommission ? (
                            '—'
                          ) : (
                            <Link
                              to={getPersonnelPayHref(row.personnelId, 'baseSalary')}
                              className="underline-offset-2 hover:underline"
                              title="调整底薪"
                            >
                              {money(row.standardBaseSalary)}
                            </Link>
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'salary') && entryMode === 'all' && (
                        <TableCell className="text-right tabular-nums text-slate-700">
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Link
                              to={getPersonnelPayHref(row.personnelId, 'confidentialityFee')}
                              className="underline-offset-2 hover:underline"
                              title="调整保密费"
                            >
                              {money(row.paidConfidentialityFee)}
                            </Link>
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'salary') && entryMode === 'all' && (
                        <TableCell className="text-right tabular-nums text-violet-700">
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Link
                              to={getPersonnelPayHref(row.personnelId, 'positionAllowance')}
                              className="underline-offset-2 hover:underline"
                              title="调整岗位补贴"
                            >
                              {money(row.paidPositionAllowance)}
                            </Link>
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'salary') &&
                          (entryMode === 'all' || entryMode === 'score') && (
                        <TableCell className="text-right tabular-nums">
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Link
                              to={getPersonnelPayHref(row.personnelId, 'performance')}
                              className="underline-offset-2 hover:underline"
                              title="调整绩效"
                            >
                              {money(row.standardPerformance)}
                            </Link>
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'salary') &&
                          (entryMode === 'all' || entryMode === 'otherDeduct') && (
                        <TableCell
                          className={
                            entryMode === 'otherDeduct'
                              ? 'bg-violet-50/40 text-right tabular-nums'
                              : 'text-right tabular-nums'
                          }
                        >
                          <Link
                            to={`/payroll/commission-detail?personnelId=${encodeURIComponent(row.personnelId)}&unitId=${encodeURIComponent(row.unitId)}&yearMonth=${encodeURIComponent(yearMonth)}`}
                            className="font-medium text-violet-700 underline-offset-2 hover:underline"
                            title="查看个人业绩提成明细（订单金额 / 比例 / 提成）"
                          >
                            {money(row.commission)}
                          </Link>
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'commission') && (
                          <TableCell className="bg-violet-50/40 text-right tabular-nums">
                            {money(row.personalSales)}
                          </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'commission') && (
                          <TableCell className="bg-violet-50/40 text-right tabular-nums">
                            {money(row.commissionPersonal)}
                          </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'commission') && (
                          <TableCell className="bg-violet-50/40 text-right tabular-nums">
                            {money(row.commissionInternal)}
                          </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'commission') && (
                          <TableCell className="bg-violet-50/40 text-right tabular-nums">
                            {money(row.commissionTeamMgmt)}
                          </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'commission') && (
                          <TableCell className="bg-violet-50/40 text-right tabular-nums font-medium text-violet-800">
                            {money(row.commission)}
                          </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'commission') && (
                          <TableCell className="bg-violet-50/40 text-center">
                            {row.hasCommissionOrderAdj ? (
                              <Badge
                                variant="outline"
                                className="border-violet-300 px-1.5 py-0 text-[11px] text-violet-700"
                              >
                                已调整
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'commission') && (
                          <TableCell className="bg-violet-50/40">
                            <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                              <Link
                                to={`/payroll/commission-detail?personnelId=${encodeURIComponent(row.personnelId)}&unitId=${encodeURIComponent(row.unitId)}&yearMonth=${encodeURIComponent(yearMonth)}`}
                                title="按销售记录逐单核对与调整提成"
                              >
                                查看明细
                              </Link>
                            </Button>
                          </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'attendance') && (
                        <TableCell
                          className={
                            entryMode === 'attendance'
                              ? 'w-[100px] min-w-[100px] bg-sky-50/40 text-right tabular-nums text-muted-foreground'
                              : 'w-[100px] min-w-[100px] text-right tabular-nums text-muted-foreground'
                          }
                          title="实际出勤 = 应出勤 − 缺勤"
                        >
                          {onlyCommission ? '—' : row.attendanceHours.toFixed(3)}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'attendance') && (
                        <TableCell
                          className={
                            entryMode === 'attendance'
                              ? 'w-[100px] min-w-[100px] bg-sky-50/40 text-center'
                              : 'w-[100px] min-w-[100px] text-center'
                          }
                        >
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Input
                              type="number"
                              step="0.5"
                              min={0}
                              max={PAYROLL_STANDARD_HOURS}
                              className="mx-auto h-8 w-[84px] text-right"
                              title="缺勤从应出勤中扣除；实际出勤 = 应出勤 − 缺勤"
                              placeholder="0"
                              value={entry.absenceHours ?? ''}
                              onChange={(e) =>
                                updateEntry(row.personnelId, {
                                  absenceHours:
                                    e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                            />
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'attendance') && (
                        <TableCell
                          className={
                            entryMode === 'attendance'
                              ? 'w-[100px] min-w-[100px] bg-sky-50/40 text-right tabular-nums text-muted-foreground'
                              : 'w-[100px] min-w-[100px] text-right tabular-nums text-muted-foreground'
                          }
                          title="月应出勤固定（21.75×7.5）"
                        >
                          {onlyCommission ? '—' : row.expectedAttendanceHours.toFixed(3)}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'score') &&
                          entryMode === 'score' &&
                          activeScoreRuleItems.map((item) => (
                            <TableCell
                              key={item.id}
                              className="bg-emerald-50/40 text-center"
                            >
                              {onlyCommission ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <Input
                                  type="number"
                                  step="1"
                                  min={0}
                                  max={item.maxScore}
                                  className="mx-auto h-8 w-[72px] text-right"
                                  placeholder="—"
                                  title={`${item.name}（0–${item.maxScore}）`}
                                  value={entry.scoreItemScores?.[item.id] ?? ''}
                                  onChange={(e) =>
                                    updateScoreItem(
                                      row.personnelId,
                                      row.unitId,
                                      item.id,
                                      e.target.value === '' ? null : Number(e.target.value),
                                    )
                                  }
                                />
                              )}
                            </TableCell>
                          ))}
                        {showPayrollCol(entryMode, 'score') && (
                        <TableCell
                          className={
                            entryMode === 'score'
                              ? 'bg-emerald-50/40 text-right tabular-nums'
                              : undefined
                          }
                        >
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : entryMode === 'score' && activeScoreRuleItems.length > 0 ? (
                            <span
                              className="font-medium text-emerald-900"
                              title="由评分项自动合计；未填任何项时按 100 分核算"
                            >
                              {entry.score == null ? '—' : entry.score}
                            </span>
                          ) : (
                            <Input
                              type="number"
                              step="1"
                              min={0}
                              max={100}
                              className="h-8 w-[84px]"
                              placeholder="100"
                              value={entry.score ?? ''}
                              onChange={(e) =>
                                updateEntry(row.personnelId, {
                                  score: e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                            />
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'salary') &&
                          (entryMode === 'all' || entryMode === 'attendance') && (
                        <TableCell className="text-right tabular-nums">
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Link
                              to={getPersonnelPayHref(row.personnelId, 'baseSalary')}
                              className="underline-offset-2 hover:underline"
                              title="调整底薪"
                            >
                              {money(row.paidBaseSalary)}
                            </Link>
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'salary') &&
                          (entryMode === 'all' || entryMode === 'score') && (
                        <TableCell className="text-right tabular-nums">
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Link
                              to={getPersonnelPayHref(row.personnelId, 'performance')}
                              className="underline-offset-2 hover:underline"
                              title="调整绩效"
                            >
                              {money(row.paidPerformance)}
                            </Link>
                          )}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'adjust') && (
                        <TableCell
                          className={entryMode === 'otherDeduct' ? 'bg-orange-50/40' : undefined}
                        >
                          <MPayrollAdjCell
                            kind="bonus"
                            amount={entry.otherBonus || 0}
                            note={entry.otherBonusNote || ''}
                            lines={entry.otherBonusLines || []}
                            onChange={(next) =>
                              updateEntry(row.personnelId, {
                                otherBonus: next.amount,
                                otherBonusNote: next.note,
                                otherBonusLines: next.lines,
                              })
                            }
                          />
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'adjust') && (
                        <TableCell
                          className={entryMode === 'otherDeduct' ? 'bg-orange-50/40' : undefined}
                        >
                          <MPayrollAdjCell
                            kind="deduction"
                            amount={entry.otherDeduction || 0}
                            note={entry.otherDeductionNote || ''}
                            lines={entry.otherDeductionLines || []}
                            onChange={(next) =>
                              updateEntry(row.personnelId, {
                                otherDeduction: next.amount,
                                otherDeductionNote: next.note,
                                otherDeductionLines: next.lines,
                              })
                            }
                          />
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'salary') &&
                          (entryMode === 'all' ||
                            entryMode === 'insurance' ||
                            entryMode === 'otherDeduct' ||
                            entryMode === 'tax') && (
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-700">
                          {money(row.payable)}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'insurance') && (() => {
                          const person = personnel.find((p) => p.id === row.personnelId)
                          const archive = person
                            ? getArchiveInsurance(person, yearMonth)
                            : {
                              socialEmployer: 0,
                              housingEmployer: 0,
                              socialPersonal: row.socialInsurancePersonal || 0,
                              housingPersonal: row.housingFundPersonal || 0,
                            }
                          return (
                            <>
                              <TableCell className="bg-amber-50/40 text-right tabular-nums">
                                {onlyCommission ? '—' : money(archive.socialEmployer)}
                              </TableCell>
                              <TableCell className="bg-amber-50/40 text-right tabular-nums">
                                {onlyCommission ? '—' : money(archive.socialPersonal)}
                              </TableCell>
                              <TableCell className="bg-amber-50/40 text-right tabular-nums">
                                {onlyCommission ? '—' : money(archive.housingEmployer)}
                              </TableCell>
                              <TableCell className="bg-amber-50/40 text-right tabular-nums">
                                {onlyCommission ? '—' : money(archive.housingPersonal)}
                              </TableCell>
                              {entryMode === 'insurance' && (
                                <TableCell className="bg-amber-50/40">
                                  {onlyCommission ? (
                                    <span className="text-xs text-muted-foreground">合作方不缴纳</span>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-1">
                                      {person && (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-7 px-2 text-xs"
                                          onClick={() => {
                                            if (!ensureCanAdjustPayrollArchive('调整社保公积金')) return
                                            setInsuranceAdjust({
                                              mode: 'single',
                                              person,
                                            })
                                          }}
                                        >
                                          去调整
                                        </Button>
                                      )}
                                      {person && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-xs text-muted-foreground"
                                          onClick={() => setHistoryPerson(person)}
                                        >
                                          记录
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </TableCell>
                              )}
                            </>
                          )
                        })()}
                        {showPayrollCol(entryMode, 'special') && (() => {
                          const person = personnel.find((p) => p.id === row.personnelId)
                          const specialAmt = person
                            ? getArchiveSpecialAdditional(person)
                            : (row.specialAdditional || 0)
                          return (
                            <>
                              <TableCell className="bg-orange-50/40 text-right tabular-nums">
                                {money(specialAmt)}
                              </TableCell>
                              {entryMode === 'otherDeduct' && (
                                <TableCell className="bg-orange-50/40">
                                  <div className="flex flex-wrap items-center gap-1">
                                    {person && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => {
                                          if (!ensureCanAdjustPayrollArchive('调整专项附加')) return
                                          setSpecialAdjust({
                                            mode: 'single',
                                            person,
                                          })
                                        }}
                                      >
                                        去调整
                                      </Button>
                                    )}
                                    {person && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-xs text-muted-foreground"
                                        onClick={() =>
                                          setSpecialAdjust({
                                            mode: 'history',
                                            person,
                                          })
                                        }
                                      >
                                        记录
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              )}
                            </>
                          )
                        })()}
                        {showPayrollCol(entryMode, 'tax')
                          && shouldUseIitCycleOpening(yearMonth)
                          && (() => {
                            const person = personnel.find((p) => p.id === row.personnelId)
                            if (!person) {
                              return (
                                <>
                                  <TableCell className="bg-violet-50/40" />
                                  <TableCell className="bg-violet-50/40" />
                                  <TableCell className="bg-violet-50/40" />
                                </>
                              )
                            }
                            const canEditOpening = isIitOpeningEditMonth(yearMonth)
                            return (
                              <>
                                <TableCell className="bg-violet-50/40">
                                  {canEditOpening ? (
                                    <>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        className="ml-auto h-8 w-[100px] text-right"
                                        title="期初已预缴（截至 2026-09）"
                                        defaultValue={row.iitOpeningTaxPaid ?? 0}
                                        key={`paid-${person.id}-${row.iitOpeningTaxPaid ?? 0}`}
                                        onBlur={(e) => {
                                          const v = e.target.value === '' ? 0 : Number(e.target.value) || 0
                                          if (v === (row.iitOpeningTaxPaid ?? 0)) return
                                          void handleSaveIitOpening(person, { taxPaid: v })
                                        }}
                                      />
                                      <div className="mt-1 text-right text-[10px] text-muted-foreground tabular-nums">
                                        本月B={money(row.taxPaidBeforeThisMonth || 0)}
                                      </div>
                                    </>
                                  ) : (
                                    (() => {
                                      const carry = getIitCarryFromPriorMonth({
                                        person,
                                        yearMonth,
                                      })
                                      return (
                                        <div
                                          className="text-right tabular-nums"
                                          title={
                                            carry
                                              ? `${carry.priorYm}已预缴B ${money(carry.priorB)} + 本期个税 ${money(carry.priorPeriodTax)}`
                                              : '上月B + 上月本期个税'
                                          }
                                        >
                                          {money(row.taxPaidBeforeThisMonth || 0)}
                                          <div className="mt-1 text-[10px] text-muted-foreground leading-snug">
                                            {carry
                                              ? `${carry.priorYm.slice(5)}月B ${money(carry.priorB)}+个税 ${money(carry.priorPeriodTax)}`
                                              : '上月B+本期个税'}
                                          </div>
                                        </div>
                                      )
                                    })()
                                  )}
                                </TableCell>
                                <TableCell className="bg-violet-50/40">
                                  {canEditOpening ? (
                                    <>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        className="ml-auto h-8 w-[100px] text-right"
                                        title="期初累计扣税基数（截至 2026-09）"
                                        defaultValue={row.iitOpeningTaxBase ?? 0}
                                        key={`base-${person.id}-${row.iitOpeningTaxBase ?? 0}`}
                                        onBlur={(e) => {
                                          const v = e.target.value === '' ? 0 : Number(e.target.value) || 0
                                          if (v === (row.iitOpeningTaxBase ?? 0)) return
                                          void handleSaveIitOpening(person, { taxBase: v })
                                        }}
                                      />
                                      <div className="mt-1 text-right text-[10px] text-muted-foreground tabular-nums">
                                        本月税基={money(row.cumulativeTaxBase || 0)}
                                      </div>
                                    </>
                                  ) : (
                                    (() => {
                                      const carry = getIitCarryFromPriorMonth({
                                        person,
                                        yearMonth,
                                      })
                                      return (
                                        <div
                                          className="text-right tabular-nums"
                                          title={
                                            carry
                                              ? `${carry.priorYm}应纳税所得额C ${money(carry.priorC)}`
                                              : '上月应纳税所得额C'
                                          }
                                        >
                                          {money(row.cumulativeTaxBase || 0)}
                                          <div className="mt-1 text-[10px] text-muted-foreground leading-snug">
                                            {carry
                                              ? `${carry.priorYm.slice(5)}月C ${money(carry.priorC)}`
                                              : '上月应纳税所得额C'}
                                          </div>
                                        </div>
                                      )
                                    })()
                                  )}
                                </TableCell>
                                <TableCell className="bg-violet-50/40">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="ml-auto h-8 w-[110px] text-right tabular-nums"
                                    title="应纳税所得额 C = 税基+应发−社保−公积金−本月专项附加；可改"
                                    value={
                                      entry.taxableIncomeOverride != null
                                        ? entry.taxableIncomeOverride
                                        : (row.autoTaxableIncome
                                          ?? row.cumulativeTaxable
                                          ?? 0)
                                    }
                                    onChange={(e) => {
                                      const raw = e.target.value.trim()
                                      updateEntry(row.personnelId, {
                                        taxableIncomeOverride:
                                          raw === '' ? null : Number(raw) || 0,
                                      })
                                    }}
                                    onBlur={(e) => {
                                      const raw = e.target.value.trim()
                                      const auto =
                                        Number(row.autoTaxableIncome) || 0
                                      if (raw === '') {
                                        updateEntry(row.personnelId, {
                                          taxableIncomeOverride: null,
                                        })
                                        return
                                      }
                                      const v = Number(raw) || 0
                                      // 与自动值相同则清回自动，避免多余覆盖
                                      if (Math.abs(v - auto) < 0.005) {
                                        updateEntry(row.personnelId, {
                                          taxableIncomeOverride: null,
                                        })
                                      }
                                    }}
                                  />
                                  <div className="mt-1 text-right text-[10px] text-muted-foreground tabular-nums">
                                    {money(row.cumulativeTaxBase || 0)}+
                                    {money(row.payableForTax ?? row.payable ?? 0)}−
                                    {money(row.socialInsurancePersonal || 0)}−
                                    {money(row.housingFundPersonal || 0)}−
                                    {money(row.specialAdditional || 0)}
                                  </div>
                                </TableCell>
                              </>
                            )
                          })()}
                        {showPayrollCol(entryMode, 'tax') && (() => {
                          const taxBase = Number(row.cumulativeTaxBase) || 0
                          const pay = Number(row.payableForTax ?? row.payable) || 0
                          const social = Number(row.socialInsurancePersonal) || 0
                          const housing = Number(row.housingFundPersonal) || 0
                          const special = Number(row.specialAdditional) || 0
                          const autoC = Number(row.autoTaxableIncome) || 0
                          const cVal = Number(row.cumulativeTaxable) || 0
                          const n = Number(row.iitCycleMonthIndex) || 1
                          const basicDeduct =
                            Number(row.cumulativeBasicDeduction)
                            || MONTHLY_BASIC_DEDUCTION * n
                          const baseForA =
                            Number(row.taxBaseForA)
                            || getIitTaxBaseForA(cVal, n)
                          const bVal = Number(row.taxPaidBeforeThisMonth) || 0
                          const bracket = resolveIitBracket(baseForA)
                          const aVal = Number(row.cumulativeTaxDue) || bracket.tax
                          const systemTax = Number(row.systemIncomeTax ?? row.incomeTax) || 0
                          const ratePct = `${(bracket.rate * 100).toFixed(0)}%`
                          const cIsOverride = entry.taxableIncomeOverride != null
                          return (
                        <TableCell className="bg-amber-50/40 align-top">
                          <div className="space-y-1.5 min-w-[220px]">
                            <Input
                              type="number"
                              className="h-8 w-[96px]"
                              title="可手工覆盖本期个税"
                              value={
                                entry.incomeTaxOverride != null
                                  ? entry.incomeTaxOverride
                                  : (row.incomeTax || 0)
                              }
                              onChange={(e) =>
                                updateEntry(row.personnelId, {
                                  incomeTaxOverride:
                                    e.target.value === '' ? null : Number(e.target.value) || 0,
                                })
                              }
                            />
                            {entryMode === 'tax' && (
                              <div className="rounded border border-amber-200/80 bg-white/80 px-2 py-1.5 text-[10px] leading-relaxed text-amber-950 tabular-nums">
                                <div>
                                  C(应纳税所得额) ={' '}
                                  {cIsOverride ? (
                                    <>手工 {money(cVal)}</>
                                  ) : (
                                    <>
                                      {money(taxBase)}+{money(pay)}−{money(social)}−
                                      {money(housing)}−{money(special)}={money(autoC)}
                                    </>
                                  )}
                                </div>
                                <div className="text-muted-foreground">
                                  N={n}（入职月起算；减除 {MONTHLY_BASIC_DEDUCTION}×{n}=
                                  {money(basicDeduct)}）
                                </div>
                                <div>
                                  A = ROUND(MAX((C−{money(basicDeduct)})×{ratePct}−
                                  {money(bracket.quick)}, 0), 2)
                                  <span className="text-muted-foreground">
                                    {' '}税基 {money(baseForA)}
                                  </span>
                                  {' '}= {money(aVal)}
                                </div>
                                <div>B(已预缴个税) = {money(bVal)}</div>
                                <div className="font-medium text-amber-900">
                                  本期个税 = max(A−B, 0) = max({money(aVal)}−{money(bVal)}, 0) ={' '}
                                  {money(systemTax)}
                                </div>
                              </div>
                            )}
                          </div>
                        </TableCell>
                          )
                        })()}
                        {showPayrollCol(entryMode, 'tax') && (
                        <TableCell className="text-right tabular-nums font-semibold text-sky-700 bg-amber-50/40">
                          {money(row.netPay || 0)}
                        </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={payrollColSpan(
                          entryMode,
                          entryMode === 'score' ? activeScoreRuleItems.length : 0,
                        )}
                        className="py-8 text-center text-muted-foreground"
                      >
                        纳入单位下本月暂无在职归属人员
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <span>
                提成合计 <strong>{money(totals.commission)}</strong>
              </span>
              <span>
                实发底薪合计 <strong>{money(totals.paidBaseSalary)}</strong>
              </span>
              <span>
                保密费合计 <strong>{money(totals.paidConfidentialityFee)}</strong>
              </span>
              <span>
                岗位补贴合计 <strong>{money(totals.paidPositionAllowance)}</strong>
              </span>
              <span>
                实发绩效合计 <strong>{money(totals.paidPerformance)}</strong>
              </span>
              <span className="text-emerald-700">
                应发合计 <strong>{money(totals.payable)}</strong>
              </span>
              <span>
                代扣个税合计 <strong>{money(totals.incomeTax)}</strong>
              </span>
              <span className="text-sky-700">
                实发合计 <strong>{money(totals.netPay)}</strong>
              </span>
            </div>
          )}
                  </>
          )}
</CardContent>
      </Card>

      <MPayrollScoreRuleDialog
        open={scoreRuleDialogOpen}
        onOpenChange={setScoreRuleDialogOpen}
        unitId={filterUnitId}
        unitName={filterUnitName}
        initialItems={activeScoreRuleItems}
        saving={scoreRuleSaving}
        onSave={handleSaveScoreRule}
      />

      <MInsurancePersonalDialog
        open={Boolean(insuranceAdjust)}
        onOpenChange={(open) => {
          if (!open) setInsuranceAdjust(null)
        }}
        mode={insuranceAdjust?.mode || 'single'}
        person={insuranceAdjust?.person || null}
        people={rows
          .map((r) => personnel.find((p) => p.id === r.personnelId))
          .filter((p): p is Personnel => Boolean(p))}
        defaultEffectiveDate={`${yearMonth}-01`}
        {...(() => {
          const seedPerson =
            insuranceAdjust?.mode === 'single' && insuranceAdjust.person
              ? insuranceAdjust.person
              : rows
                .map((r) => personnel.find((p) => p.id === r.personnelId))
                .find((p): p is Personnel => Boolean(p))
          const seed = seedPerson
            ? getArchiveInsurance(seedPerson, yearMonth)
            : {
              socialEmployer: 0,
              housingEmployer: 0,
              socialPersonal: 0,
              housingPersonal: 0,
            }
          return {
            defaultSocialEmployer: seed.socialEmployer,
            defaultHousingEmployer: seed.housingEmployer,
            defaultSocialPersonal: seed.socialPersonal,
            defaultHousingPersonal: seed.housingPersonal,
          }
        })()}
        onAdjusted={(ids) => {
          setEntries((prev) => {
            const next = { ...prev }
            for (const id of ids) {
              const cur = next[id] || createEmptyPayrollEntry(id)
              next[id] = {
                ...cur,
                socialInsurancePersonal: null,
                housingFundPersonal: null,
              }
            }
            return next
          })
          setSavedTip(`已更新 ${ids.length} 人社保公积金档案`)
          window.setTimeout(() => setSavedTip(''), 2500)
        }}
      />

      <MPayPlanDialog
        person={historyPerson}
        open={Boolean(historyPerson)}
        onOpenChange={(open) => {
          if (!open) setHistoryPerson(null)
        }}
        canEdit={false}
      />

      <MSpecialAdditionalDialog
        open={Boolean(specialAdjust)}
        onOpenChange={(open) => {
          if (!open) setSpecialAdjust(null)
        }}
        mode={specialAdjust?.mode || 'single'}
        person={specialAdjust?.person || null}
        people={rows
          .map((r) => personnel.find((p) => p.id === r.personnelId))
          .filter((p): p is Personnel => Boolean(p))}
        onAdjusted={(ids) => {
          setEntries((prev) => {
            const next = { ...prev }
            for (const id of ids) {
              const cur = next[id] || createEmptyPayrollEntry(id)
              next[id] = {
                ...cur,
                specialAdditional: null,
              }
            }
            return next
          })
          setSavedTip(`已更新 ${ids.length} 人专项附加档案`)
          window.setTimeout(() => setSavedTip(''), 2500)
        }}
      />
    </div>
  )
}
