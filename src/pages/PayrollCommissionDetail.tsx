import { useMemo, useState } from 'react'
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
import {
  saveCommissionOrderAdj,
  type CommissionOrderAdj,
} from '@/lib/commissionOrderAdj'
import { formatCurrency } from '@/lib/format'
import {
  buildPayrollCommissionDetail,
  buildSalesRecordsCheckHref,
} from '@/lib/payrollCommissionDetail'
import MCommissionOrderAdjCell from '@/pages/Payroll/components/m-commission-order-adj-cell'

/**
 * 工资核算 → 个人业绩提成明细（对齐销售记录逐单核对；可调单笔）
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
  const [adjTick, setAdjTick] = useState(0)

  const detail = useMemo(() => {
    if (!personnelId || !unitId || !yearMonth) return null
    void adjTick
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
    adjTick,
  ])

  const salesHref = personnelId && unitId && yearMonth
    ? buildSalesRecordsCheckHref({ personnelId, unitId, yearMonth })
    : '/sales-records'

  const backHref = '/payroll'

  function handleSaveAdj(saleId: string, next: CommissionOrderAdj | null) {
    saveCommissionOrderAdj(yearMonth, personnelId, unitId, saleId, next)
    setAdjTick((n) => n + 1)
  }

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
        description={`${detail.unitName} · ${detail.yearMonth} · 按销售记录逐单核对，可调整单笔提成`}
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
            <CardDescription>
              个人提成{detail.hasOrderAdj ? '（已按明细调整）' : ''}
            </CardDescription>
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
            与销售记录一致：客户、产品、活动、订单金额；「调整」可改单笔业绩/比例/提成金额，保存后本行提成与工资表个人提成同步。
            {!detail.hasOrderAdj
              && Math.abs(lineSum - detail.systemPersonalTotal) > 0.05 && (
              <span className="ml-1 text-amber-700">
                （行提成合计与系统个人提成差额{' '}
                {formatCurrency(detail.systemPersonalTotal - lineSum)}
                ，多为月门槛汇总口径；一旦有单笔调整则以明细合计为准）
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
                <TableHead className="min-w-[120px]">活动</TableHead>
                <TableHead className="text-right min-w-[100px]">订单金额</TableHead>
                <TableHead className="min-w-[120px]">提成比例</TableHead>
                <TableHead className="min-w-[140px]">调整</TableHead>
                <TableHead className="text-right min-w-[100px]">提成</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
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
                    <TableCell
                      className="max-w-[160px] truncate text-sm text-muted-foreground"
                      title={line.activityName || undefined}
                    >
                      {line.activityName || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(line.orderAmount)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{line.rateLabel}</TableCell>
                    <TableCell>
                      <MCommissionOrderAdjCell
                        adj={line.adj}
                        onSave={(next) => handleSaveAdj(line.saleId, next)}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-violet-700">
                      {formatCurrency(line.amount)}
                      {line.adj && Math.abs(line.amount - line.systemAmount) > 0.005 && (
                        <div className="text-[10px] font-normal text-muted-foreground">
                          原 {formatCurrency(line.systemAmount)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
              {detail.lines.length > 0 && (
                <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
                  <TableCell colSpan={3}>合计（{detail.lines.length} 单）</TableCell>
                  <TableCell className="text-right tabular-nums text-blue-700">
                    {formatCurrency(orderSum)}
                  </TableCell>
                  <TableCell />
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
