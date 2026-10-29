import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'

import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  buildPayrollCommissionDetail,
  buildSalesRecordsCheckHref,
} from '@/lib/payrollCommissionDetail'

/**
 * 工资核算 → 个人业绩提成明细（对齐销售记录逐单核对）
 */
export default function PayrollCommissionDetail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const {
    products,
    productPersonCommissions,
    teamMgmtCommissionRules,
    performanceTargets,
    unitProductSettlements,
  } = useData()
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords } =
    usePermissions()

  const personnelId = params.get('personnelId') || ''
  const unitId = params.get('unitId') || ''
  const yearMonth = params.get('yearMonth') || ''

  const detail = useMemo(() => {
    if (!personnelId || !unitId || !yearMonth) return null
    return buildPayrollCommissionDetail({
      personnelId,
      unitId,
      yearMonth,
      personnel,
      salesUnits,
      salesRecords,
      products,
      productPersonCommissions,
      teamMgmtRules: teamMgmtCommissionRules,
      performanceTargets,
      unitProductSettlements,
    })
  }, [
    personnelId,
    unitId,
    yearMonth,
    personnel,
    salesUnits,
    salesRecords,
    products,
    productPersonCommissions,
    teamMgmtCommissionRules,
    performanceTargets,
    unitProductSettlements,
  ])

  const salesHref = personnelId && unitId && yearMonth
    ? buildSalesRecordsCheckHref({ personnelId, unitId, yearMonth })
    : '/sales-records'

  const backHref = '/payroll'

  if (!personnelId || !unitId || !yearMonth) {
    return (
      <div className="space-y-4">
        <PageHeader title="业绩提成明细" description="缺少人员、单位或月份参数" />
        <Button variant="outline" onClick={() => navigate(backHref)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          返回工资核算
        </Button>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <PageHeader title="业绩提成明细" description="未找到对应人员" />
        <Button variant="outline" onClick={() => navigate(backHref)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          返回工资核算
        </Button>
      </div>
    )
  }

  const lineSum = detail.lines.reduce((s, l) => s + l.amount, 0)
  const orderSum = detail.lines.reduce((s, l) => s + l.orderAmount, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`业绩提成明细 · ${detail.personnelName}`}
        description={`${detail.unitName} · ${detail.yearMonth} · 按销售记录逐单核对`}
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to={backHref}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            返回工资核算
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to={salesHref}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            打开销售记录核对
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>本月个人业绩</CardDescription>
            <CardTitle className="text-xl text-blue-700">
              {formatCurrency(detail.personalSales)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>个人提成</CardDescription>
            <CardTitle className="text-xl text-orange-600">
              {formatCurrency(detail.personalTotal)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>内部销售 + 团队管理</CardDescription>
            <CardTitle className="text-xl text-emerald-700">
              {formatCurrency(detail.internalTotal + detail.teamMgmtTotal)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-violet-200 bg-violet-50/40">
          <CardHeader className="pb-2">
            <CardDescription>业绩提成合计（应对齐工资表）</CardDescription>
            <CardTitle className="text-xl text-violet-700">
              {formatCurrency(detail.commissionTotal)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">销售明细核对</CardTitle>
          <CardDescription>
            与销售记录一致：客户姓名、购买产品、订单金额；另附提成比例与提成。
            {Math.abs(lineSum - detail.personalTotal) > 0.05 && (
              <span className="ml-1 text-amber-700">
                （行提成合计与个人提成差额 {formatCurrency(detail.personalTotal - lineSum)}，多为月门槛汇总口径）
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[120px]">客户姓名</TableHead>
                <TableHead className="min-w-[160px]">购买产品</TableHead>
                <TableHead className="text-right min-w-[100px]">订单金额</TableHead>
                <TableHead className="min-w-[120px]">提成比例</TableHead>
                <TableHead className="text-right min-w-[100px]">提成</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    本月该单位暂无相关销售记录
                  </TableCell>
                </TableRow>
              ) : (
                detail.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.customerName}</TableCell>
                    <TableCell className="max-w-[240px] truncate" title={line.productName}>
                      {line.productName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(line.orderAmount)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{line.rateLabel}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-violet-700">
                      {formatCurrency(line.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
              {detail.lines.length > 0 && (
                <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
                  <TableCell colSpan={2}>合计（{detail.lines.length} 单）</TableCell>
                  <TableCell className="text-right tabular-nums text-blue-700">
                    {formatCurrency(orderSum)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums text-violet-700">
                    {formatCurrency(lineSum)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
