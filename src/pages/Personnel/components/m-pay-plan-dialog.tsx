import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { EMPTY_SALARY, getFixedSalary, isInternalEmployeePerson } from '@/lib/salary'
import type { Personnel, PersonnelPayPlan, SalaryStructure } from '@/types'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export type PayPlanFocusField =
  | 'baseSalary'
  | 'confidentialityFee'
  | 'performance'
  | 'positionAllowance'

type Props = {
  person: Personnel | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
  /** 打开时滚动并高亮对应薪酬字段 */
  focusField?: PayPlanFocusField | null
}

type PayForm = {
  effectiveDate: string
  remark: string
  salary: SalaryStructure
  socialInsurance: number
  housingFund: number
  socialInsurancePersonal: number
  housingFundPersonal: number
}

function sortPayPlans(list: PersonnelPayPlan[]): PersonnelPayPlan[] {
  return [...list].sort((a, b) =>
    `${a.startDate}${a.createdAt || ''}`.localeCompare(`${b.startDate}${b.createdAt || ''}`),
  )
}

function getLatestOpenPlan(person: Personnel | null): PersonnelPayPlan | null {
  const open = (person?.payPlans || []).filter((p) => !p.endDate)
  if (open.length === 0) return null
  open.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
  return open[open.length - 1] || null
}

function getDefaultForm(person: Personnel | null): PayForm {
  // 默认当月 1 日（转正/调薪常用）；需要可再改早或改晚
  const now = new Date()
  const suggested = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const latest = getLatestOpenPlan(person)
  const tax = person?.taxProfile
  return {
    effectiveDate: suggested,
    remark: '转正',
    salary: { ...EMPTY_SALARY, ...(person?.salary || {}) },
    socialInsurance: person?.socialInsurance || 0,
    housingFund: person?.housingFund || 0,
    socialInsurancePersonal:
      Number(latest?.socialInsurancePersonal)
      || Number(tax?.socialInsurancePersonal)
      || 0,
    housingFundPersonal:
      Number(latest?.housingFundPersonal)
      || Number(tax?.housingFundPersonal)
      || 0,
  }
}

const FOCUS_FIELD_IDS: Record<PayPlanFocusField, string> = {
  baseSalary: 'pay-plan-baseSalary',
  confidentialityFee: 'pay-plan-confidentialityFee',
  performance: 'pay-plan-performance',
  positionAllowance: 'pay-plan-positionAllowance',
}

export default function MPayPlanDialog({
  person,
  open,
  onOpenChange,
  canEdit,
  focusField = null,
}: Props) {
  const { adjustPersonnelPay, personnel } = useData()
  const [form, setForm] = useState<PayForm>(() => getDefaultForm(person))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(getDefaultForm(person))
  }, [open, person])

  useEffect(() => {
    if (!open || !focusField || !canEdit) return
    const id = FOCUS_FIELD_IDS[focusField]
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const input = el.querySelector('input')
      input?.focus()
      input?.select()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [open, focusField, canEdit, person?.id])

  const livePerson = useMemo(
    () => personnel.find((p) => p.id === person?.id) || person,
    [personnel, person],
  )
  const planRows = useMemo(
    () => sortPayPlans(livePerson?.payPlans || []),
    [livePerson],
  )

  function updateSalary(field: keyof SalaryStructure, value: number) {
    setForm((prev) => ({
      ...prev,
      salary: { ...prev.salary, [field]: value },
    }))
  }

  const latestOpenStart = useMemo(() => {
    const openPlans = planRows.filter((p) => !p.endDate)
    if (openPlans.length === 0) return ''
    return openPlans
      .map((p) => (p.startDate || '').slice(0, 10))
      .filter(Boolean)
      .sort()
      .pop() || ''
  }, [planRows])

  async function handleSubmit() {
    if (!person) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) {
      alert('请填写薪酬生效日')
      return
    }
    const isEarlierCorrection = Boolean(
      latestOpenStart && form.effectiveDate < latestOpenStart,
    )
    const confirmText = isEarlierCorrection
      ? `确认「${person.name}」自 ${form.effectiveDate} 起使用新薪酬？\n\n`
        + `生效日早于当前薪酬段开始日 ${latestOpenStart}，将删除 ${form.effectiveDate} 及之后的薪酬段并重建。\n`
        + '此前月份仍按更早段落计算；提成仍按成交当月配置。'
      : `确认「${person.name}」自 ${form.effectiveDate} 起使用新薪酬？\n\n`
        + '生效日前（含试用期月份）仍按旧底薪/社保公积金计算；'
        + '从生效日起按新标准。个人代扣会同步到个税扣除档案与工资核算。'
    if (!confirm(confirmText)) {
      return
    }
    setSaving(true)
    try {
      await adjustPersonnelPay(person.id, {
        effectiveDate: form.effectiveDate,
        salary: form.salary,
        socialInsurance: form.socialInsurance,
        housingFund: form.housingFund,
        socialInsurancePersonal: form.socialInsurancePersonal,
        housingFundPersonal: form.housingFundPersonal,
        remark: form.remark.trim() || '调薪',
      })
      onOpenChange(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '调整薪酬失败')
    } finally {
      setSaving(false)
    }
  }

  const currentFixed = getFixedSalary(person?.salary || EMPTY_SALARY)
  const nextFixed = getFixedSalary(form.salary)
  const currentPersonalSocial =
    Number(getLatestOpenPlan(person)?.socialInsurancePersonal)
    || Number(person?.taxProfile?.socialInsurancePersonal)
    || 0
  const currentPersonalHousing =
    Number(getLatestOpenPlan(person)?.housingFundPersonal)
    || Number(person?.taxProfile?.housingFundPersonal)
    || 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!flex !h-[92vh] !max-h-[92vh] !w-[96vw] !max-w-[96vw] flex-col gap-3 overflow-hidden p-5 sm:!max-w-[96vw]"
        style={{ width: '96vw', maxWidth: '96vw', height: '92vh', maxHeight: '92vh' }}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            调整薪酬{person ? ` · ${person.name}` : ''}
          </DialogTitle>
        </DialogHeader>
        {person && !isInternalEmployeePerson(person) && (
          <div className="rounded-md border border-violet-200 bg-violet-50/50 px-4 py-6 text-sm text-violet-900">
            <p className="font-medium">合作方 · 仅提成</p>
            <p className="mt-1 text-muted-foreground">
              已关闭「内部员工」，不发底薪/绩效/补贴，也不缴纳社保公积金。
              提成请在人员编辑或产品提成配置中维护；无需在此调整固定薪酬。
            </p>
          </div>
        )}
        {person && isInternalEmployeePerson(person) && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-1 pr-1">
            <p className="text-sm text-muted-foreground">
              与调岗、分销一样按生效日分段。试用转正请把生效日设为转正月 1 日，
              并改底薪、社保、公积金（企业/个人）；更早月份不会被新标准覆盖。
              个人代扣会覆盖个税扣除档案默认值，并用于工资核算。
            </p>
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm space-y-1">
              <div>
                当前固定月薪 {formatCurrency(currentFixed)}
              </div>
              <div>
                社保 企业 {formatCurrency(person.socialInsurance || 0)}
                {' / '}
                个人 {formatCurrency(currentPersonalSocial)}
                ，公积金 企业 {formatCurrency(person.housingFund || 0)}
                {' / '}
                个人 {formatCurrency(currentPersonalHousing)}
              </div>
            </div>

            {planRows.length > 0 && (
              <div className="space-y-2">
                <Label>薪酬记录</Label>
                <div className="max-h-[36vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>开始日</TableHead>
                        <TableHead>结束日</TableHead>
                        <TableHead className="text-right">固定月薪</TableHead>
                        <TableHead className="text-right">社保企业</TableHead>
                        <TableHead className="text-right">社保个人</TableHead>
                        <TableHead className="text-right">公积金企业</TableHead>
                        <TableHead className="text-right">公积金个人</TableHead>
                        <TableHead>说明</TableHead>
                        <TableHead>操作人</TableHead>
                        <TableHead>记录时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{formatDate(row.startDate)}</TableCell>
                          <TableCell>
                            {row.endDate ? formatDate(row.endDate) : '至今'}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(getFixedSalary(row.salary))}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.socialInsurance)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.socialInsurancePersonal || 0)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.housingFund)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.housingFundPersonal || 0)}
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate">
                            {row.remark || '—'}
                          </TableCell>
                          <TableCell>{row.operator || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {row.createdAt ? formatDateTime(row.createdAt) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {canEdit && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">新标准</Label>
                  <Badge variant="secondary">
                    固定月薪 {formatCurrency(nextFixed)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>生效日 *</Label>
                    <Input
                      type="date"
                      value={form.effectiveDate}
                      onChange={(e) => setForm({
                        ...form,
                        effectiveDate: e.target.value,
                      })}
                    />
                    {latestOpenStart && form.effectiveDate && form.effectiveDate < latestOpenStart && (
                      <p className="text-[11px] text-amber-700">
                        早于当前段 {latestOpenStart}，保存后将覆盖该日及之后薪酬段
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>说明</Label>
                    <Input
                      value={form.remark}
                      onChange={(e) => setForm({ ...form, remark: e.target.value })}
                      placeholder="如：转正"
                    />
                  </div>
                  <div
                    id={FOCUS_FIELD_IDS.baseSalary}
                    className={`space-y-1.5 rounded-md p-1 ${focusField === 'baseSalary' ? 'ring-2 ring-sky-400' : ''}`}
                  >
                    <Label>底薪 (¥)</Label>
                    <Input
                      type="number"
                      value={form.salary.baseSalary}
                      onChange={(e) => updateSalary('baseSalary', Number(e.target.value))}
                    />
                  </div>
                  <div
                    id={FOCUS_FIELD_IDS.confidentialityFee}
                    className={`space-y-1.5 rounded-md p-1 ${focusField === 'confidentialityFee' ? 'ring-2 ring-sky-400' : ''}`}
                  >
                    <Label>保密费 (¥)</Label>
                    <Input
                      type="number"
                      value={form.salary.confidentialityFee ?? 0}
                      onChange={(e) => updateSalary(
                        'confidentialityFee',
                        Number(e.target.value),
                      )}
                    />
                  </div>
                  <div
                    id={FOCUS_FIELD_IDS.performance}
                    className={`space-y-1.5 rounded-md p-1 ${focusField === 'performance' ? 'ring-2 ring-sky-400' : ''}`}
                  >
                    <Label>绩效 (¥)</Label>
                    <Input
                      type="number"
                      value={form.salary.performance}
                      onChange={(e) => updateSalary(
                        'performance',
                        Number(e.target.value),
                      )}
                    />
                  </div>
                  <div
                    id={FOCUS_FIELD_IDS.positionAllowance}
                    className={`space-y-1.5 rounded-md p-1 ${focusField === 'positionAllowance' ? 'ring-2 ring-sky-400' : ''}`}
                  >
                    <Label>岗位补贴 (¥)</Label>
                    <Input
                      type="number"
                      value={form.salary.positionAllowance}
                      onChange={(e) => updateSalary(
                        'positionAllowance',
                        Number(e.target.value),
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>社保 · 企业 (¥/月)</Label>
                    <Input
                      type="number"
                      value={form.socialInsurance}
                      onChange={(e) => setForm({
                        ...form,
                        socialInsurance: Number(e.target.value),
                      })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>社保 · 个人 (¥/月)</Label>
                    <Input
                      type="number"
                      value={form.socialInsurancePersonal}
                      onChange={(e) => setForm({
                        ...form,
                        socialInsurancePersonal: Number(e.target.value),
                      })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>公积金 · 企业 (¥/月)</Label>
                    <Input
                      type="number"
                      value={form.housingFund}
                      onChange={(e) => setForm({
                        ...form,
                        housingFund: Number(e.target.value),
                      })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>公积金 · 个人 (¥/月)</Label>
                    <Input
                      type="number"
                      value={form.housingFundPersonal}
                      onChange={(e) => setForm({
                        ...form,
                        housingFundPersonal: Number(e.target.value),
                      })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          {canEdit && person && isInternalEmployeePerson(person) && (
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? '保存中…' : '确认调整'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
