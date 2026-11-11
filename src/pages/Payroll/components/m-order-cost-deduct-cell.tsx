import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

type Props = {
  costDeduction: number
  systemCost: number
  isManual: boolean
  disabled?: boolean
  onSave: (override: number | null) => void
}

/**
 * 本单成本扣除：默认跟产品配置；可手工覆盖（null=恢复自动）
 */
export default function MOrderCostDeductCell({
  costDeduction,
  systemCost,
  isManual,
  disabled = false,
  onSave,
}: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(String(costDeduction || ''))
  }, [open, costDeduction])

  function handleSaveManual() {
    const n = draft === '' ? 0 : Number(draft)
    onSave(Number.isFinite(n) ? Math.max(0, n) : 0)
    setOpen(false)
  }

  function handleResetAuto() {
    onSave(null)
    setOpen(false)
  }

  return (
    <div className="group/cost flex min-w-[100px] items-center justify-end gap-1">
      <div className="text-right tabular-nums">
        <div className={isManual ? 'font-medium text-amber-800' : ''}>
          {formatCurrency(costDeduction)}
        </div>
        {isManual && (
          <div className="text-[10px] text-amber-700">
            手改 · 系统 {formatCurrency(systemCost)}
          </div>
        )}
      </div>
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'h-7 shrink-0 px-1.5 transition-opacity',
                open
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/cost:opacity-100 focus-visible:opacity-100',
              )}
              title="编辑本单成本扣除"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[280px] space-y-3 p-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">本单成本扣除</Label>
              <p className="text-[11px] text-muted-foreground">
                默认按产品成本配置；手工修改后，结算与计佣业绩同步用扣后净额。
              </p>
              <p className="text-[11px] text-muted-foreground">
                系统自动：{formatCurrency(systemCost)}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">成本扣除（元）</Label>
              <Input
                type="number"
                min={0}
                className="h-8"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleResetAuto}>
                恢复自动
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="button" size="sm" onClick={handleSaveManual}>
                  保存
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
