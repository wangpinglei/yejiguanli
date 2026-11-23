import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '@/context/DataContext'
import { usePermissions } from '@/hooks/usePermissions'
import { PageHeader } from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'
import { buildProductCommissionOverviewRows } from '@/lib/productCommissionOverview'
import {
  ArrowLeft, Building2, Package, Pencil, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export default function ProductCommissionOverview() {
  const {
    products,
    allSalesRecords: salesRecords,
    unitProductSettlements: upsList,
    productPersonCommissions: ppcList,
    personnel,
  } = useData()
  const {
    visibleSalesUnits: units,
    accessibleUnitIds,
    isSuperadmin,
  } = usePermissions()

  const [searchParams, setSearchParams] = useSearchParams()
  const initialProductId = searchParams.get('product') || ''

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const m = searchParams.get('month')
    if (m && /^\d{4}-\d{2}$/.test(m)) return m
    return new Date().toISOString().slice(0, 7)
  })
  const [productId, setProductId] = useState(() => {
    if (initialProductId && products.some((p) => p.id === initialProductId)) {
      return initialProductId
    }
    return ''
  })

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      options.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
      })
    }
    return options
  }, [])

  const productOptions = useMemo(() => {
    const idSet = new Set<string>()
    salesRecords.forEach((s) => {
      if (s.productId) idSet.add(s.productId)
    })
    ppcList.forEach((p) => {
      if (p.productId) idSet.add(p.productId)
    })
    return products
      .filter((p) => idSet.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }, [products, salesRecords, ppcList])

  const allowedUnitIds = useMemo(() => {
    if (isSuperadmin) return undefined
    return new Set(accessibleUnitIds)
  }, [isSuperadmin, accessibleUnitIds])

  const selectedProduct = products.find((p) => p.id === productId)

  const rows = useMemo(
    () =>
      buildProductCommissionOverviewRows({
        productId,
        yearMonth: selectedMonth,
        salesRecords,
        ppcList,
        upsList,
        personnel,
        units,
        allowedUnitIds,
      }),
    [
      productId,
      selectedMonth,
      salesRecords,
      ppcList,
      upsList,
      personnel,
      units,
      allowedUnitIds,
    ],
  )

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        sales: acc.sales + r.monthProductSales,
        commission: acc.commission + r.commissionEstimate,
      }),
      { sales: 0, commission: 0 },
    )
  }, [rows])

  function onProductChange(id: string) {
    setProductId(id)
    const next = new URLSearchParams(searchParams)
    if (id) next.set('product', id)
    else next.delete('product')
    next.set('month', selectedMonth)
    setSearchParams(next, { replace: true })
  }

  function onMonthChange(month: string) {
    setSelectedMonth(month)
    const next = new URLSearchParams(searchParams)
    next.set('month', month)
    if (productId) next.set('product', productId)
    setSearchParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="产品提成总览"
        description="选定产品后，查看各单位销售人员的提成规则、当月分摊销售额与预估个人提成（含协作分摊；梯度按单笔估档，正式工资核算仍按月汇总定档）。"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedMonth} onValueChange={onMonthChange}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" asChild>
              <Link to="/product-settlement">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                返回产品结算
              </Link>
            </Button>
          </div>
        )}
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">选择产品</p>
            <Select value={productId || '__none__'} onValueChange={(v) => onProductChange(v === '__none__' ? '' : v)}>
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder="请选择产品" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">请选择产品</SelectItem>
                {productOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.category ? ` · ${p.category}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProduct && (
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">{selectedMonth} 分摊销售额合计</p>
                <p className="text-lg font-semibold text-blue-600">{formatCurrency(totals.sales)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{selectedMonth} 预估提成合计</p>
                <p className="text-lg font-semibold text-orange-600">{formatCurrency(totals.commission)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">涉及人员</p>
                <p className="text-lg font-semibold">{rows.length} 人</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!productId && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            请先在上方选择产品。列表包含已配置「单位×产品×人员」提成的人员，以及当月在该产品有分摊销售额的人员。
          </CardContent>
        </Card>
      )}

      {productId && rows.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {selectedProduct?.name} 在 {selectedMonth} 暂无提成配置或分摊销售记录。
          </CardContent>
        </Card>
      )}

      {productId && rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
                <Package className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="font-medium">{selectedProduct?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedProduct?.category || '未分类'} · {selectedMonth}
                </p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>销售单位</TableHead>
                  <TableHead>销售人员</TableHead>
                  <TableHead>提成规则</TableHead>
                  <TableHead className="text-right">当月分摊销售额</TableHead>
                  <TableHead className="text-right">预估个人提成</TableHead>
                  <TableHead className="text-right w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.unitId}-${row.personnelId}`}>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {row.unitName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                          <Users className="h-3 w-3 text-primary" />
                        </div>
                        <span className="text-sm">{row.personName}</span>
                        {row.position && (
                          <span className="text-xs text-muted-foreground">({row.position})</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.ppc ? (
                        <Badge variant="secondary" className="max-w-[280px] whitespace-normal text-left font-normal">
                          {row.ruleSummary}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{row.ruleSummary}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium text-blue-600">
                      {row.monthProductSales > 0 ? formatCurrency(row.monthProductSales) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium text-orange-600">
                      {row.commissionEstimate > 0 ? formatCurrency(row.commissionEstimate) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to={`/personnel?commission=${encodeURIComponent(row.personnelId)}&product=${encodeURIComponent(productId)}`}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          编辑
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}