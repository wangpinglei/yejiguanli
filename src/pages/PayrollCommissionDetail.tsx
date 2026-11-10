import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CloudUpload, ExternalLink, Save } from 'lucide-react'

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
  commissionOrderAdjApi,
  type CommissionOrderAdjAudit,
} from '@/lib/api'
import {
  loadCommissionOrderAdjMap,
  replaceCommissionOrderAdjMap,
  saveCommissionOrderAdj,
  type CommissionOrderAdj,
} from '@/lib/commissionOrderAdj'
import { formatCurrency, formatDateTime } from '@/lib/format'
import {
  buildPayrollCommissionDetail,
  buildSalesRecordsCheckHref,
} from '@/lib/payrollCommissionDetail'
import MCommissionOrderAdjCell from '@/pages/Payroll/components/m-commission-order-adj-cell'

/**
 * 工资核算 → 个人业绩提成明细（对齐销售记录逐单核对；可调单笔）
 * 改一行先写本机；「保存到线上」同步当前人×单位×月份整份调整。
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
  const {
    visibleSalesUnits: salesUnits,
    visiblePersonnel: personnel,
    visibleSalesRecords: salesRecords,
    canEdit,
  } = usePermissions()
  const canSaveOnline = canEdit('payroll')

  const personnelId = params.get('personnelId') || ''
  const unitId = params.get('unitId') || ''
  const yearMonth = params.get('yearMonth') || ''
  const [adjTick, setAdjTick] = useState(0)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncSaving, setSyncSaving] = useState(false)
  const [canMigrateLocal, setCanMigrateLocal] = useState(false)
  const [audit, setAudit] = useState<CommissionOrderAdjAudit | null>(null)
  const [savedTip, setSavedTip] = useState('')
  const [dirtyLocal, setDirtyLocal] = useState(false)

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

  useEffect(() => {
    if (!personnelId || !unitId || !yearMonth) return
    let cancelled = false
    async function loadScope() {
      setSyncLoading(true)
      setCanMigrateLocal(false)
      setDirtyLocal(false)
      try {
        const payload = await commissionOrderAdjApi.getScope(
          yearMonth,
          personnelId,
          unitId,
        )
        if (cancelled) return
        const serverAdj = payload.adjustments || {}
        const serverCount = Object.keys(serverAdj).length
        const local = loadCommissionOrderAdjMap(yearMonth, personnelId, unitId)
        if (serverCount === 0 && Object.keys(local).length > 0) {
          setAudit(null)
          setCanMigrateLocal(true)
          setAdjTick((n) => n + 1)
          return
        }
        replaceCommissionOrderAdjMap(yearMonth, personnelId, unitId, serverAdj)
        setAudit(payload.audit)
        setCanMigrateLocal(false)
        setAdjTick((n) => n + 1)
      } catch (err) {
        if (cancelled) return
        console.error(err)
        const local = loadCommissionOrderAdjMap(yearMonth, personnelId, unitId)
        setAudit(null)
        setCanMigrateLocal(Object.keys(local).length > 0)
        setAdjTick((n) => n + 1)
      } finally {
        if (!cancelled) setSyncLoading(false)
      }
    }
    void loadScope()
    return () => {
      cancelled = true
    }
  }, [personnelId, unitId, yearMonth])

  const salesHref = personnelId && unitId && yearMonth
    ? buildSalesRecordsCheckHref({ personnelId, unitId, yearMonth })
    : '/sales-records'

  const backHref = '/payroll'

  function handleSaveAdj(saleId: string, next: CommissionOrderAdj | null) {
    saveCommissionOrderAdj(yearMonth, personnelId, unitId, saleId, next)
    setDirtyLocal(true)
    setAdjTick((n) => n + 1)
  }

  async function handleSaveOnline() {
    if (!canSaveOnline) {
      alert('无工资核算编辑权限，无法保存到线上')
      return
    }
    const adjustments = loadCommissionOrderAdjMap(yearMonth, personnelId, unitId)
    setSyncSaving(true)
    try {
      const payload = await commissionOrderAdjApi.saveScope({
        yearMonth,
        personnelId,
        unitId,
        adjustments,
      })
      replaceCommissionOrderAdjMap(
        yearMonth,
        personnelId,
        unitId,
        payload.adjustments || {},
      )
      setAudit(payload.audit)
      setCanMigrateLocal(false)
      setDirtyLocal(false)
      setAdjTick((n) => n + 1)
      const who = payload.summary?.updatedBy || '已同步'
      const when = payload.summary?.updatedAt
        ? formatDateTime(payload.summary.updatedAt)
        : ''
      setSavedTip(`已同步到服务器 · ${who}${when ? ` · ${when}` : ''}`)
    } catch (err) {
      console.error(err)
      setSavedTip('已存本机，服务器同步失败')
      alert(err instanceof Error ? err.message : '同步服务器失败')
    } finally {
      setSyncSaving(false)
      window.setTimeout(() => setSavedTip(''), 4000)
    }
  }

  async function handleMigrateLocal() {
    if (!canSaveOnline) {
      alert('无工资核算编辑权限，无法上传')
      return
    }
    const local = loadCommissionOrderAdjMap(yearMonth, personnelId, unitId)
    if (Object.keys(local).length === 0) {
      alert('本机没有可上传的调整')
      return
    }
    if (!confirm(`将本机 ${Object.keys(local).length} 笔订单调整上传到服务器？`)) {
      return
    }
    setSyncSaving(true)
    try {
      const payload = await commissionOrderAdjApi.saveScope({
        yearMonth,
        personnelId,
        unitId,
        adjustments: local,
      })
      replaceCommissionOrderAdjMap(
        yearMonth,
        personnelId,
        unitId,
        payload.adjustments || {},
      )
      setAudit(payload.audit)
      setCanMigrateLocal(false)
      setDirtyLocal(false)
      setAdjTick((n) => n + 1)
      setSavedTip('本机调整已上传服务器')
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : '上传失败')
    } finally {
      setSyncSaving(false)
      window.setTimeout(() => setSavedTip(''), 4000)
    }
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

      <div className="flex flex-wrap items-center gap-2">
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
        <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-base">销售明细核对</CardTitle>
            <CardDescription>
              与销售记录一致：客户、产品、活动、订单金额；「调整」改后先存本机，点右侧「保存到线上」后全员可见。
              {!detail.hasOrderAdj
                && Math.abs(lineSum - detail.systemPersonalTotal) > 0.05 && (
                <span className="ml-1 text-amber-700">
                  （行提成合计与系统个人提成差额{' '}
                  {formatCurrency(detail.systemPersonalTotal - lineSum)}
                  ，多为月门槛汇总口径；一旦有单笔调整则以明细合计为准）
                </span>
              )}
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {dirtyLocal && (
                <span className="text-xs text-amber-700">本机有未同步修改</span>
              )}
              {syncLoading && (
                <span className="text-xs text-muted-foreground">正在拉取线上调整…</span>
              )}
              {savedTip && (
                <span className="text-xs text-emerald-700">{savedTip}</span>
              )}
              {audit?.updatedAt && !savedTip && (
                <span className="text-xs text-muted-foreground">
                  线上：{audit.updatedBy || '—'} · {formatDateTime(audit.updatedAt)}
                  {audit.uploadedAt
                    ? ` · 首次上传 ${formatDateTime(audit.uploadedAt)}`
                    : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canMigrateLocal && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleMigrateLocal()}
                disabled={syncSaving}
              >
                <CloudUpload className="mr-1.5 h-3.5 w-3.5" />
                上传本机数据
              </Button>
            )}
            <Button
              size="sm"
              className="bg-sky-600 hover:bg-sky-700"
              onClick={() => void handleSaveOnline()}
              disabled={syncSaving || syncLoading}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {syncSaving ? '同步中…' : '保存到线上'}
            </Button>
          </div>
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
                    <TableCell className="text-sm">
                      {line.productId ? (
                        <Link
                          to={`/personnel?commission=${encodeURIComponent(personnelId)}&product=${encodeURIComponent(line.productId)}`}
                          className="inline-flex items-center gap-1 text-violet-700 underline-offset-2 hover:underline"
                          title="打开该产品提成配置"
                        >
                          {line.rateLabel}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{line.rateLabel}</span>
                      )}
                    </TableCell>
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
