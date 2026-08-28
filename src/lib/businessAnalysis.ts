import { getTotalSalaryCost, filterByMonth, type TeamMgmtSalaryContext } from '@/lib/salary'
import { calcSaleSettlementIncome } from '@/lib/settlement'
import { formatCurrency, formatPercent, getYearMonth } from '@/lib/format'
import type {
  CostRecord,
  IncomeRecord,
  PerformanceTarget,
  Personnel,
  Product,
  SalesRecord,
  SalesUnit,
  UnitProductSettlement,
} from '@/types'

export type InsightLevel = 'success' | 'warning' | 'danger' | 'info'

export interface BusinessInsight {
  level: InsightLevel
  title: string
  content: string
}

export interface MonthBusinessMetrics {
  yearMonth: string
  salesAmount: number
  settlementIncome: number
  otherIncome: number
  totalRevenue: number
  manualCost: number
  salaryCost: number
  totalCost: number
  netProfit: number
  profitMargin: number
  costRate: number
  orderCount: number
  avgOrderAmount: number
  headcount: number
  revenuePerCapita: number
}

export interface UnitBusinessMetrics extends MonthBusinessMetrics {
  unitId: string
  unitName: string
  targetAmount: number
  completionRate: number
}

export interface ProductShareItem {
  name: string
  amount: number
  share: number
  quantity?: number
  quantityShare?: number
}

export interface ProductAnalysisItem {
  productId: string
  name: string
  category: string
  quantity: number
  orderCount: number
  salesAmount: number
  settlementIncome: number
  avgUnitPrice: number
  amountShare: number
  quantityShare: number
  quantityMoM: number | null
  amountMoM: number | null
}

export interface DimensionShareItem {
  name: string
  quantity: number
  amount: number
  quantityShare: number
  amountShare: number
}

export interface PersonnelSalesItem {
  personnelId: string
  name: string
  unitName: string
  quantity: number
  salesAmount: number
  orderCount: number
  amountShare: number
}

export interface ProductTrendPoint {
  month: string
  quantity: number
  amount: number
}

export interface ProductTrendSeries {
  productName: string
  points: ProductTrendPoint[]
}

export interface BusinessAnalysisResult {
  current: MonthBusinessMetrics
  previous: MonthBusinessMetrics | null
  units: UnitBusinessMetrics[]
  productShares: ProductShareItem[]
  productAnalysisList: ProductAnalysisItem[]
  categoryShares: DimensionShareItem[]
  moduleShares: DimensionShareItem[]
  activityShares: DimensionShareItem[]
  orderTypeShares: ProductShareItem[]
  personnelSalesList: PersonnelSalesItem[]
  productTrendSeries: ProductTrendSeries[]
  totalQuantity: number
  insights: BusinessInsight[]
  suggestions: string[]
}

export interface BusinessAnalysisInput {
  yearMonth: string
  unitIds: string[]
  salesUnits: SalesUnit[]
  personnel: Personnel[]
  salesRecords: SalesRecord[]
  costRecords: CostRecord[]
  incomeRecords: IncomeRecord[]
  products: Product[]
  performanceTargets: PerformanceTarget[]
  unitProductSettlements: UnitProductSettlement[]
  monthlyAdjustments: Parameters<typeof getTotalSalaryCost>[5]
  productPersonCommissions: Parameters<typeof getTotalSalaryCost>[6]
  teamMgmtContext: TeamMgmtSalaryContext
}

function getPrevYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function calcSettlementIncome(
  sales: SalesRecord[],
  upsList: UnitProductSettlement[],
): number {
  return sales.reduce(
    (sum, s) => sum + calcSaleSettlementIncome(s, upsList),
    0,
  )
}

function getOtherIncome(
  incomeRecords: IncomeRecord[],
  unitIds: string[],
  yearMonth: string,
): number {
  return incomeRecords
    .filter(
      (r) =>
        unitIds.includes(r.salesUnitId) && getYearMonth(r.date) === yearMonth,
    )
    .reduce((sum, r) => sum + r.totalAmount, 0)
}

function computeMonthMetrics(
  input: BusinessAnalysisInput,
  yearMonth: string,
  unitIds: string[],
): MonthBusinessMetrics {
  const {
    salesRecords,
    costRecords,
    incomeRecords,
    personnel,
    products,
    unitProductSettlements,
    monthlyAdjustments,
    productPersonCommissions,
    teamMgmtContext,
  } = input

  const monthSales = filterByMonth(salesRecords, yearMonth).filter((s) =>
    unitIds.includes(s.salesUnitId),
  )
  const monthCosts = costRecords.filter(
    (c) =>
      unitIds.includes(c.salesUnitId) && getYearMonth(c.date) === yearMonth,
  )

  const salesAmount = monthSales.reduce((sum, s) => sum + s.totalAmount, 0)
  const settlementIncome = calcSettlementIncome(
    monthSales,
    unitProductSettlements,
  )
  const otherIncome = getOtherIncome(incomeRecords, unitIds, yearMonth)
  const totalRevenue = settlementIncome + otherIncome

  const salaryData = getTotalSalaryCost(
    unitIds,
    personnel,
    salesRecords,
    products,
    yearMonth,
    monthlyAdjustments,
    productPersonCommissions,
    teamMgmtContext,
  )
  const manualCost = monthCosts.reduce((sum, c) => sum + c.totalCost, 0)
  const salaryCost = salaryData.grandTotal
  const totalCost = manualCost + salaryCost
  const netProfit = totalRevenue - totalCost
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
  const costRate = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0

  const headcount = personnel.filter(
    (p) =>
      unitIds.includes(p.salesUnitId) &&
      (p.status !== 'inactive' || monthSales.some((s) => s.personnelId === p.id)),
  ).length

  const orderCount = monthSales.length
  const avgOrderAmount = orderCount > 0 ? salesAmount / orderCount : 0
  const revenuePerCapita = headcount > 0 ? totalRevenue / headcount : 0

  return {
    yearMonth,
    salesAmount,
    settlementIncome,
    otherIncome,
    totalRevenue,
    manualCost,
    salaryCost,
    totalCost,
    netProfit,
    profitMargin,
    costRate,
    orderCount,
    avgOrderAmount,
    headcount,
    revenuePerCapita,
  }
}

function calcMoM(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function resolveProductMeta(
  sale: SalesRecord,
  products: Product[],
): { productId: string; name: string; category: string } {
  const product = products.find((p) => p.id === sale.productId)
  return {
    productId: sale.productId || sale.productName || 'unknown',
    name: product?.name || sale.productName || '未命名产品',
    category: (product?.category || '').trim() || '未分类业务域',
  }
}

function buildProductShares(
  sales: SalesRecord[],
  products: Product[],
): ProductShareItem[] {
  const map = new Map<string, { amount: number; quantity: number }>()
  sales.forEach((s) => {
    const { name } = resolveProductMeta(s, products)
    const existing = map.get(name) || { amount: 0, quantity: 0 }
    existing.amount += s.totalAmount
    existing.quantity += s.quantity || 0
    map.set(name, existing)
  })
  const totalAmount = Array.from(map.values()).reduce((a, b) => a + b.amount, 0)
  const totalQuantity = Array.from(map.values()).reduce((a, b) => a + b.quantity, 0)
  return Array.from(map.entries())
    .map(([name, data]) => ({
      name,
      amount: data.amount,
      share: totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0,
      quantity: data.quantity,
      quantityShare: totalQuantity > 0 ? (data.quantity / totalQuantity) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

function buildProductAnalysisList(
  currentSales: SalesRecord[],
  prevSales: SalesRecord[],
  products: Product[],
  upsList: UnitProductSettlement[],
): ProductAnalysisItem[] {
  type Acc = {
    productId: string
    name: string
    category: string
    quantity: number
    orderCount: number
    salesAmount: number
    settlementIncome: number
  }
  const map = new Map<string, Acc>()

  function accumulate(sales: SalesRecord[], target: Map<string, Acc>) {
    sales.forEach((s) => {
      const meta = resolveProductMeta(s, products)
      const key = meta.productId === 'unknown' ? meta.name : meta.productId
      const existing = target.get(key) || {
        productId: meta.productId,
        name: meta.name,
        category: meta.category,
        quantity: 0,
        orderCount: 0,
        salesAmount: 0,
        settlementIncome: 0,
      }
      existing.quantity += s.quantity || 0
      existing.orderCount += 1
      existing.salesAmount += s.totalAmount
      existing.settlementIncome += calcSaleSettlementIncome(s, upsList)
      target.set(key, existing)
    })
  }

  const prevMap = new Map<string, Acc>()
  accumulate(currentSales, map)
  accumulate(prevSales, prevMap)

  const totalAmount = Array.from(map.values()).reduce((s, i) => s + i.salesAmount, 0)
  const totalQuantity = Array.from(map.values()).reduce((s, i) => s + i.quantity, 0)

  return Array.from(map.values())
    .map((item) => {
      const prevKey =
        item.productId !== 'unknown'
          ? item.productId
          : item.name
      const prev = prevMap.get(prevKey)
      return {
        ...item,
        avgUnitPrice: item.quantity > 0 ? item.salesAmount / item.quantity : 0,
        amountShare: totalAmount > 0 ? (item.salesAmount / totalAmount) * 100 : 0,
        quantityShare: totalQuantity > 0 ? (item.quantity / totalQuantity) * 100 : 0,
        quantityMoM: prev ? calcMoM(item.quantity, prev.quantity) : null,
        amountMoM: prev ? calcMoM(item.salesAmount, prev.salesAmount) : null,
      }
    })
    .sort((a, b) => b.salesAmount - a.salesAmount)
}

function buildDimensionShares(
  sales: SalesRecord[],
  products: Product[],
  getKey: (sale: SalesRecord, products: Product[]) => string,
): DimensionShareItem[] {
  const map = new Map<string, { quantity: number; amount: number }>()
  sales.forEach((s) => {
    const key = getKey(s, products)
    const existing = map.get(key) || { quantity: 0, amount: 0 }
    existing.quantity += s.quantity || 0
    existing.amount += s.totalAmount
    map.set(key, existing)
  })
  const totalQty = Array.from(map.values()).reduce((s, i) => s + i.quantity, 0)
  const totalAmt = Array.from(map.values()).reduce((s, i) => s + i.amount, 0)
  return Array.from(map.entries())
    .map(([name, data]) => ({
      name,
      quantity: data.quantity,
      amount: data.amount,
      quantityShare: totalQty > 0 ? (data.quantity / totalQty) * 100 : 0,
      amountShare: totalAmt > 0 ? (data.amount / totalAmt) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

function buildPersonnelSalesList(
  sales: SalesRecord[],
  personnel: Personnel[],
  salesUnits: SalesUnit[],
): PersonnelSalesItem[] {
  const map = new Map<string, PersonnelSalesItem>()
  const totalAmount = sales.reduce((s, r) => s + r.totalAmount, 0)

  sales.forEach((s) => {
    const person = personnel.find((p) => p.id === s.personnelId)
    const key = s.personnelId || (s.salesPersonName || '').trim() || 'unknown'
    const name = person?.name || s.salesPersonName || '未关联人员'
    const unit = salesUnits.find((u) => u.id === s.salesUnitId)
    const existing = map.get(key) || {
      personnelId: key,
      name,
      unitName: unit?.name || s.salesUnitName || '—',
      quantity: 0,
      salesAmount: 0,
      orderCount: 0,
      amountShare: 0,
    }
    existing.quantity += s.quantity || 0
    existing.salesAmount += s.totalAmount
    existing.orderCount += 1
    map.set(key, existing)
  })

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      amountShare: totalAmount > 0 ? (item.salesAmount / totalAmount) * 100 : 0,
    }))
    .sort((a, b) => b.salesAmount - a.salesAmount)
}

function buildProductTrendSeries(
  salesRecords: SalesRecord[],
  products: Product[],
  unitIds: string[],
  endYearMonth: string,
  topN = 5,
): ProductTrendSeries[] {
  const monthSalesMap = new Map<string, SalesRecord[]>()
  salesRecords
    .filter((s) => unitIds.includes(s.salesUnitId))
    .forEach((s) => {
      const ym = getYearMonth(s.saleDate)
      if (!ym) return
      const list = monthSalesMap.get(ym) || []
      list.push(s)
      monthSalesMap.set(ym, list)
    })

  const months = Array.from(monthSalesMap.keys()).sort()
  const endIdx = months.indexOf(endYearMonth)
  const sliceMonths =
    endIdx >= 0 ? months.slice(Math.max(0, endIdx - 5), endIdx + 1) : months.slice(-6)

  const currentMonthSales = monthSalesMap.get(endYearMonth) || []
  const topProducts = buildProductShares(currentMonthSales, products).slice(0, topN)
  const topNames = new Set(topProducts.map((p) => p.name))

  return topNames.size === 0
    ? []
    : Array.from(topNames).map((productName) => ({
        productName,
        points: sliceMonths.map((month) => {
          const monthSales = monthSalesMap.get(month) || []
          let quantity = 0
          let amount = 0
          monthSales.forEach((s) => {
            const meta = resolveProductMeta(s, products)
            if (meta.name !== productName) return
            quantity += s.quantity || 0
            amount += s.totalAmount
          })
          return {
            month: month.split('-')[1] + '月',
            quantity,
            amount,
          }
        }),
      }))
}

function buildOrderTypeShares(sales: SalesRecord[]): ProductShareItem[] {
  const map = new Map<string, number>()
  sales.forEach((s) => {
    const key = (s.orderType || '未分类').trim() || '未分类'
    map.set(key, (map.get(key) || 0) + s.totalAmount)
  })
  const total = Array.from(map.values()).reduce((a, b) => a + b, 0)
  return Array.from(map.entries())
    .map(([name, amount]) => ({
      name,
      amount,
      share: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

function buildInsights(
  current: MonthBusinessMetrics,
  previous: MonthBusinessMetrics | null,
  units: UnitBusinessMetrics[],
  productShares: ProductShareItem[],
): BusinessInsight[] {
  const insights: BusinessInsight[] = []

  if (current.orderCount === 0 && current.totalRevenue === 0) {
    insights.push({
      level: 'info',
      title: '暂无经营数据',
      content: `${current.yearMonth} 所选范围内没有销售或收入记录，请调整月份或单位筛选，或先补录销售数据。`,
    })
    return insights
  }

  const revenueMoM = previous
    ? calcMoM(current.totalRevenue, previous.totalRevenue)
    : null
  const profitMoM = previous
    ? calcMoM(current.netProfit, previous.netProfit)
    : null

  if (revenueMoM !== null) {
    const dir = revenueMoM >= 0 ? '增长' : '下降'
    insights.push({
      level: revenueMoM >= 0 ? 'success' : revenueMoM <= -15 ? 'danger' : 'warning',
      title: `经营收入较上月${dir}`,
      content: `本月总收入（结算+其他）${formatCurrency(current.totalRevenue)}，较上月${dir} ${formatPercent(Math.abs(revenueMoM))}。实收 ${formatCurrency(current.salesAmount)}，结算口径 ${formatCurrency(current.settlementIncome)}。`,
    })
  } else {
    insights.push({
      level: 'info',
      title: '本月经营收入',
      content: `总收入 ${formatCurrency(current.totalRevenue)}（实收 ${formatCurrency(current.salesAmount)}），共 ${current.orderCount} 笔订单，客单价 ${formatCurrency(current.avgOrderAmount)}。`,
    })
  }

  if (current.netProfit < 0) {
    insights.push({
      level: 'danger',
      title: '本月处于亏损状态',
      content: `净利润 ${formatCurrency(current.netProfit)}，成本占收入 ${formatPercent(current.costRate)}。建议优先核查人力成本与提成配置，以及是否存在一次性大额支出。`,
    })
  } else if (profitMoM !== null && profitMoM <= -20) {
    insights.push({
      level: 'warning',
      title: '利润明显下滑',
      content: `净利润 ${formatCurrency(current.netProfit)}（利润率 ${formatPercent(current.profitMargin)}），较上月下降 ${formatPercent(Math.abs(profitMoM))}，需关注成本是否刚性上涨或收入结构变化。`,
    })
  } else {
    insights.push({
      level: current.profitMargin >= 20 ? 'success' : 'info',
      title: '盈利能力',
      content: `净利润 ${formatCurrency(current.netProfit)}，利润率 ${formatPercent(current.profitMargin)}。人力及相关成本 ${formatCurrency(current.salaryCost)}，占收入 ${current.totalRevenue > 0 ? formatPercent((current.salaryCost / current.totalRevenue) * 100) : '0.0%'}。`,
    })
  }

  const lossUnits = units.filter((u) => u.netProfit < 0)
  if (lossUnits.length > 0) {
    insights.push({
      level: 'danger',
      title: `${lossUnits.length} 个单位本月亏损`,
      content: `${lossUnits.map((u) => `${u.unitName}（${formatCurrency(u.netProfit)}）`).join('、')}。建议分别查看成本管理与收支利润中的单位明细。`,
    })
  }

  const behindTargets = units.filter(
    (u) => u.targetAmount > 0 && u.completionRate < 80,
  )
  if (behindTargets.length > 0) {
    insights.push({
      level: 'warning',
      title: '部分单位目标完成偏低',
      content: `${behindTargets.map((u) => `${u.unitName} 完成率 ${formatPercent(u.completionRate)}`).join('；')}。可结合单位战报查看个人贡献与缺口。`,
    })
  }

  if (productShares.length > 0) {
    const topByAmount = productShares[0]
    const topByQty = [...productShares].sort(
      (a, b) => (b.quantity || 0) - (a.quantity || 0),
    )[0]
    if (topByAmount.share >= 50) {
      insights.push({
        level: 'warning',
        title: '收入过于集中',
        content: `「${topByAmount.name}」占实收 ${formatPercent(topByAmount.share)}，经营对单一产品依赖较高，需关注产品结构分散。`,
      })
    }
    if (
      topByQty &&
      topByQty.name !== topByAmount.name &&
      (topByQty.quantityShare || 0) >= 40
    ) {
      insights.push({
        level: 'info',
        title: '销量与销售额冠军不一致',
        content: `销量最高为「${topByQty.name}」（${topByQty.quantity || 0} 件），销售额最高为「${topByAmount.name}」。可结合单价与结算规则评估主推方向。`,
      })
    }
  }

  if (current.revenuePerCapita > 0 && current.headcount > 0) {
    insights.push({
      level: 'info',
      title: '人效概况',
      content: `在岗约 ${current.headcount} 人，人均创收 ${formatCurrency(current.revenuePerCapita)}（按结算+其他收入口径）。`,
    })
  }

  return insights
}

function buildSuggestions(
  current: MonthBusinessMetrics,
  previous: MonthBusinessMetrics | null,
  units: UnitBusinessMetrics[],
  productShares: ProductShareItem[],
): string[] {
  const list: string[] = []

  if (current.salaryCost > current.settlementIncome * 0.6 && current.settlementIncome > 0) {
    list.push('人力及提成成本超过结算收入六成，建议复核底薪、提成规则与业绩匹配度，必要时调整编制或激励方案。')
  }

  if (previous && current.totalRevenue < previous.totalRevenue * 0.85) {
    list.push('收入较上月明显回落，建议按单位、产品、订单类型拆解下滑来源，并跟进重点客户续费与新签。')
  }

  const lowMarginUnits = units.filter(
    (u) => u.settlementIncome > 0 && u.profitMargin < 10,
  )
  if (lowMarginUnits.length > 0) {
    list.push(
      `低利润单位（${lowMarginUnits.map((u) => u.unitName).join('、')}）可重点优化：控制非必要费用、提升高毛利产品占比、或调整结算与提成策略。`,
    )
  }

  if (productShares.length >= 3) {
    const tail = productShares.slice(3)
    const tailShare = tail.reduce((s, p) => s + p.share, 0)
    if (tailShare < 15 && productShares[0].share > 40) {
      list.push('长尾产品贡献不足，可评估是否加大推广、打包销售，或清理低效 SKU 以降低运营复杂度。')
    }
  }

  if (current.otherIncome === 0 && current.settlementIncome > 0) {
    list.push('若存在结算外收入（补贴、合作分成等），建议在成本管理中录入其他收入，使经营分析更贴近实际。')
  }

  if (list.length === 0) {
    list.push('当前指标整体平稳，建议每月固定查看经营分析与收支利润，持续跟踪单位目标完成与成本结构变化。')
  }

  return list
}

export function analyzeBusiness(input: BusinessAnalysisInput): BusinessAnalysisResult {
  const prevMonth = getPrevYearMonth(input.yearMonth)
  const current = computeMonthMetrics(input, input.yearMonth, input.unitIds)
  const previous =
    input.unitIds.length > 0
      ? computeMonthMetrics(input, prevMonth, input.unitIds)
      : null

  const monthSales = filterByMonth(input.salesRecords, input.yearMonth).filter(
    (s) => input.unitIds.includes(s.salesUnitId),
  )
  const prevMonthSales = filterByMonth(input.salesRecords, prevMonth).filter(
    (s) => input.unitIds.includes(s.salesUnitId),
  )

  const productShares = buildProductShares(monthSales, input.products)
  const productAnalysisList = buildProductAnalysisList(
    monthSales,
    prevMonthSales,
    input.products,
    input.unitProductSettlements,
  )
  const categoryShares = buildDimensionShares(
    monthSales,
    input.products,
    (_s, ps) => resolveProductMeta(_s, ps).category,
  )
  const moduleShares = buildDimensionShares(monthSales, input.products, (s) => {
    const mod = (s.productModule || '').trim()
    return mod || '未标注模块'
  })
  const activityShares = buildDimensionShares(monthSales, input.products, (s) => {
    const act = (s.activityName || '').trim()
    return act || '无活动'
  })
  const orderTypeShares = buildOrderTypeShares(monthSales)
  const personnelSalesList = buildPersonnelSalesList(
    monthSales,
    input.personnel,
    input.salesUnits,
  )
  const productTrendSeries = buildProductTrendSeries(
    input.salesRecords,
    input.products,
    input.unitIds,
    input.yearMonth,
  )
  const totalQuantity = monthSales.reduce((s, r) => s + (r.quantity || 0), 0)

  const units: UnitBusinessMetrics[] = input.salesUnits
    .filter((u) => input.unitIds.includes(u.id))
    .map((unit) => {
      const metrics = computeMonthMetrics(input, input.yearMonth, [unit.id])
      const target = input.performanceTargets.find(
        (t) =>
          t.salesUnitId === unit.id &&
          t.yearMonth === input.yearMonth &&
          !t.personnelId,
      )
      const targetAmount = target?.targetAmount || 0
      const completionRate =
        targetAmount > 0 ? (metrics.salesAmount / targetAmount) * 100 : 0
      return {
        ...metrics,
        unitId: unit.id,
        unitName: unit.name,
        targetAmount,
        completionRate,
      }
    })
    .sort((a, b) => b.netProfit - a.netProfit)

  const insights = buildInsights(current, previous, units, productShares)
  const suggestions = buildSuggestions(current, previous, units, productShares)

  return {
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
  }
}

export function formatMoM(value: number | null): string {
  if (value === null) return '—'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}
