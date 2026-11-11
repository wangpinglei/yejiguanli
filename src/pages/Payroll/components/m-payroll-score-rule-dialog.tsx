import { useEffect, useMemo, useState } from 'react'

import { Plus, Trash2 } from 'lucide-react'

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
  createScoreRuleItemId,
  getScoreRuleItemsTotalMax,
  normalizeScoreRuleItems,
  type PayrollScoreRuleItem,
} from '@/lib/payrollScoreRules'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  unitId: string
  unitName: string
  initialItems: PayrollScoreRuleItem[]
  saving?: boolean
  onSave: (items: PayrollScoreRuleItem[]) => Promise<void> | void
}

export default function MPayrollScoreRuleDialog({
  open,
  onOpenChange,
  unitId,
  unitName,
  initialItems,
  saving = false,
  onSave,
}: Props) {
  const [items, setItems] = useState<PayrollScoreRuleItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const next = normalizeScoreRuleItems(initialItems)
    setItems(
      next.length > 0
        ? next
        : [
            { id: createScoreRuleItemId(), name: '目标完成', maxScore: 40 },
            { id: createScoreRuleItemId(), name: '过程管理', maxScore: 30 },
            { id: createScoreRuleItemId(), name: '态度协作', maxScore: 30 },
          ],
    )
    setError('')
  }, [open, initialItems, unitId])

  const totalMax = useMemo(() => getScoreRuleItemsTotalMax(items), [items])

  function handleAddItem() {
    setItems((prev) => [
      ...prev,
      { id: createScoreRuleItemId(), name: '', maxScore: 10 },
    ])
  }

  function handleRemoveItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  async function handleSave() {
    const cleaned = normalizeScoreRuleItems(
      items.map((item) => ({
        ...item,
        name: item.name.trim(),
        maxScore: Number(item.maxScore) || 0,
      })),
    )
    if (cleaned.length === 0) {
      setError('请至少保留一项，或点「清除规则」改回只填总分')
      return
    }
    if (cleaned.some((item) => !item.name)) {
      setError('评分项名称不能为空')
      return
    }
    setError('')
    await onSave(cleaned)
  }

  async function handleClear() {
    if (!confirm(`确定清除「${unitName}」的评分规则？清除后本单位改回只填总分。`)) {
      return
    }
    setError('')
    await onSave([])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑绩效评分规则 · {unitName || '单位'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            规则按单位保存，下月沿用。每月在核算「绩效分数」步骤按项打分，自动合计为考核分（0–100）。
            建议各项满分合计为 100。
          </p>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={item.id} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[160px] flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    评分项 {index + 1}
                  </Label>
                  <Input
                    value={item.name}
                    placeholder="如：目标完成"
                    maxLength={40}
                    onChange={(e) => {
                      const name = e.target.value
                      setItems((prev) =>
                        prev.map((row) =>
                          row.id === item.id ? { ...row, name } : row,
                        ),
                      )
                    }}
                  />
                </div>
                <div className="w-[96px] space-y-1">
                  <Label className="text-xs text-muted-foreground">满分</Label>
                  <Input
                    type="number"
                    min={0.01}
                    max={100}
                    step="1"
                    value={item.maxScore}
                    onChange={(e) => {
                      const maxScore = Number(e.target.value)
                      setItems((prev) =>
                        prev.map((row) =>
                          row.id === item.id
                            ? {
                                ...row,
                                maxScore: Number.isFinite(maxScore) ? maxScore : 0,
                              }
                            : row,
                        ),
                      )
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground"
                  onClick={() => handleRemoveItem(item.id)}
                  disabled={items.length <= 1}
                  title="删除该项"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleAddItem}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              添加评分项
            </Button>
            <span
              className={
                Math.abs(totalMax - 100) < 0.05
                  ? 'text-xs text-emerald-700'
                  : 'text-xs text-amber-700'
              }
            >
              满分合计 {totalMax}
              {Math.abs(totalMax - 100) >= 0.05 ? '（建议 100）' : ''}
            </span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            disabled={saving}
            onClick={() => void handleClear()}
          >
            清除规则
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存规则'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
