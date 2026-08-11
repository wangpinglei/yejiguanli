import { useEffect, useMemo, useState } from 'react'
import { Calculator, Download } from 'lucide-react'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedMonth: string
  filterUnitLabel: string
  summary: {
    salesAmount: number
    settlementIncome: number
    otherIncome: number
    totalCost: number
    manualCost?: number
    salaryCost?: number
    /** 当月销售提成（用于拆出固定成本、预填提成比例） */
    totalCommission?: number
  }
}

export default function MPerformanceEstimateSheet({
  open,
  onOpenChange,
  selectedMonth,
  filterUnitLabel,
  summary,
}: Props) {
  const [snapshot, setSnapshot] = useState<EstimateSnapshot | null>(null)
  const [ratioPercentInput, setRatioPercentInput] = useState('')
  const [commissionPercentInput, setCommissionPercentInput] = useState('')
  const [otherIncomeInput, setOtherIncomeInput] = useState('')
  const [totalCostInput, setTotalCostInput] = useState('')
  const [predictedSalesInput, setPredictedSalesInput] = useState('')
  const [importedAt, setImportedAt] = useState('')
  const [costHint, setCostHint] = useState('')

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

  function handleImportCostAndIncome() {
    const commission = summary.totalCommission ?? 0
    // 固定成本 = 总成本 − 已计入的销售提成，避免倒推时再扣一遍提成
    const fixedCost = Math.max(0, summary.totalCost - commission)
    const suggestedCommissionRatio = getCommissionToSalesRatio(
      commission,
      summary.salesAmount,
    )
    const next = buildEstimateSnapshot({
      salesAmount: summary.salesAmount,
      settlementIncome: summary.settlementIncome,
      otherIncome: summary.otherIncome,
      totalCost: fixedCost,
      suggestedCommissionRatio,
    })
    setSnapshot(next)
    setOtherIncomeInput(String(summary.otherIncome || 0))
    setTotalCostInput(String(fixedCost || 0))
    setPredictedSalesInput(String(summary.salesAmount || 0))
    if (next.suggestedRatio > 0) {
      setRatioPercentInput(formatRatioAsPercentInput(next.suggestedRatio))
    }
    setCommissionPercentInput(
      suggestedCommissionRatio > 0
        ? formatRatioAsPercentInput(suggestedCommissionRatio)
        : '0',
    )

    const manual = summary.manualCost ?? 0
    const salary = summary.salaryCost ?? 0
    const salaryWithoutCommission = Math.max(0, salary - commission)
    setCostHint(
      `固定成本已扣当月提成 ${formatCurrency(commission)}`
        + `（录入 ${formatCurrency(manual)}`
        + ` + 人力非提成 ${formatCurrency(salaryWithoutCommission)}）`,
    )
    setImportedAt(new Date().toLocaleString('zh-CN', { hour12: false }))
  }

  useEffect(() => {
    if (!open) return
    handleImportCostAndIncome()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 open 触发
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
            带入固定成本与其他收入，填写结算比例与提成比例，倒推到盈亏线还需多少实收。
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">
              {selectedMonth} · {filterUnitLabel}
              {importedAt ? (
                <span className="ml-2 text-xs">已带入 {importedAt}</span>
              ) : null}
            </div>
            <Button type="button" size="sm" onClick={handleImportCostAndIncome}>
              <Download className="mr-1.5 h-4 w-4" />
              一键带入成本与收入
            </Button>
          </div>

          {workingSnapshot && snapshot ? (
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
                    <p className="text-xs text-muted-foreground">当前实收</p>
                    <p className="font-medium">
                      {formatCurrency(snapshot.salesAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">当前结算收入</p>
                    <p className="font-medium">
                      {formatCurrency(snapshot.settlementIncome)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">当前净利润（系统）</p>
                    <p
                      className={`font-medium ${
                        snapshot.salesAmount > 0
                        && snapshot.settlementIncome + snapshot.otherIncome
                          - (summary.totalCost) > 0
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
                      结算用本月参考
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
                      提成用本月参考
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
              点击「一键带入成本与收入」从盈亏分析载入当月数据。
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
