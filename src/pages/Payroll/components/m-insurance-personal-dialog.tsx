import { useEffect, useState } from 'react'

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
import { useData } from '@/context/DataContext'
import { formatCurrency } from '@/lib/format'
import type { Personnel } from '@/types'

type Mode = 'single' | 'batch'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: Mode
  /** 单人调整 */
  person: Personnel | null
  /** 批量调整的人员列表 */
  people: Personnel[]
  /** 默认生效日 YYYY-MM-DD */
  defaultEffectiveDate: string
  /** 默认社保/公积金个人（单人时用当前值） */
  defaultSocialPersonal?: number
  defaultHousingPersonal?: number
  onAdjusted?: (personnelIds: string[]) => void
}

export default function MInsurancePersonalDialog({
  open,
  onOpenChange,
  mode,
  person,
  people,
  defaultEffectiveDate,
  defaultSocialPersonal = 0,
  defaultHousingPersonal = 0,
  onAdjusted,
}: Props) {
  const { adjustPersonnelPay } = useData()
  const [effectiveDate, setEffectiveDate] = useState(defaultEffectiveDate)
  const [socialPersonal, setSocialPersonal] = useState(defaultSocialPersonal)
  const [housingPersonal, setHousingPersonal] = useState(defaultHousingPersonal)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setEffectiveDate(defaultEffectiveDate)
    setSocialPersonal(defaultSocialPersonal)
    setHousingPersonal(defaultHousingPersonal)
  }, [
    open,
    defaultEffectiveDate,
    defaultSocialPersonal,
    defaultHousingPersonal,
    person?.id,
    mode,
  ])

  const targets = mode === 'single'
    ? (person ? [person] : [])
    : people

  const title = mode === 'single'
    ? `调整个人代扣${person ? ` · ${person.name}` : ''}`
    : `批量调整个人代扣（${targets.length} 人）`

  async function handleSubmit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      alert('请填写生效日')
      return
    }
    if (targets.length === 0) {
      alert('没有可调整的人员')
      return
    }
    const confirmText = mode === 'single'
      ? `确认将「${targets[0].name}」自 ${effectiveDate} 起的社保/公积金个人代扣写入薪酬方案与个税档案？`
      : `确认对当前列表 ${targets.length} 人自 ${effectiveDate} 起统一写入个人代扣？\n`
        + `社保个人 ${formatCurrency(Number(socialPersonal) || 0)}，`
        + `公积金个人 ${formatCurrency(Number(housingPersonal) || 0)}\n`
        + '将写入各人薪酬方案与个税档案，并产生修改记录。'
    if (!confirm(confirmText)) return

    setSaving(true)
    const ids: string[] = []
    const errors: string[] = []
    try {
      for (const p of targets) {
        try {
          await adjustPersonnelPay(p.id, {
            effectiveDate,
            salary: p.salary,
            socialInsurance: p.socialInsurance || 0,
            housingFund: p.housingFund || 0,
            socialInsurancePersonal: Number(socialPersonal) || 0,
            housingFundPersonal: Number(housingPersonal) || 0,
            remark: mode === 'batch' ? '批量调整个人代扣' : '调整个人代扣',
          })
          ids.push(p.id)
        } catch (e: unknown) {
          errors.push(
            `${p.name}: ${e instanceof Error ? e.message : '失败'}`,
          )
        }
      }
      if (errors.length > 0) {
        alert(
          `完成 ${ids.length} 人，失败 ${errors.length} 人：\n${errors.slice(0, 8).join('\n')}`,
        )
      }
      onAdjusted?.(ids)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            保存后写入人员薪酬方案与个税扣除档案，之后月份工资核算默认用新值；
            修改会出现在该人「调整薪酬」记录中（含操作人、时间）。
          </p>
          <div className="space-y-1.5">
            <Label>生效日 *</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>社保 · 个人 (¥/月)</Label>
              <Input
                type="number"
                value={socialPersonal}
                onChange={(e) => setSocialPersonal(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>公积金 · 个人 (¥/月)</Label>
              <Input
                type="number"
                value={housingPersonal}
                onChange={(e) => setHousingPersonal(Number(e.target.value))}
              />
            </div>
          </div>
          {mode === 'single' && person && (
            <p className="text-xs text-muted-foreground">
              企业承担保持不变：社保 {formatCurrency(person.socialInsurance || 0)}
              ，公积金 {formatCurrency(person.housingFund || 0)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button disabled={saving} onClick={() => void handleSubmit()}>
            {saving ? '保存中…' : '确认调整'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
