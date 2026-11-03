import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Calculator, CheckSquare, FileSpreadsheet, Save } from 'lucide-react'

import { PageHeader } from '@/components/PageHeader'
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
import { formatCurrency, formatDisplayPersonName } from '@/lib/format'
import {
  calcPayrollRow,
  createEmptyPayrollEntry,
  isLikelyOpsCenterName,
  loadPayrollEntries,
  loadPayrollScopeUnitIds,
  PAYROLL_STANDARD_HOURS,
  savePayrollEntries,
  savePayrollScopeUnitIds,
  type PayrollMonthEntry,
  type PayrollRowResult,
} from '@/lib/payrollCalc'
import MPayrollAdjCell from '@/pages/Payroll/components/m-payroll-adj-cell'
import MPayrollEntryLinks, {
  type PayrollCalcPhase,
  type PayrollEntryMode,
} from '@/pages/Payroll/components/m-payroll-entry-links'
import { enrichPayrollRowWithTax, resolvePayrollTax } from '@/lib/payrollTaxApply'
import {
  calculateMonthlySalary,
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
    | 'score'
    | 'adjust'
    | 'insurance'
    | 'tax',
): boolean {
  // 最终工资表不展示出勤三列（仅在考勤录入步骤显示）
  if (mode === 'all') return col !== 'attendance'
  if (mode === 'attendance') {
    return col === 'core' || col === 'attendance' || col === 'salary'
  }
  if (mode === 'score') {
    return col === 'core' || col === 'score' || col === 'salary'
  }
  if (mode === 'insurance') {
    return col === 'core' || col === 'insurance' || col === 'salary'
  }
  // tax
  return col === 'core' || col === 'insurance' || col === 'tax' || col === 'salary'
}

function payrollColSpan(mode: PayrollEntryMode): number {
  // 与表头条件保持一致：单位+姓名=2
  if (mode === 'attendance') return 2 + 1 + 1 + 2 + 1 // 标准底薪 + 实际/缺勤/应出勤 + 实发底薪
  if (mode === 'score') return 2 + 1 + 1 + 1 // 标准绩效 + 分数 + 实发绩效
  if (mode === 'insurance') return 2 + 1 + 2 // 应发 + 社保 + 公积金
  if (mode === 'tax') return 2 + 1 + 2 + 3 // 应发 + 社保公积金 + 专项/个税/实发
  return 16 // 最终表不含出勤三列
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
 * 工资核算 · 本地原型
 * - 纳入单位名单、出勤、考核分存 localStorage
 * - 底薪/保密费/岗位补贴/绩效标准、业绩提成读系统现有数据
 */
export default function Payroll() {
  const {
    products,
    productPersonCommissions,
    teamMgmtCommissionRules,
    performanceTargets,
    unitProductSettlements,
  } = useData()
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords } =
    usePermissions()

  const [yearMonth, setYearMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [scopeUnitIds, setScopeUnitIds] = useState<string[]>(() => loadPayrollScopeUnitIds())
  const [draftScopeIds, setDraftScopeIds] = useState<string[]>(() => loadPayrollScopeUnitIds())
  const [entries, setEntries] = useState<Record<string, PayrollMonthEntry>>({})
  const [filterUnitId, setFilterUnitId] = useState('all')
  const [calcPhase, setCalcPhase] = useState<PayrollCalcPhase>('idle')
  const [entryMode, setEntryMode] = useState<PayrollEntryMode>('all')
  const [savedTip, setSavedTip] = useState('')

  const teamMgmtContext = useMemo(
    () => ({
      rules: teamMgmtCommissionRules,
      targets: performanceTargets,
      upsList: unitProductSettlements,
    }),
    [teamMgmtCommissionRules, performanceTargets, unitProductSettlements],
  )

  const opsCenterCandidates = useMemo(
    () =>
      salesUnits
        .filter((u) => isLikelyOpsCenterName(u.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [salesUnits],
  )

  const otherUnitCandidates = useMemo(
    () =>
      salesUnits
        .filter((u) => !isLikelyOpsCenterName(u.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [salesUnits],
  )

  const scopedUnits = useMemo(
    () => salesUnits.filter((u) => scopeUnitIds.includes(u.id)),
    [salesUnits, scopeUnitIds],
  )

  useEffect(() => {
    setEntries(loadPayrollEntries(yearMonth))
  }, [yearMonth])

  function handleToggleDraftUnit(unitId: string, checked: boolean) {
    setDraftScopeIds((prev) => {
      if (checked) return prev.includes(unitId) ? prev : [...prev, unitId]
      return prev.filter((id) => id !== unitId)
    })
  }

  function handleSaveScope() {
    savePayrollScopeUnitIds(draftScopeIds)
    setScopeUnitIds(draftScopeIds)
    window.dispatchEvent(new Event('payroll-scope-changed'))
    setSavedTip('纳入核算单位已保存（本机）')
    window.setTimeout(() => setSavedTip(''), 2000)
  }

  function handleSelectSuggestedOpsCenters() {
    setDraftScopeIds(opsCenterCandidates.map((u) => u.id))
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

  function handleSaveEntries() {
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
      }
    }
    setEntries(next)
    savePayrollEntries(yearMonth, next)
    setSavedTip(`${yearMonth} 出勤/考核/代扣个税已保存（本机）`)
    window.setTimeout(() => setSavedTip(''), 2000)
  }

  const rows: PayrollRowResult[] = useMemo(() => {
    if (scopedUnits.length === 0) return []

    const unitNameMap = new Map(salesUnits.map((u) => [u.id, u.name]))
    const list: PayrollRowResult[] = []

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
        const commission =
          (calc.personalCommission || 0) +
          (calc.internalSalesCommission || 0) +
          (calc.managementCommission || 0)

        const entry = entries[person.id] || createEmptyPayrollEntry(person.id)
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
        list.push(enrichPayrollRowWithTax(baseRow, person, yearMonth, entry))
      }
    }

    return list.sort((a, b) =>
      `${a.unitName}-${a.name}`.localeCompare(`${b.unitName}-${b.name}`, 'zh-CN'),
    )
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

  function handleExportCsv() {
    if (rows.length === 0) {
      alert('当前没有可导出的工资行，请先纳入单位并确认月份')
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
      '社保个人',
      '公积金个人',
      '专项附加',
      '本期个税',
      '实发',
    ]
    // Excel 会把 "2026-10" 自动当成日期显示成 Oct-26，导出用中文月份文本避免误识别
    const monthLabel = /^\d{4}-\d{2}$/.test(yearMonth)
      ? `${yearMonth.slice(0, 4)}年${Number(yearMonth.slice(5, 7))}月`
      : yearMonth

    const lines = rows.map((r) => {
      const entry = entries[r.personnelId] || createEmptyPayrollEntry(r.personnelId)
      return [
        monthLabel,
        r.unitName,
        r.name,
        r.standardBaseSalary.toFixed(2),
        r.paidConfidentialityFee.toFixed(2),
        r.paidPositionAllowance.toFixed(2),
        r.standardPerformance.toFixed(2),
        r.commission.toFixed(2),
        r.attendanceHours.toFixed(2),
        r.absenceHours.toFixed(2),
        r.expectedAttendanceHours.toFixed(2),
        r.score.toFixed(1),
        r.paidBaseSalary.toFixed(2),
        r.paidPerformance.toFixed(2),
        (entry.otherBonus || 0).toFixed(2),
        entry.otherBonusNote || '',
        (entry.otherDeduction || 0).toFixed(2),
        entry.otherDeductionNote || '',
        r.payable.toFixed(2),
        (r.socialInsurancePersonal || 0).toFixed(2),
        (r.housingFundPersonal || 0).toFixed(2),
        (r.specialAdditional || 0).toFixed(2),
        (r.incomeTax || 0).toFixed(2),
        (r.netPay || 0).toFixed(2),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',')
    })
    const bom = '\uFEFF'
    const blob = new Blob([bom + [header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    // 文件名：单位名称 + 月份（与筛选/导出内容一致）
    const unitNames = Array.from(new Set(rows.map((r) => r.unitName).filter(Boolean)))
    let unitLabel = '全部纳入单位'
    if (filterUnitId !== 'all') {
      const hit = scopedUnits.find((u) => u.id === filterUnitId)
      unitLabel = hit?.name || unitNames[0] || unitLabel
    } else if (unitNames.length === 1) {
      unitLabel = unitNames[0]
    } else if (unitNames.length > 1) {
      unitLabel = unitNames.length <= 3
        ? unitNames.join('、')
        : `${unitNames.slice(0, 2).join('、')}等${unitNames.length}家`
    }
    const safeUnit = unitLabel
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '')
      .slice(0, 60) || '工资表'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeUnit}_${monthLabel}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="工资核算"
        description="本地原型：先纳入运营中心单位，再按月录入出勤与考核分，生成可导出工资表。出勤/考核暂存本机，未接后端。"
      />

      <Card className="border-amber-200/80 bg-amber-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">本期默认公式（可再改）</CardTitle>
          <CardDescription>
            应发 = 提成 + 实发底薪 + 保密费 + 岗位补贴 + 实发绩效 + 其他加项 − 其他减项；月出勤系数{' '}
            21.75 × 7.5 = {PAYROLL_STANDARD_HOURS} 小时；未填缺勤按满勤（缺勤=0），未填考核分按 100 分。
            加项/减项可点「明细」录入多行说明与金额；黄列为人社代扣与累计个税（可改），实发=应发−社保个人−公积金个人−本期个税。
            专项附加与个人代扣默认在人员列表「个税扣除」维护（本机）。人员关闭「内部员工」后只核算提成。
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
            1. 纳入核算单位
          </CardTitle>
          <CardDescription>
            只有勾选并保存的单位才会进入工资表。默认建议勾选名称含「运营中心」的单位；分仓可不选。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleSelectSuggestedOpsCenters}>
              一键勾选全部运营中心（{opsCenterCandidates.length}）
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setDraftScopeIds([])}>
              清空勾选
            </Button>
            <Button type="button" size="sm" onClick={handleSaveScope}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              保存纳入名单
            </Button>
            {savedTip && <span className="text-sm text-emerald-700 self-center">{savedTip}</span>}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">运营中心候选</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {opsCenterCandidates.map((u) => (
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
              {opsCenterCandidates.length === 0 && (
                <p className="text-sm text-muted-foreground">暂无名称含「运营中心」的销售单位</p>
              )}
            </div>
          </div>

          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              其他单位（一般分仓不核算，可按需勾选）
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {otherUnitCandidates.map((u) => (
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
            </div>
          </details>

          <p className="text-sm text-muted-foreground">
            当前已生效纳入：
            {scopedUnits.length === 0
              ? '无（请勾选并保存）'
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
              <>默认不展示录入项与工资明细。请先点「去核算工资」，依次完成考勤、绩效分数、社保公积金、个税录入，再生成工资表。</>
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
              步骤 1/4 考勤录入 — 应出勤固定 {PAYROLL_STANDARD_HOURS} 小时；填写缺勤后，
              实际出勤 = 应出勤 − 缺勤。
            </p>
          )}
          {calcPhase === 'wizard' && entryMode === 'score' && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              步骤 2/4 绩效分数录入 — 请填写考核分（0–100）。
            </p>
          )}
          {calcPhase === 'wizard' && entryMode === 'insurance' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              步骤 3/4 社保公积金录入 — 填写个人代扣；默认来自人员「个税扣除」档案。
            </p>
          )}
          {calcPhase === 'wizard' && entryMode === 'tax' && (
            <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
              步骤 4/4 个税扣除预报 — 专项附加来自人员档案；本期个税可自动算或手工改。完成后点「生成工资表」。
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {calcPhase === 'idle' ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              尚未开始核算。请点击右上角「去核算工资」，按考勤 → 绩效分数 → 社保公积金 → 个税依次录入后生成工资表。
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
              <Label>筛选单位</Label>
              <Select value={filterUnitId} onValueChange={setFilterUnitId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="全部纳入单位" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部纳入单位</SelectItem>
                  {scopedUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={handleSaveEntries}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              保存本月录入
            </Button>
            <Button type="button" onClick={handleExportCsv}>
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
              导出 CSV
            </Button>
            <Badge variant="secondary" className="h-8 px-3">
              {rows.length} 人
            </Badge>
          </div>

          {scopedUnits.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              尚未纳入核算单位，请先在上方勾选并保存。
            </p>
          ) : (
            <div id="payroll-month-table" className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">单位</TableHead>
                    <TableHead className="min-w-[88px]">姓名</TableHead>
                    {showPayrollCol(entryMode, 'salary') && entryMode !== 'score' && (
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
                    {showPayrollCol(entryMode, 'salary') && entryMode === 'all' && (
                      <TableHead className="text-right">业绩提成</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'attendance') && (
                      <TableHead className="min-w-[108px] bg-sky-50/80">实际出勤</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'attendance') && (
                      <TableHead className="min-w-[96px] bg-sky-50/80">缺勤时间</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'attendance') && (
                      <TableHead className="min-w-[96px] bg-sky-50/80">应出勤时间</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'score') && (
                      <TableHead className="min-w-[88px] bg-emerald-50/80">绩效分数</TableHead>
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
                      <TableHead className="min-w-[148px]">加项 / 明细</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'adjust') && (
                      <TableHead className="min-w-[148px]">减项 / 明细</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'salary') &&
                      (entryMode === 'all' ||
                        entryMode === 'insurance' ||
                        entryMode === 'tax') && (
                      <TableHead className="text-right font-semibold">应发</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'insurance') && (
                      <TableHead className="min-w-[96px] bg-amber-50/80">社保个人</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'insurance') && (
                      <TableHead className="min-w-[96px] bg-amber-50/80">公积金个人</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'tax') && (
                      <TableHead className="text-right min-w-[96px] bg-amber-50/80">专项附加</TableHead>
                    )}
                    {showPayrollCol(entryMode, 'tax') && (
                      <TableHead className="min-w-[100px] bg-amber-50/80">本期个税</TableHead>
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
                        {showPayrollCol(entryMode, 'salary') && entryMode !== 'score' && (
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
                        {showPayrollCol(entryMode, 'salary') && entryMode === 'all' && (
                        <TableCell className="text-right tabular-nums">
                          <Link
                            to={`/payroll/commission-detail?personnelId=${encodeURIComponent(row.personnelId)}&unitId=${encodeURIComponent(row.unitId)}&yearMonth=${encodeURIComponent(yearMonth)}`}
                            className="font-medium text-violet-700 underline-offset-2 hover:underline"
                            title="查看个人业绩提成明细（订单金额 / 比例 / 提成）"
                          >
                            {money(row.commission)}
                          </Link>
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'attendance') && (
                        <TableCell
                          className={
                            entryMode === 'attendance'
                              ? 'bg-sky-50/40 text-right tabular-nums text-muted-foreground'
                              : 'text-right tabular-nums text-muted-foreground'
                          }
                          title="实际出勤 = 应出勤 − 缺勤"
                        >
                          {onlyCommission ? '—' : row.attendanceHours.toFixed(3)}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'attendance') && (
                        <TableCell className={entryMode === 'attendance' ? 'bg-sky-50/40' : undefined}>
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Input
                              type="number"
                              step="0.5"
                              min={0}
                              max={PAYROLL_STANDARD_HOURS}
                              className="h-8 w-[96px]"
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
                              ? 'bg-sky-50/40 text-right tabular-nums text-muted-foreground'
                              : 'text-right tabular-nums text-muted-foreground'
                          }
                          title="月应出勤固定（21.75×7.5）"
                        >
                          {onlyCommission ? '—' : row.expectedAttendanceHours.toFixed(3)}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'score') && (
                        <TableCell className={entryMode === 'score' ? 'bg-emerald-50/40' : undefined}>
                          {onlyCommission ? (
                            <span className="text-muted-foreground">—</span>
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
                        <TableCell>
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
                        <TableCell>
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
                            entryMode === 'tax') && (
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-700">
                          {money(row.payable)}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'insurance') && (
                        <TableCell className="bg-amber-50/40">
                          <Input
                            type="number"
                            className="h-8 w-[92px]"
                            value={entry.socialInsurancePersonal ?? row.socialInsurancePersonal ?? 0}
                            onChange={(e) =>
                              updateEntry(row.personnelId, {
                                socialInsurancePersonal: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'insurance') && (
                        <TableCell className="bg-amber-50/40">
                          <Input
                            type="number"
                            className="h-8 w-[92px]"
                            value={entry.housingFundPersonal ?? row.housingFundPersonal ?? 0}
                            onChange={(e) =>
                              updateEntry(row.personnelId, {
                                housingFundPersonal: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'tax') && (
                        <TableCell className="text-right tabular-nums bg-amber-50/40">
                          {money(row.specialAdditional || 0)}
                        </TableCell>
                        )}
                        {showPayrollCol(entryMode, 'tax') && (
                        <TableCell className="bg-amber-50/40">
                          <Input
                            type="number"
                            className="h-8 w-[96px]"
                            title="可手工覆盖系统累计预扣结果"
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
                        </TableCell>
                        )}
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
                      <TableCell colSpan={payrollColSpan(entryMode)} className="py-8 text-center text-muted-foreground">
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
    </div>
  )
}
