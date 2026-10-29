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
import { formatCurrency } from '@/lib/format'
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
import { calculateMonthlySalary, isPersonnelOnDutyInMonth } from '@/lib/salary'
import { personBelongsToUnitInMonth } from '@/lib/unitAssignment'

/**
 * 工资核算 · 本地原型
 * - 纳入单位名单、出勤、考核分存 localStorage
 * - 底薪/绩效标准、业绩提成读系统现有数据
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
    savePayrollEntries(yearMonth, entries)
    setSavedTip(`${yearMonth} 出勤/考核录入已保存（本机）`)
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
        list.push(
          calcPayrollRow({
            personnelId: person.id,
            name: person.name,
            unitId: unit.id,
            unitName: unitNameMap.get(unit.id) || unit.name,
            standardBaseSalary: calc.baseSalary,
            standardPerformance: calc.performance,
            commission,
            entry,
          }),
        )
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
        acc.paidPerformance += row.paidPerformance
        acc.payable += row.payable
        return acc
      },
      { commission: 0, paidBaseSalary: 0, paidPerformance: 0, payable: 0 },
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
      '标准绩效',
      '业绩提成',
      '出勤小时',
      '考核分',
      '实发底薪',
      '实发绩效',
      '其他加项',
      '其他减项',
      '应发合计',
      '备注',
    ]
    const lines = rows.map((r) => {
      const entry = entries[r.personnelId] || createEmptyPayrollEntry(r.personnelId)
      return [
        yearMonth,
        r.unitName,
        r.name,
        r.standardBaseSalary.toFixed(2),
        r.standardPerformance.toFixed(2),
        r.commission.toFixed(2),
        r.attendanceHours.toFixed(2),
        r.score.toFixed(1),
        r.paidBaseSalary.toFixed(2),
        r.paidPerformance.toFixed(2),
        (entry.otherBonus || 0).toFixed(2),
        (entry.otherDeduction || 0).toFixed(2),
        r.payable.toFixed(2),
        entry.note || '',
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',')
    })
    const bom = '\uFEFF'
    const blob = new Blob([bom + [header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `工资核算原型_${yearMonth}.csv`
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
            应发 = 业绩提成 + 实发底薪 + 实发绩效 + 其他加项 − 其他减项；月出勤系数{' '}
            21.75 × 7.5 = {PAYROLL_STANDARD_HOURS} 小时；未填出勤按满勤，未填考核分按 100 分。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>实发底薪 = 标准底薪 × (出勤小时 / {PAYROLL_STANDARD_HOURS})</p>
          <p>
            实发绩效 = 标准绩效 × (出勤小时 / {PAYROLL_STANDARD_HOURS}) × (考核分 / 100)
          </p>
          <p>业绩提成 = 系统个人提成 + 内部销售提成 + 团队管理提成（只读）</p>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calculator className="h-5 w-5" />
            2. 月度工资表
          </CardTitle>
          <CardDescription>
            标准底薪/绩效、业绩提成来自系统；出勤小时与考核分需人工填写后参与计算。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">单位</TableHead>
                    <TableHead className="min-w-[88px]">姓名</TableHead>
                    <TableHead className="text-right">标准底薪</TableHead>
                    <TableHead className="text-right">标准绩效</TableHead>
                    <TableHead className="text-right">业绩提成</TableHead>
                    <TableHead className="min-w-[108px]">出勤小时</TableHead>
                    <TableHead className="min-w-[88px]">考核分</TableHead>
                    <TableHead className="text-right">实发底薪</TableHead>
                    <TableHead className="text-right">实发绩效</TableHead>
                    <TableHead className="min-w-[88px]">加项</TableHead>
                    <TableHead className="min-w-[88px]">减项</TableHead>
                    <TableHead className="text-right font-semibold">应发</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const entry = entries[row.personnelId] || createEmptyPayrollEntry(row.personnelId)
                    return (
                      <TableRow key={`${row.unitId}-${row.personnelId}`}>
                        <TableCell className="text-xs text-muted-foreground">{row.unitName}</TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.standardBaseSalary)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.standardPerformance)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Link
                            to={`/payroll/commission-detail?personnelId=${encodeURIComponent(row.personnelId)}&unitId=${encodeURIComponent(row.unitId)}&yearMonth=${encodeURIComponent(yearMonth)}`}
                            className="font-medium text-violet-700 underline-offset-2 hover:underline"
                            title="查看个人业绩提成明细（业绩 / 比例 / 金额）"
                          >
                            {formatCurrency(row.commission)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.5"
                            min={0}
                            max={PAYROLL_STANDARD_HOURS * 2}
                            className="h-8 w-[104px]"
                            placeholder={String(PAYROLL_STANDARD_HOURS)}
                            value={entry.attendanceHours ?? ''}
                            onChange={(e) =>
                              updateEntry(row.personnelId, {
                                attendanceHours:
                                  e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.paidBaseSalary)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.paidPerformance)}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="h-8 w-[84px]"
                            value={entry.otherBonus || 0}
                            onChange={(e) =>
                              updateEntry(row.personnelId, {
                                otherBonus: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="h-8 w-[84px]"
                            value={entry.otherDeduction || 0}
                            onChange={(e) =>
                              updateEntry(row.personnelId, {
                                otherDeduction: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-700">
                          {formatCurrency(row.payable)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
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
                业绩提成合计 <strong>{formatCurrency(totals.commission)}</strong>
              </span>
              <span>
                实发底薪合计 <strong>{formatCurrency(totals.paidBaseSalary)}</strong>
              </span>
              <span>
                实发绩效合计 <strong>{formatCurrency(totals.paidPerformance)}</strong>
              </span>
              <span className="text-emerald-700">
                应发合计 <strong>{formatCurrency(totals.payable)}</strong>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
