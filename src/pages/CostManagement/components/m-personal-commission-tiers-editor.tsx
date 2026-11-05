import type { PersonalCommissionTier } from '@/types'
import {
  hasPersonalCommissionTiers,
  normalizePersonalCommissionTiers,
} from '@/lib/personalCommissionTiers'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  tiers?: PersonalCommissionTier[]
  disabled?: boolean
  onChange: (tiers: PersonalCommissionTier[]) => void
}

/**
 * 个人提成可选业绩梯度。
 * 不添加行 = 不改变原「比例 + 起算门槛」逻辑。
 */
export default function MPersonalCommissionTiersEditor({
  tiers,
  disabled,
  onChange,
}: Props) {
  const list = normalizePersonalCommissionTiers(tiers)
  const enabled = hasPersonalCommissionTiers(list)

  function handleAdd() {
    const last = list[list.length - 1]
    onChange([
      ...list,
      {
        minSalesAmount: last ? last.minSalesAmount + 10000 : 0,
        ratePercent: last ? last.ratePercent : 10,
      },
    ])
  }

  function handleUpdate(index: number, patch: Partial<PersonalCommissionTier>) {
    onChange(
      list.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  function handleRemove(index: number) {
    onChange(list.filter((_, i) => i !== index))
  }

  function handleClear() {
    onChange([])
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-orange-200 bg-orange-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-xs">业绩梯度（可选）</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            不设置则仍用上方比例+门槛；设置后按月累计整段定档（全部×命中档比例）
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {enabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={disabled}
              onClick={handleClear}
            >
              清除梯度
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={handleAdd}
          >
            <Plus className="h-3 w-3 mr-1" />
            添加档位
          </Button>
        </div>
      </div>

      {enabled ? (
        <div className="space-y-2">
          {list.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">最低业绩 (¥)</Label>
                <Input
                  type="number"
                  disabled={disabled}
                  value={row.minSalesAmount}
                  onChange={(e) =>
                    handleUpdate(index, {
                      minSalesAmount: Number(e.target.value),
                    })
                  }
                  placeholder="如：0 或 30000"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">比例 (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  disabled={disabled}
                  value={row.ratePercent}
                  onChange={(e) =>
                    handleUpdate(index, {
                      ratePercent: Number(e.target.value),
                    })
                  }
                  placeholder="如：15"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground"
                disabled={disabled}
                onClick={() => handleRemove(index)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <p className="text-[11px] text-orange-800">
            例：≥0→10%、≥30000→15%；当月累计 3.5 万则 35000×15%
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">当前未设置梯度，计佣不变。</p>
      )}
    </div>
  )
}
