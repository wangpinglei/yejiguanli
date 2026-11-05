import { useEffect, useMemo, useState } from 'react'
import { ListPlus, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
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
 * 工资表加减项单元格：金额 + 明细备注展示；悬停金额时出现明细按钮
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
  const amountClass =
    kind === 'bonus' ? 'text-amber-700' : 'text-red-700'

  const displayNote = useMemo(() => {
    if (note.trim()) return note.trim()
    if (lines.length > 0) return formatAdjLinesNote(lines)
    return ''
  }, [note, lines])

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
    // 直接改金额时清空明细行，保留备注文字
    onChange({
      amount: nextAmount,
      note,
      lines: [],
    })
  }

  return (
    <div className="min-w-[132px] space-y-1 py-0.5">
      <div className="group/adj relative flex items-center gap-1">
        <Input
          type="number"
          className={`h-8 w-[88px] tabular-nums ${amountClass}`}
          value={amount || 0}
          onChange={(e) => handleAmountInput(e.target.value)}
          title={
            lines.length > 0
              ? '已有明细时改金额会清空明细行；悬停金额可打开明细'
              : '悬停金额可打开多项明细'
          }
        />
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
                <span className={`font-medium tabular-nums ${amountClass}`}>
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
      {displayNote ? (
        <p
          className="max-w-[160px] truncate text-[11px] leading-tight text-muted-foreground"
          title={displayNote}
        >
          {displayNote}
        </p>
      ) : (
        <p className="text-[11px] leading-tight text-muted-foreground/70">无明细</p>
      )}
    </div>
  )
}
