import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  createEmptyCommissionOrderAdj,
  formatCommissionOrderAdjComment,
  formatCommissionOrderAdjSummary,
  hasCommissionOrderAdj,
  type CommissionOrderAdj,
} from '@/lib/commissionOrderAdj'
import { cn } from '@/lib/utils'

type Props = {
  adj: CommissionOrderAdj | null
  onSave: (next: CommissionOrderAdj | null) => void
}

/**
 * 单笔订单提成调整：悬停看明细，点击编辑业绩/比例/提成金额
 */
export default function MCommissionOrderAdjCell({ adj, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CommissionOrderAdj>(createEmptyCommissionOrderAdj())

  const summary = formatCommissionOrderAdjSummary(adj)
  const comment = formatCommissionOrderAdjComment(adj)
  const hasAdj = hasCommissionOrderAdj(adj)

  useEffect(() => {
    if (!open) return
    setDraft(adj ? { ...adj } : createEmptyCommissionOrderAdj())
  }, [open, adj])

  function handleSave() {
    if (!hasCommissionOrderAdj(draft)) {
      onSave(null)
    } else {
      onSave({
        salesAmountAdj: Number(draft.salesAmountAdj) || 0,
        rateAdjPct: Number(draft.rateAdjPct) || 0,
        commissionAmountAdj: Number(draft.commissionAmountAdj) || 0,
        note: (draft.note || '').trim(),
      })
    }
    setOpen(false)
  }

  function handleClear() {
    onSave(null)
    setOpen(false)
  }

  return (
    <div className="group/adj flex min-w-[120px] items-center gap-1">
      <HoverCard openDelay={120} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className={cn(
              'h-8 min-w-[96px] flex-1 truncate rounded-md border px-2 text-left text-sm',
              hasAdj
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-dashed border-muted-foreground/30 text-muted-foreground',
            )}
          >
            {hasAdj ? summary : '无调整'}
          </button>
        </HoverCardTrigger>
        {hasAdj && (
          <HoverCardContent align="start" side="top" className="w-[240px] space-y-1 p-3 text-sm">
            <div className="text-xs font-medium text-muted-foreground">订单调整</div>
            <pre className="whitespace-pre-wrap font-sans text-foreground leading-relaxed">
              {comment}
            </pre>
          </HoverCardContent>
        )}
      </HoverCard>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'h-8 shrink-0 px-2 transition-opacity',
              open
                ? 'opacity-100'
                : 'opacity-0 group-hover/adj:opacity-100 focus-visible:opacity-100',
            )}
            title="编辑订单提成调整"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] space-y-3 p-3">
          <div className="space-y-1">
            <Label className="text-sm font-medium">单笔订单调整</Label>
            <p className="text-[11px] text-muted-foreground">
              可改计佣业绩、提成比例或提成金额；保存后写入本行提成并回写工资表。
            </p>
          </div>

          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">业绩调整（元）</Label>
              <Input
                type="number"
                className="h-8"
                placeholder="如 -1000"
                value={draft.salesAmountAdj || ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    salesAmountAdj: e.target.value === '' ? 0 : Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">比例调整（百分点）</Label>
              <Input
                type="number"
                className="h-8"
                placeholder="如 5 表示 +5%"
                value={draft.rateAdjPct || ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    rateAdjPct: e.target.value === '' ? 0 : Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">提成金额调整（元）</Label>
              <Input
                type="number"
                className="h-8"
                placeholder="如 200"
                value={draft.commissionAmountAdj || ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    commissionAmountAdj:
                      e.target.value === '' ? 0 : Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">说明</Label>
              <Input
                className="h-8"
                placeholder="如：补发 / 扣业绩"
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
              清除调整
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="button" size="sm" onClick={handleSave}>
                保存
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
