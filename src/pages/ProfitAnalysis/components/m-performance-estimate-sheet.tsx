import { useEffect, useMemo, useState } from 'react'
import { Calculator, ChevronDown, Download } from 'lucide-react'

import { formatCurrency } from '@/lib/format'
import {
  buildEstimateSnapshot,
  calcBreakEvenSales,
  calcPerformanceForecast,
  formatRatioAsPercentInput,
  getCommissionToSalesRatio,
  parseCommissionRatioPercent,
  parseMoneyInput,
  parseSettlementRatioPercent,
  type EstimateSnapshot,
} from '@/lib/performanceEstimate'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

export type EstimateSummaryInput = {
  salesAmount: number
  settlementIncome: number
  otherIncome: number
  totalCost: number
  manualCost?: number
  salaryCost?: number
  /** 当月销售提成（用于拆出固定成本、预填提成比例） */
  totalCommission?: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMonth: string
  /** 空数组 = 全部单位 */
  initialUnitIds: string[]
  monthOptions: Array<{ value: string; label: string }>
  salesUnits: Array<{ id: string; name: string }>
  /** months 为空表示 monthOptions 全部月份 */
  getSummary: (months: string[], unitIds: string[]) => EstimateSummaryInput
}

function normalizeUnitIds(
  ids: string[],
  unitCount: number,
): string[] {
  if (ids.length === 0 || ids.length === unitCount) return []
  return ids
}

function normalizeMonthIds(
  ids: string[],
  monthCount: number,
): string[] {
  if (ids.length === 0 || ids.length === monthCount) return []
  return ids
}

function getUnitFilterLabel(
  selectedIds: string[],
  units: Array<{ id: string; name: string }>,
): string {
  if (selectedIds.length === 0 || selectedIds.length === units.length) {
    return '全部单位'
  }
  if (selectedIds.length === 1) {
    return units.find((u) => u.id === selectedIds[0])?.name || '已选 1 个单位'
  }
  return `已选 ${selectedIds.length} 个单位`
}

function getMonthFilterLabel(
  selectedIds: string[],
  monthOptions: Array<{ value: string; label: string }>,
): string {
  if (selectedIds.length === 0 || selectedIds.length === monthOptions.length) {
    return '全部月份'
  }
  if (selectedIds.length === 1) {
    return monthOptions.find((m) => m.value === selectedIds[0])?.label
      || '已选 1 个月'
  }
  return `已选 ${selectedIds.length} 个月`
}

export default function MPerformanceEstimateSheet({
  open,
  onOpenChange,
  initialMonth,
  initialUnitIds,
  monthOptions,
  salesUnits,
  getSummary,
}: Props) {
  /** 空数组 = 全部月份（monthOptions） */
  const [estimateMonths, setEstimateMonths] = useState<string[]>([initialMonth])
  const [estimateUnitIds, setEstimateUnitIds] = useState<string[]>(
    normalizeUnitIds(initialUnitIds, salesUnits.length),
  )
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [unitPickerOpen, setUnitPickerOpen] = useState(false)
  const [summary, setSummary] = useState<EstimateSummaryInput | null>(null)
  const [snapshot, setSnapshot] = useState<EstimateSnapshot | null>(null)
  const [ratioPercentInput, setRatioPercentInput] = useState('')
  const [commissionPercentInput, setCommissionPercentInput] = useState('')
  const [otherIncomeInput, setOtherIncomeInput] = useState('')
  const [totalCostInput, setTotalCostInput] = useState('')
  const [predictedSalesInput, setPredictedSalesInput] = useState('')
  const [importedAt, setImportedAt] = useState('')
  const [costHint, setCostHint] = useState('')

  const isAllMonths =
    estimateMonths.length === 0
    || estimateMonths.length === monthOptions.length

  const isAllUnits =
    estimateUnitIds.length === 0
    || estimateUnitIds.length === salesUnits.length

  const monthFilterLabel = getMonthFilterLabel(estimateMonths, monthOptions)
  const unitFilterLabel = getUnitFilterLabel(estimateUnitIds, salesUnits)

  const settlementRatio = useMemo(
    () => parseSettlementRatioPercent(ratioPercentInput),
    [ratioPercentInput],
  )

  const commissionRatio = useMemo(
    () => parseCommissionRatioPercent(commissionPercentInput),
    [commissionPercentInput],
  )

  const editableOtherIncome = useMemo(
    () => parseMoneyInput(otherIncomeInput),
    [otherIncomeInput],
  )

  const editableFixedCost = useMemo(
    () => parseMoneyInput(totalCostInput),
    [totalCostInput],
  )

  const predictedSales = useMemo(
    () => parseMoneyInput(predictedSalesInput),
    [predictedSalesInput],
  )

  const workingSnapshot = useMemo(() => {
    if (!snapshot) return null
    return buildEstimateSnapshot({
      salesAmount: snapshot.salesAmount,
      settlementIncome: snapshot.settlementIncome,
      otherIncome: editableOtherIncome,
      totalCost: editableFixedCost,
      suggestedRatio: snapshot.suggestedRatio,
      suggestedCommissionRatio: snapshot.suggestedCommissionRatio,
    })
  }, [snapshot, editableOtherIncome, editableFixedCost])

  function applySummary(nextSummary: EstimateSummaryInput) {
    setSummary(nextSummary)
    const commission = nextSummary.totalCommission ?? 0
    const fixedCost = Math.max(0, nextSummary.totalCost - commission)
    const suggestedCommissionRatio = getCommissionToSalesRatio(
      commission,
      nextSummary.salesAmount,
    )
    const next = buildEstimateSnapshot({
      salesAmount: nextSummary.salesAmount,
      settlementIncome: nextSummary.settlementIncome,
      otherIncome: nextSummary.otherIncome,
      totalCost: fixedCost,
      suggestedCommissionRatio,
    })
    setSnapshot(next)
    setOtherIncomeInput(String(nextSummary.otherIncome || 0))
    setTotalCostInput(String(fixedCost || 0))
    setPredictedSalesInput(String(nextSummary.salesAmount || 0))
    if (next.suggestedRatio > 0) {
      setRatioPercentInput(formatRatioAsPercentInput(next.suggestedRatio))
    } else {
      setRatioPercentInput('')
    }
    setCommissionPercentInput(
      suggestedCommissionRatio > 0
        ? formatRatioAsPercentInput(suggestedCommissionRatio)
        : '0',
    )

    const manual = nextSummary.manualCost ?? 0
    const salary = nextSummary.salaryCost ?? 0
    const salaryWithoutCommission = Math.max(0, salary - commission)
    setCostHint(
      `固定成本已扣所选期间提成 ${formatCurrency(commission)}`
        + `（录入 ${formatCurrency(manual)}`
        + ` + 人力非提成 ${formatCurrency(salaryWithoutCommission)}）`,
    )
    setImportedAt(new Date().toLocaleString('zh-CN', { hour12: false }))
  }

  function handleImportCostAndIncome(
    months = estimateMonths,
    unitIds = estimateUnitIds,
  ) {
    const normalizedMonths = normalizeMonthIds(months, monthOptions.length)
    const normalizedUnits = normalizeUnitIds(unitIds, salesUnits.length)
    applySummary(getSummary(normalizedMonths, normalizedUnits))
  }

  function handleSelectAllMonths() {
    setEstimateMonths([])
    handleImportCostAndIncome([], estimateUnitIds)
  }

  function handleToggleMonth(month: string, checked: boolean) {
    if (isAllMonths) {
      if (!checked) return
      const next = [month]
      setEstimateMonths(next)
      handleImportCostAndIncome(next, estimateUnitIds)
      return
    }
    let next = checked
      ? Array.from(new Set([...estimateMonths, month]))
      : estimateMonths.filter((id) => id !== month)
    next = normalizeMonthIds(next, monthOptions.length)
    setEstimateMonths(next)
    handleImportCostAndIncome(next, estimateUnitIds)
  }

  function handleSelectAllUnits() {
    setEstimateUnitIds([])
    handleImportCostAndIncome(estimateMonths, [])
  }

  function handleToggleUnit(unitId: string, checked: boolean) {
    if (isAllUnits) {
      if (!checked) return
      const next = [unitId]
      setEstimateUnitIds(next)
      handleImportCostAndIncome(estimateMonths, next)
      return
    }
    let next = checked
      ? Array.from(new Set([...estimateUnitIds, unitId]))
      : estimateUnitIds.filter((id) => id !== unitId)
    next = normalizeUnitIds(next, salesUnits.length)
    setEstimateUnitIds(next)
    handleImportCostAndIncome(estimateMonths, next)
  }

  useEffect(() => {
    if (!open) return
    const normalizedUnits = normalizeUnitIds(initialUnitIds, salesUnits.length)
    const nextMonths = [initialMonth]
    setEstimateMonths(nextMonths)
    setEstimateUnitIds(normalizedUnits)
    applySummary(getSummary(nextMonths, normalizedUnits))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时同步页面筛选并带入
  }, [open])

  const breakEven = useMemo(() => {
    if (!workingSnapshot || settlementRatio <= 0) return null
    return calcBreakEvenSales({
      otherIncome: workingSnapshot.otherIncome,
      totalCost: workingSnapshot.totalCost,
      settlementRatio,
      commissionRatio,
      currentSales: workingSnapshot.salesAmount,
    })
  }, [workingSnapshot, settlementRatio, commissionRatio])

  const forecast = useMemo(() => {
    if (!workingSnapshot || settlementRatio <= 0) return null
    return calcPerformanceForecast({
      predictedSales,
      settlementRatio,
      commissionRatio,
      otherIncome: workingSnapshot.otherIncome,
      totalCost: workingSnapshot.totalCost,
      currentSales: workingSnapshot.salesAmount,
      currentProfit: workingSnapshot.profit,
    })
  }, [workingSnapshot, predictedSales, settlementRatio, commissionRatio])

  const periodSalesLabel = isAllMonths || estimateMonths.length > 1
    ? '所选期间实收'
    : '当前实收'
  const periodSettlementLabel = isAllMonths || estimateMonths.length > 1
    ? '所选期间结算收入'
    : '当前结算收入'
  const periodProfitLabel = isAllMonths || estimateMonths.length > 1
    ? '所选期间净利润（系统）'
    : '当前净利润（系统）'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl"
      >
        <SheetHeader className="border-b pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            业绩测算
          </SheetTitle>
          <SheetDescription>
            带入所选月份与单位的实收、结算、成本，按期间业绩倒推盈亏线与预测。
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 p-4">
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>测算月份（可单选/多选）</Label>
                <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full justify-between font-normal"
                    >
                      <span className="truncate">{monthFilterLabel}</span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2" align="start">
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      <p className="px-2 pb-1 text-xs text-muted-foreground">
                        点选月份可看当月；可多选做期间预测
                      </p>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={handleSelectAllMonths}
                      >
                        <Checkbox checked={isAllMonths} />
                        <span>全部月份</span>
                      </button>
                      <div className="my-1 border-t" />
                      {monthOptions.map((m) => {
                        const checked =
                          !isAllMonths && estimateMonths.includes(m.value)
                        return (
                          <label
                            key={m.value}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                handleToggleMonth(m.value, v === true)
                              }
                            />
                            <span className="truncate">{m.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label>测算单位（可单选/多选）</Label>
                <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full justify-between font-normal"
                    >
                      <span className="truncate">{unitFilterLabel}</span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2" align="start">
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      <p className="px-2 pb-1 text-xs text-muted-foreground">
                        点选单位可单选；可继续勾选多个
                      </p>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={handleSelectAllUnits}
                      >
                        <Checkbox checked={isAllUnits} />
                        <span>全部单位</span>
                      </button>
                      <div className="my-1 border-t" />
                      {salesUnits.map((u) => {
                        // 全部时只勾「全部单位」，各单位不勾，便于点选单单位
                        const checked =
                          !isAllUnits && estimateUnitIds.includes(u.id)
                        return (
                          <label
                            key={u.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                handleToggleUnit(u.id, v === true)
                              }
                            />
                            <span className="truncate">{u.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {importedAt
                  ? `已带入 ${importedAt}`
                  : '切换月份/单位后会按所选期间自动重新带入'}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => handleImportCostAndIncome()}
              >
                <Download className="mr-1.5 h-4 w-4" />
                一键带入成本与收入
              </Button>
            </div>
          </div>

          {workingSnapshot && snapshot && summary ? (
            <>
              <section className="space-y-3 rounded-lg border p-3">
                <h3 className="text-sm font-medium">成本与收入（可改）</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="est-other-income">其他收入（元）</Label>
                    <Input
                      id="est-other-income"
                      inputMode="decimal"
                      value={otherIncomeInput}
                      onChange={(e) => setOtherIncomeInput(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="est-total-cost">固定成本（元）</Label>
                    <Input
                      id="est-total-cost"
                      inputMode="decimal"
                      value={totalCostInput}
                      onChange={(e) => setTotalCostInput(e.target.value)}
                    />
                  </div>
                </div>
                {costHint ? (
                  <p className="text-xs text-muted-foreground">{costHint}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  固定成本不含「随实收变动的销售提成」；提成在下方单独填写比例。
                </p>
                <div className="grid grid-cols-2 gap-2 border-t pt-2 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{periodSalesLabel}</p>
                    <p className="font-medium">
                      {formatCurrency(snapshot.salesAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {periodSettlementLabel}
                    </p>
                    <p className="font-medium">
                      {formatCurrency(snapshot.settlementIncome)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{periodProfitLabel}</p>
                    <p
                      className={`font-medium ${
                        snapshot.settlementIncome
                          + snapshot.otherIncome
                          - summary.totalCost
                        > 0
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      }`}
                    >
                      {formatCurrency(
                        snapshot.settlementIncome
                          + snapshot.otherIncome
                          - summary.totalCost,
                      )}
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                <h3 className="text-sm font-medium">结算与提成比例</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="settlement-ratio">结算比例（占实收）</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="settlement-ratio"
                        inputMode="decimal"
                        value={ratioPercentInput}
                        onChange={(e) => setRatioPercentInput(e.target.value)}
                        placeholder="例如 45"
                      />
                      <span className="shrink-0 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="commission-ratio">提成比例（占实收）</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="commission-ratio"
                        inputMode="decimal"
                        value={commissionPercentInput}
                        onChange={(e) => setCommissionPercentInput(e.target.value)}
                        placeholder="例如 8"
                      />
                      <span className="shrink-0 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {snapshot.suggestedRatio > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setRatioPercentInput(
                          formatRatioAsPercentInput(snapshot.suggestedRatio),
                        )
                      }
                    >
                      结算用所选期间参考
                      {(snapshot.suggestedRatio * 100).toFixed(1)}%
                    </Button>
                  ) : null}
                  {snapshot.suggestedCommissionRatio > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setCommissionPercentInput(
                          formatRatioAsPercentInput(
                            snapshot.suggestedCommissionRatio,
                          ),
                        )
                      }
                    >
                      提成用所选期间参考
                      {(snapshot.suggestedCommissionRatio * 100).toFixed(1)}%
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  净贡献比例 = 结算比例 − 提成比例；盈亏线实收 =（固定成本 − 其他收入）÷ 净贡献比例
                </p>
                {settlementRatio <= 0 ? (
                  <p className="text-xs text-amber-700">请填写大于 0 的结算比例。</p>
                ) : null}
                {settlementRatio > 0 && commissionRatio >= settlementRatio ? (
                  <p className="text-xs text-amber-700">
                    提成比例不能大于等于结算比例。
                  </p>
                ) : null}
              </section>

              <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <h3 className="text-sm font-medium">倒推盈亏线</h3>
                {breakEven?.error ? (
                  <p className="text-sm text-amber-700">{breakEven.error}</p>
                ) : breakEven ? (
                  breakEven.alreadyAboveLine ? (
                    <p className="text-sm text-emerald-700">
                      按当前实收已达到或超过盈亏线，无需再补业绩。
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm">还需要再完成实收（业绩）</p>
                      <p className="text-2xl font-bold text-emerald-800">
                        {formatCurrency(breakEven.remainingSales)}
                      </p>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>
                          净贡献比例 {(breakEven.netMarginRatio * 100).toFixed(2)}%
                          （结算 {(settlementRatio * 100).toFixed(2)}% − 提成{' '}
                          {(commissionRatio * 100).toFixed(2)}%）
                        </p>
                        <p>
                          盈亏线所需实收合计 {formatCurrency(breakEven.requiredSales)}
                          （当前已有 {formatCurrency(snapshot.salesAmount)}）
                        </p>
                        <p>
                          届时结算约 {formatCurrency(breakEven.requiredSettlement)}
                          ，提成约 {formatCurrency(breakEven.requiredCommission)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPredictedSalesInput(String(breakEven.requiredSales))
                        }
                      >
                        填入盈亏线所需实收到下方试算
                      </Button>
                    </div>
                  )
                ) : (
                  <p className="text-xs text-amber-700">填写结算比例后自动倒推。</p>
                )}
              </section>

              <section className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                <h3 className="text-sm font-medium">试算：若做到某实收</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="predicted-sales">预测实收合计（元）</Label>
                  <Input
                    id="predicted-sales"
                    inputMode="decimal"
                    value={predictedSalesInput}
                    onChange={(e) => setPredictedSalesInput(e.target.value)}
                    placeholder="可手动填写或点上方填入"
                  />
                </div>
                {forecast ? (
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">预估结算收入</p>
                      <p className="font-semibold">
                        {formatCurrency(forecast.predictedSettlement)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">预估销售提成</p>
                      <p className="font-semibold">
                        {formatCurrency(forecast.predictedCommission)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">预估净利润</p>
                      <p
                        className={`font-semibold ${
                          forecast.predictedProfit >= 0
                            ? 'text-emerald-600'
                            : 'text-red-600'
                        }`}
                      >
                        {formatCurrency(forecast.predictedProfit)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">填写实收后显示预估利润。</p>
                )}
              </section>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              点击「一键带入成本与收入」按所选月份与单位载入业绩数据。
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
