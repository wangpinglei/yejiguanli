import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Package, Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  formatMoM,
  type DimensionShareItem,
  type PersonnelSalesItem,
  type ProductAnalysisItem,
  type ProductShareItem,
  type ProductTrendSeries,
} from '@/lib/businessAnalysis'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

const COLORS = ['#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ef4444']

interface Props {
  productAnalysisList: ProductAnalysisItem[]
  productShares: ProductShareItem[]
  categoryShares: DimensionShareItem[]
  moduleShares: DimensionShareItem[]
  activityShares: DimensionShareItem[]
  orderTypeShares: ProductShareItem[]
  personnelSalesList: PersonnelSalesItem[]
  productTrendSeries: ProductTrendSeries[]
  totalQuantity: number
}

function MoMCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('text-xs font-medium', value >= 0 ? 'text-emerald-600' : 'text-red-600')}>
      {formatMoM(value)}
    </span>
  )
}

function DimensionTable({ items, showQuantity = true }: { items: DimensionShareItem[]; showQuantity?: boolean }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无数据</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          {showQuantity && <TableHead className="text-right">销量</TableHead>}
          <TableHead className="text-right">实收</TableHead>
          {showQuantity && <TableHead className="text-right">销量占比</TableHead>}
          <TableHead className="text-right">金额占比</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.name}>
            <TableCell className="font-medium">{item.name}</TableCell>
            {showQuantity && (
              <TableCell className="text-right">{formatNumber(item.quantity)}</TableCell>
            )}
            <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
            {showQuantity && (
              <TableCell className="text-right">{formatPercent(item.quantityShare)}</TableCell>
            )}
            <TableCell className="text-right">{formatPercent(item.amountShare)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function BusinessAnalysisPanel({
  productAnalysisList,
  productShares,
  categoryShares,
  moduleShares,
  activityShares,
  orderTypeShares,
  personnelSalesList,
  productTrendSeries,
  totalQuantity,
}: Props) {
  const qtyTop10 = [...productShares]
    .sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
    .slice(0, 10)
    .map((p) => ({
      name: p.name.length > 10 ? `${p.name.slice(0, 10)}…` : p.name,
      quantity: p.quantity || 0,
      amount: p.amount,
    }))

  const amountTop10 = productShares.slice(0, 10).map((p) => ({
    name: p.name.length > 10 ? `${p.name.slice(0, 10)}…` : p.name,
    amount: p.amount,
    quantity: p.quantity || 0,
  }))

  const trendChartData = productTrendSeries[0]?.points.map((point, idx) => {
    const row: Record<string, string | number> = { month: point.month }
    productTrendSeries.forEach((series) => {
      row[series.productName] = series.points[idx]?.amount || 0
    })
    return row
  })

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Package className="h-5 w-5 text-primary" />
        产品与销量分析
      </h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>总销量（件/套）</CardDescription>
            <CardTitle className="text-2xl">{formatNumber(totalQuantity)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>在售产品数</CardDescription>
            <CardTitle className="text-2xl">{productAnalysisList.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>业务域数</CardDescription>
            <CardTitle className="text-2xl">{categoryShares.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">产品销量 Top10</CardTitle>
            <CardDescription>按销售数量排序</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {qtyTop10.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无销售数据</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={qtyTop10} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="quantity" name="销量" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">产品销售额 Top10</CardTitle>
            <CardDescription>按实收金额排序</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {amountTop10.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无销售数据</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={amountTop10} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v / 10000}万`}
                  />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="amount" name="实收" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {trendChartData && trendChartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">主力产品销售额趋势</CardTitle>
            <CardDescription>近 6 个月 Top 产品实收走势</CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v / 10000}万`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                {productTrendSeries.map((series, i) => (
                  <Line
                    key={series.productName}
                    type="monotone"
                    dataKey={series.productName}
                    name={series.productName}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">多维产品分析</CardTitle>
          <CardDescription>产品明细、业务域、活动、模块、订单类型与销售人员</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="products">
            <TabsList className="mb-4 flex h-auto flex-wrap gap-1">
              <TabsTrigger value="products">产品明细</TabsTrigger>
              <TabsTrigger value="category">业务域</TabsTrigger>
              <TabsTrigger value="activity">活动</TabsTrigger>
              <TabsTrigger value="module">产品模块</TabsTrigger>
              <TabsTrigger value="orderType">订单类型</TabsTrigger>
              <TabsTrigger value="personnel">销售人员</TabsTrigger>
            </TabsList>

            <TabsContent value="products">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>产品</TableHead>
                    <TableHead>业务域</TableHead>
                    <TableHead className="text-right">销量</TableHead>
                    <TableHead className="text-right">订单数</TableHead>
                    <TableHead className="text-right">实收</TableHead>
                    <TableHead className="text-right">结算收入</TableHead>
                    <TableHead className="text-right">均价</TableHead>
                    <TableHead className="text-right">销量占比</TableHead>
                    <TableHead className="text-right">金额占比</TableHead>
                    <TableHead className="text-right">销量环比</TableHead>
                    <TableHead className="text-right">金额环比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productAnalysisList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground">
                        暂无产品销量数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    productAnalysisList.map((item) => (
                      <TableRow key={`${item.productId}-${item.name}`}>
                        <TableCell className="max-w-[160px] font-medium">
                          <span className="line-clamp-2">{item.name}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(item.quantity)}</TableCell>
                        <TableCell className="text-right">{item.orderCount}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.salesAmount)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.settlementIncome)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.avgUnitPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPercent(item.quantityShare)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPercent(item.amountShare)}
                        </TableCell>
                        <TableCell className="text-right">
                          <MoMCell value={item.quantityMoM} />
                        </TableCell>
                        <TableCell className="text-right">
                          <MoMCell value={item.amountMoM} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="category">
              <DimensionTable items={categoryShares} />
            </TabsContent>

            <TabsContent value="activity">
              <DimensionTable items={activityShares} />
            </TabsContent>

            <TabsContent value="module">
              <DimensionTable items={moduleShares} />
            </TabsContent>

            <TabsContent value="orderType">
              {orderTypeShares.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无订单类型数据</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>订单类型</TableHead>
                      <TableHead className="text-right">实收</TableHead>
                      <TableHead className="text-right">占比</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderTypeShares.map((item) => (
                      <TableRow key={item.name}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
                        <TableCell className="text-right">{formatPercent(item.share)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="personnel">
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                按实收金额排序，可结合单位战报查看目标完成
              </div>
              {personnelSalesList.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无销售人员数据</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>销售人员</TableHead>
                      <TableHead>单位</TableHead>
                      <TableHead className="text-right">销量</TableHead>
                      <TableHead className="text-right">订单数</TableHead>
                      <TableHead className="text-right">实收</TableHead>
                      <TableHead className="text-right">占比</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {personnelSalesList.slice(0, 50).map((item) => (
                      <TableRow key={item.personnelId}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.unitName}</TableCell>
                        <TableCell className="text-right">{formatNumber(item.quantity)}</TableCell>
                        <TableCell className="text-right">{item.orderCount}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.salesAmount)}</TableCell>
                        <TableCell className="text-right">{formatPercent(item.amountShare)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </section>
  )
}
