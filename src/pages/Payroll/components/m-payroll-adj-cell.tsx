import { useEffect, useMemo, useState } from 'react'
import { ListPlus, Plus, Trash2 } from 'lucide-react'

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
  formatAdjLinesComment,
  formatAdjLinesNote,
  sumAdjLines,
  type PayrollAdjLine,
} from '@/lib/payrollCalc'
import { cn } from '@/lib/utils'

type Props = {
  kind: 'bonus' | 'deduction'
  amount: number
  note: string
  lines: PayrollAdjLine[]
  onChange: (next: {
    amount: number
    note: string
    lines: PayrollAdjLine[]
  }) => void
}

function emptyLine(): PayrollAdjLine {
  return { label: '', amount: 0 }
}

/**
 * 工资表加减项：金额用常规字色；悬停金额框显示明细，并出现编辑按钮
 */
export default function MPayrollAdjCell({
  kind,
  amount,
  note,
  lines,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [draftLines, setDraftLines] = useState<PayrollAdjLine[]>([emptyLine()])
  const [draftNote, setDraftNote] = useState('')
  const [draftAmount, setDraftAmount] = useState(0)

  const title = kind === 'bonus' ? '加项明细' : '减项明细'

  const detailText = useMemo(() => {
    return formatAdjLinesComment(lines, note)
  }, [lines, note])

  const detailRows = useMemo(() => {
    if (lines.length > 0) {
      return lines
        .map((line) => {
          const label = (line.label || '').trim()
          const amt = Number(line.amount) || 0
          if (!label && amt === 0) return null
          return {
            label: label || '（无说明）',
            amount: amt,
          }
        })
        .filter(Boolean) as Array<{ label: string; amount: number }>
    }
    if (note.trim()) {
      return [{ label: note.trim(), amount: Number(amount) || 0 }]
    }
    return []
  }, [lines, note, amount])

  const hasDetail = detailRows.length > 0 || Boolean(detailText)

  useEffect(() => {
    if (!open) return
    const seed = lines.length > 0 ? lines.map((l) => ({ ...l })) : [emptyLine()]
    setDraftLines(seed)
    setDraftNote(note || (lines.length > 0 ? formatAdjLinesNote(lines) : ''))
    setDraftAmount(amount || 0)
  }, [open, lines, note, amount])

  const draftTotal = useMemo(() => {
    const hasContent = draftLines.some(
      (l) => (l.label || '').trim() || Number(l.amount),
    )
    return hasContent ? sumAdjLines(draftLines) : draftAmount
  }, [draftLines, draftAmount])

  function handleSaveDraft() {
    const cleaned = draftLines
      .map((l) => ({
        label: (l.label || '').trim(),
        amount: Number(l.amount) || 0,
      }))
      .filter((l) => l.label || l.amount !== 0)

    if (cleaned.length > 0) {
      onChange({
        amount: sumAdjLines(cleaned),
        note: draftNote.trim() || formatAdjLinesNote(cleaned),
        lines: cleaned,
      })
    } else {
      onChange({
        amount: Number(draftAmount) || 0,
        note: draftNote.trim(),
        lines: [],
      })
    }
    setOpen(false)
  }

  function handleAmountInput(value: string) {
    const nextAmount = value === '' ? 0 : Number(value) || 0
    onChange({
      amount: nextAmount,
      note,
      lines: [],
    })
  }

  return (
    <div className="group/adj relative flex min-w-[120px] items-center gap-1 py-0.5">
      <HoverCard openDelay={120} closeDelay={80}>
        <HoverCardTrigger asChild>
          <div className="relative">
            <Input
              type="number"
              className={cn(
                'h-8 w-[96px] text-sm text-foreground tabular-nums',
                kind === 'deduction' && amount ? 'text-red-600' : undefined,
              )}
              value={amount || 0}
              onChange={(e) => handleAmountInput(e.target.value)}
              title={
                hasDetail
                  ? '悬停查看明细；改金额会清空明细行'
                  : '悬停可添加多项明细'
              }
            />
          </div>
        </HoverCardTrigger>
        {hasDetail && (
          <HoverCardContent
            align="start"
            side="top"
            className="w-[220px] space-y-2 p-3 text-sm"
          >
            <div className="text-xs font-medium text-muted-foreground">{title}</div>
            <ul className="space-y-1">
              {detailRows.map((row, i) => (
                <li
                  key={`${row.label}-${i}`}
                  className="flex items-baseline justify-between gap-3 text-foreground"
                >
                  <span className="min-w-0 break-all leading-snug">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {row.amount}
                  </span>
                </li>
              ))}
            </ul>
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
            title={title}
          >
            <ListPlus className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] space-y-3 p-3">
          <div className="space-y-1">
            <Label className="text-sm font-medium">{title}</Label>
            <p className="text-[11px] text-muted-foreground">
              可填多行说明与金额；保存后合计写入工资表，导出 Excel 时明细写入单元格批注。
            </p>
          </div>

          <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
            {draftLines.map((line, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  className="h-8 flex-1"
                  placeholder="说明，如全勤奖"
                  value={line.label}
                  onChange={(e) => {
                    const next = [...draftLines]
                    next[index] = { ...next[index], label: e.target.value }
                    setDraftLines(next)
                  }}
                />
                <Input
                  type="number"
                  className="h-8 w-[88px]"
                  placeholder="金额"
                  value={line.amount || ''}
                  onChange={(e) => {
                    const next = [...draftLines]
                    next[index] = {
                      ...next[index],
                      amount: e.target.value === '' ? 0 : Number(e.target.value) || 0,
                    }
                    setDraftLines(next)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 px-0 text-muted-foreground"
                  onClick={() => {
                    const next = draftLines.filter((_, i) => i !== index)
                    setDraftLines(next.length > 0 ? next : [emptyLine()])
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setDraftLines((prev) => [...prev, emptyLine()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加一行
          </Button>

          <div className="space-y-1.5 border-t pt-2">
            <Label className="text-xs text-muted-foreground">显示备注（可改）</Label>
            <Input
              className="h-8"
              placeholder="如：全勤奖；高温补贴"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                无明细行时可只填总金额
              </span>
              <span className="font-medium tabular-nums text-foreground">
                合计 {draftTotal}
              </span>
            </div>
            {draftLines.every((l) => !(l.label || '').trim() && !Number(l.amount)) && (
              <Input
                type="number"
                className="h-8"
                placeholder="总金额"
                value={draftAmount || ''}
                onChange={(e) =>
                  setDraftAmount(e.target.value === '' ? 0 : Number(e.target.value) || 0)
                }
              />
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button type="button" size="sm" onClick={handleSaveDraft}>
              保存明细
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
