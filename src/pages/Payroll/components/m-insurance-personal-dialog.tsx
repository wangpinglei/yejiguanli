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
  defaultSocialEmployer?: number
  defaultHousingEmployer?: number
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
  defaultSocialEmployer = 0,
  defaultHousingEmployer = 0,
  defaultSocialPersonal = 0,
  defaultHousingPersonal = 0,
  onAdjusted,
}: Props) {
  const { adjustPersonnelPay } = useData()
  const [effectiveDate, setEffectiveDate] = useState(defaultEffectiveDate)
  const [socialEmployer, setSocialEmployer] = useState(defaultSocialEmployer)
  const [housingEmployer, setHousingEmployer] = useState(defaultHousingEmployer)
  const [socialPersonal, setSocialPersonal] = useState(defaultSocialPersonal)
  const [housingPersonal, setHousingPersonal] = useState(defaultHousingPersonal)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setEffectiveDate(defaultEffectiveDate)
    setSocialEmployer(defaultSocialEmployer)
    setHousingEmployer(defaultHousingEmployer)
    setSocialPersonal(defaultSocialPersonal)
    setHousingPersonal(defaultHousingPersonal)
  }, [
    open,
    defaultEffectiveDate,
    defaultSocialEmployer,
    defaultHousingEmployer,
    defaultSocialPersonal,
    defaultHousingPersonal,
    person?.id,
    mode,
  ])

  const targets = mode === 'single'
    ? (person ? [person] : [])
    : people

  const title = mode === 'single'
    ? `调整社保公积金${person ? ` · ${person.name}` : ''}`
    : `批量调整社保公积金（${targets.length} 人）`

  async function handleSubmit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      alert('请填写生效日')
      return
    }
    if (targets.length === 0) {
      alert('没有可调整的人员')
      return
    }
    const socialE = Number(socialEmployer) || 0
    const housingE = Number(housingEmployer) || 0
    const socialP = Number(socialPersonal) || 0
    const housingP = Number(housingPersonal) || 0
    const confirmText = mode === 'single'
      ? `确认将「${targets[0].name}」自 ${effectiveDate} 起的社保/公积金（企业+个人）写入薪酬方案与个税档案？`
      : `确认对当前列表 ${targets.length} 人自 ${effectiveDate} 起统一写入？\n`
        + `社保企业 ${formatCurrency(socialE)} / 个人 ${formatCurrency(socialP)}\n`
        + `公积金企业 ${formatCurrency(housingE)} / 个人 ${formatCurrency(housingP)}\n`
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
            socialInsurance: socialE,
            housingFund: housingE,
            socialInsurancePersonal: socialP,
            housingFundPersonal: housingP,
            remark: mode === 'batch' ? '批量调整社保公积金' : '调整社保公积金',
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            企业部分计入成本；个人部分用于工资代扣。保存后写入薪酬方案与个税档案，
            修改会出现在该人「调整薪酬」记录中（含操作人、时间）。
            {mode === 'batch'
              ? ' 表单已带入列表第一人当前档案值，可在此基础上修改后统一写入。'
              : ' 表单已带入该人当前档案值。'}
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
              <Label>社保 · 企业 (¥/月)</Label>
              <Input
                type="number"
                value={socialEmployer}
                onChange={(e) => setSocialEmployer(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>社保 · 个人 (¥/月)</Label>
              <Input
                type="number"
                value={socialPersonal}
                onChange={(e) => setSocialPersonal(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>公积金 · 企业 (¥/月)</Label>
              <Input
                type="number"
                value={housingEmployer}
                onChange={(e) => setHousingEmployer(Number(e.target.value))}
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
