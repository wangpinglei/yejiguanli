import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Lightbulb,
  Target,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  analyzeBusiness,
  formatMoM,
  type BusinessInsight,
  type InsightLevel,
} from '@/lib/businessAnalysis'
import { formatCurrency, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import BusinessAnalysisPanel from '@/pages/BusinessAnalysisPanel'

const COLORS = ['#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4']
const LEVEL_STYLE: Record<InsightLevel, string> = {
  success: 'border-emerald-200 bg-emerald-50/80',
  warning: 'border-amber-200 bg-amber-50/80',
  danger: 'border-red-200 bg-red-50/80',
  info: 'border-slate-200 bg-slate-50/80',
}

function InsightCard({ insight }: { insight: BusinessInsight }) {
  return (
    <div className={cn('rounded-lg border p-4', LEVEL_STYLE[insight.level])}>
      <div className="mb-1 text-sm font-semibold">{insight.title}</div>
      <p className="text-sm leading-relaxed text-muted-foreground">{insight.content}</p>
    </div>
  )
}

function MoMBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-muted-foreground">无上月对比</span>
  }
  const up = value >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        up ? 'text-emerald-600' : 'text-red-600',
      )}
    >
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {formatMoM(value)}
    </span>
  )
}

export default function BusinessAnalysis() {
  const {
    products,
    monthlyAdjustments,
    productPersonCommissions,
    teamMgmtCommissionRules,
    performanceTargets,
    unitProductSettlements,
    incomeRecords,
  } = useData()
  const {
    visibleSalesUnits: salesUnits,
    visiblePersonnel: personnel,
    visibleSalesRecords: salesRecords,
    visibleCostRecords: costRecords,
  } = usePermissions()

  const [selectedMonth, setSelectedMonth] = useState(
    new Date().toISOString().slice(0, 7),
  )
  const [filterUnit, setFilterUnit] = useState('all')

  const teamMgmtContext = useMemo(
    () => ({
      rules: teamMgmtCommissionRules,
      targets: performanceTargets,
      upsList: unitProductSettlements,
    }),
    [teamMgmtCommissionRules, performanceTargets, unitProductSettlements],
  )

  const filterUnitIds = useMemo(() => {
    if (filterUnit === 'all') return salesUnits.map((u) => u.id)
    return [filterUnit]
  }, [filterUnit, salesUnits])

  const monthOptions = useMemo(() => {
    const set = new Set<string>()
    salesRecords.forEach((s) => {
      if (s.saleDate?.slice(0, 7)) set.add(s.saleDate.slice(0, 7))
    })
    costRecords.forEach((c) => {
      const ym = c.date?.slice(0, 7)
      if (ym) set.add(ym)
    })
    set.add(new Date().toISOString().slice(0, 7))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [salesRecords, costRecords])

  const analysis = useMemo(() => {
    return analyzeBusiness({
      yearMonth: selectedMonth,
      unitIds: filterUnitIds,
      salesUnits,
      personnel,
      salesRecords,
      costRecords,
      incomeRecords,
      products,
      performanceTargets,
      unitProductSettlements,
      monthlyAdjustments,
      productPersonCommissions,
      teamMgmtContext,
    })
  }, [
    selectedMonth,
    filterUnitIds,
    salesUnits,
    personnel,
    salesRecords,
    costRecords,
    incomeRecords,
    products,
    performanceTargets,
    unitProductSettlements,
    monthlyAdjustments,
    productPersonCommissions,
    teamMgmtContext,
  ])

  const {
    current,
    previous,
    units,
    productShares,
    productAnalysisList,
    categoryShares,
    moduleShares,
    activityShares,
    orderTypeShares,
    personnelSalesList,
    productTrendSeries,
    totalQuantity,
    insights,
    suggestions,
  } = analysis

  const revenueMoM = previous
    ? ((current.totalRevenue - previous.totalRevenue) / (previous.totalRevenue || 1)) * 100
    : null
  const profitMoM = previous
    ? ((current.netProfit - previous.netProfit) / (Math.abs(previous.netProfit) || 1)) * 100
    : null

  const unitChartData = units.map((u) => ({
    name: u.unitName.length > 8 ? `${u.unitName.slice(0, 8)}…` : u.unitName,
    profit: u.netProfit,
    revenue: u.totalRevenue,
  }))

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="经营分析"
        description="综合经营诊断、单位盈利、产品销量/销售额、业务域与销售人员等多维分析，辅助经营决策。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="选择月份" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterUnit} onValueChange={setFilterUnit}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="单位" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部单位</SelectItem>
                {salesUnits.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" asChild>
              <Link to="/profit-analysis">收支利润明细</Link>
            </Button>
          </div>
        }
      />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          经营诊断
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {insights.map((item, idx) => (
            <InsightCard key={`${item.title}-${idx}`} insight={item} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>总收入（结算+其他）</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(current.totalRevenue)}</CardTitle>
          </CardHeader>
          <CardContent>
            <MoMBadge value={revenueMoM} />
            <p className="mt-1 text-xs text-muted-foreground">
              实收 {formatCurrency(current.salesAmount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>净利润</CardDescription>
            <CardTitle
              className={cn(
                'text-2xl',
                current.netProfit < 0 ? 'text-red-600' : 'text-emerald-600',
              )}
            >
              {formatCurrency(current.netProfit)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoMBadge value={profitMoM} />
            <p className="mt-1 text-xs text-muted-foreground">
              利润率 {formatPercent(current.profitMargin)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>总成本</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(current.totalCost)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              占收入 {formatPercent(current.costRate)} · 人力 {formatCurrency(current.salaryCost)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>订单 / 销量</CardDescription>
            <CardTitle className="text-2xl">
              {current.orderCount} 笔 · {totalQuantity} 件
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              客单价 {formatCurrency(current.avgOrderAmount)} · 人均{' '}
              {formatCurrency(current.revenuePerCapita)}
            </p>
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">各单位盈利对比</CardTitle>
            <CardDescription>按净利润排序</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {unitChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无单位数据</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={unitChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v / 10000}万`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="profit" name="净利润" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">实收产品结构</CardTitle>
            <CardDescription>帮助判断收入是否过于集中</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {productShares.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无销售数据</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={productShares.slice(0, 6)}
                    dataKey="amount"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, share }) =>
                      `${name.length > 6 ? `${name.slice(0, 6)}…` : name} ${share.toFixed(0)}%`
                    }
                  >
                    {productShares.slice(0, 6).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" />
            单位经营明细
          </CardTitle>
          <CardDescription>收入、成本、利润与目标完成率（目标基于实收）</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>单位</TableHead>
                <TableHead className="text-right">实收</TableHead>
                <TableHead className="text-right">总收入</TableHead>
                <TableHead className="text-right">总成本</TableHead>
                <TableHead className="text-right">净利润</TableHead>
                <TableHead className="text-right">利润率</TableHead>
                <TableHead className="text-right">目标完成</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((u) => (
                <TableRow key={u.unitId}>
                  <TableCell className="font-medium">{u.unitName}</TableCell>
                  <TableCell className="text-right">{formatCurrency(u.salesAmount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(u.totalRevenue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(u.totalCost)}</TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium',
                      u.netProfit < 0 ? 'text-red-600' : 'text-emerald-600',
                    )}
                  >
                    {formatCurrency(u.netProfit)}
                  </TableCell>
                  <TableCell className="text-right">{formatPercent(u.profitMargin)}</TableCell>
                  <TableCell className="text-right">
                    {u.targetAmount > 0 ? (
                      <Badge variant={u.completionRate >= 100 ? 'default' : 'secondary'}>
                        {formatPercent(u.completionRate)}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BusinessAnalysisPanel
        productAnalysisList={productAnalysisList}
        productShares={productShares}
        categoryShares={categoryShares}
        moduleShares={moduleShares}
        activityShares={activityShares}
        orderTypeShares={orderTypeShares}
        personnelSalesList={personnelSalesList}
        productTrendSeries={productTrendSeries}
        totalQuantity={totalQuantity}
      />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Lightbulb className="h-5 w-5 text-primary" />
          经营建议
        </h2>
        <Card>
          <CardContent className="space-y-3 pt-6">
            {suggestions.map((text, idx) => (
              <div key={idx} className="flex gap-3 text-sm leading-relaxed">
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{text}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
