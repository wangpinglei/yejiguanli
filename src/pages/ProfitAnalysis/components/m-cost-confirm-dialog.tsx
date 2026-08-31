import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calculator, Clock } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/format'
import type { CostItem, CostRecord } from '@/types'
import { matchesRecurringYearMonth } from '@/utils/recurringRecord'

export type CostConfirmLine = {
  key: string
  recordId: string
  itemId: string
  category: string
  description: string
  estimated: number
  actual: number
  isRecurring: boolean
  recordRemark: string
}

type Props = {
  open: boolean
  unitId: string
  unitName: string
  yearMonth: string
  estimated: number
  existingActual?: number
  existingRemark?: string
  costRecords: CostRecord[]
  onClose: () => void
  onSubmit: (payload: {
    actualAmount: number
    remark: string
    lines: CostConfirmLine[]
    recordsToUpdate: Array<{
      recordId: string
      items: CostItem[]
      totalCost: number
    }>
  }) => Promise<void>
}

export function buildCostConfirmLines(
  costRecords: CostRecord[],
  unitId: string,
  yearMonth: string,
  existingActual?: number,
): CostConfirmLine[] {
  const records = costRecords.filter(
    (c) =>
      c.salesUnitId === unitId && matchesRecurringYearMonth(c, yearMonth),
  )

  const lines: CostConfirmLine[] = []
  records.forEach((record) => {
    const items = record.items || []
    if (items.length === 0 && (Number(record.totalCost) || 0) > 0) {
      lines.push({
        key: `${record.id}::__total`,
        recordId: record.id,
        itemId: '__total',
        category: '未拆分明细',
        description: record.remark || '整笔成本',
        estimated: Number(record.totalCost) || 0,
        actual: Number(record.totalCost) || 0,
        isRecurring: Boolean(record.isRecurring),
        recordRemark: record.remark || '',
      })
      return
    }
    items.forEach((item) => {
      lines.push({
        key: `${record.id}::${item.id}`,
        recordId: record.id,
        itemId: item.id,
        category: item.category || '其他',
        description: item.description || '',
        estimated: Number(item.amount) || 0,
        actual: Number(item.amount) || 0,
        isRecurring: Boolean(record.isRecurring),
        recordRemark: record.remark || '',
      })
    })
  })

  const estimatedSum = lines.reduce((s, l) => s + l.estimated, 0)
  if (
    existingActual != null
    && Number.isFinite(existingActual)
    && estimatedSum > 0
    && Math.abs(existingActual - estimatedSum) > 0.009
  ) {
    const ratio = existingActual / estimatedSum
    let allocated = 0
    lines.forEach((line, idx) => {
      if (idx === lines.length - 1) {
        line.actual = Math.round((existingActual - allocated) * 100) / 100
      } else {
        line.actual = Math.round(line.estimated * ratio * 100) / 100
        allocated += line.actual
      }
    })
  }

  return lines
}

export default function MCostConfirmDialog({
  open,
  unitId,
  unitName,
  yearMonth,
  estimated,
  existingActual,
  existingRemark,
  costRecords,
  onClose,
  onSubmit,
}: Props) {
  const [lines, setLines] = useState<CostConfirmLine[]>([])
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)
  const [fallbackActual, setFallbackActual] = useState(0)

  useEffect(() => {
    if (!open) return
    const next = buildCostConfirmLines(costRecords, unitId, yearMonth, existingActual)
    setLines(next)
    setFallbackActual(
      existingActual != null && Number.isFinite(existingActual)
        ? existingActual
        : estimated,
    )
    setRemark(existingRemark || '')
  }, [open, costRecords, unitId, yearMonth, existingActual, existingRemark, estimated])

  const actualSum = useMemo(() => {
    if (lines.length === 0) return Number(fallbackActual) || 0
    return lines.reduce((s, l) => s + (Number(l.actual) || 0), 0)
  }, [lines, fallbackActual])
  const hasRecurring = lines.some((l) => l.isRecurring)
  const diff = actualSum - estimated

  function handleChangeActual(key: string, value: number) {
    setLines((prev) =>
      prev.map((line) =>
        (line.key === key ? { ...line, actual: Number.isFinite(value) ? value : 0 } : line),
      ),
    )
  }

  async function handleSubmit() {
    const recordMap = new Map<string, CostConfirmLine[]>()
    lines.forEach((line) => {
      if (line.isRecurring || !line.recordId) return
      const list = recordMap.get(line.recordId) || []
      list.push(line)
      recordMap.set(line.recordId, list)
    })

    const recordsToUpdate: Array<{
      recordId: string
      items: CostItem[]
      totalCost: number
    }> = []

    recordMap.forEach((recordLines, recordId) => {
      const source = costRecords.find((c) => c.id === recordId)
      if (!source) return
      const changed = recordLines.some(
        (l) => Math.abs(l.actual - l.estimated) > 0.009,
      )
      if (!changed) return

      if (recordLines.length === 1 && recordLines[0].itemId === '__total') {
        recordsToUpdate.push({
          recordId,
          items: source.items || [],
          totalCost: recordLines[0].actual,
        })
        return
      }

      const itemMap = new Map(recordLines.map((l) => [l.itemId, l.actual]))
      const nextItems = (source.items || []).map((item) => ({
        ...item,
        amount: itemMap.has(item.id) ? (itemMap.get(item.id) as number) : item.amount,
      }))
      const totalCost = nextItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
      recordsToUpdate.push({ recordId, items: nextItems, totalCost })
    })

    setSaving(true)
    try {
      await onSubmit({
        actualAmount: actualSum,
        remark,
        lines,
        recordsToUpdate,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-orange-600" />
            确认实际成本（可逐条修改）
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium">{unitName}</p>
              <p className="text-xs text-muted-foreground">{yearMonth}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-xs text-muted-foreground">预估合计</p>
              <p className="font-bold text-orange-600">{formatCurrency(estimated)}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-xs text-muted-foreground">实际合计（明细汇总）</p>
              <p className="font-bold text-amber-600">{formatCurrency(actualSum)}</p>
            </div>
          </div>

          {hasRecurring && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                含「月度固定」成本：修改金额仅影响本月确认结果，不会改动原固定成本模板。
                非固定成本明细会写回「成本与收入录入」。
              </span>
            </div>
          )}

          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              本月该单位暂无手工成本明细，可直接填写合计金额确认
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>类别</TableHead>
                    <TableHead>说明</TableHead>
                    <TableHead className="w-24">类型</TableHead>
                    <TableHead className="text-right">预估</TableHead>
                    <TableHead className="w-36 text-right">实际金额</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.key}>
                      <TableCell className="font-medium">{line.category}</TableCell>
                      <TableCell className="max-w-[220px] text-muted-foreground">
                        <span className="line-clamp-2">
                          {line.description || line.recordRemark || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {line.isRecurring ? (
                          <Badge variant="outline" className="text-xs">月度固定</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">单次</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {formatCurrency(line.estimated)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="ml-auto h-8 w-28 text-right"
                          value={line.actual}
                          onChange={(e) =>
                            handleChangeActual(line.key, Number(e.target.value))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {lines.length === 0 && (
            <div className="space-y-2">
              <Label>实际发生成本合计（¥）</Label>
              <Input
                type="number"
                value={fallbackActual}
                onChange={(e) => setFallbackActual(Number(e.target.value) || 0)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>确认说明</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="如：发票差额、补记、冲回等"
              rows={2}
            />
          </div>

          {Math.abs(diff) > 0.009 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              与预估差额: {diff > 0 ? '+' : ''}{formatCurrency(diff)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            <Clock className="mr-1 h-4 w-4" />
            {saving ? '保存中…' : '保存确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
