import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { EMPTY_SALARY, getFixedSalary } from '@/lib/salary'
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

type Props = {
  person: Personnel | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
}

type PayForm = {
  effectiveDate: string
  remark: string
  salary: SalaryStructure
  socialInsurance: number
  housingFund: number
}

function sortPayPlans(list: PersonnelPayPlan[]): PersonnelPayPlan[] {
  return [...list].sort((a, b) =>
    `${a.startDate}${a.createdAt || ''}`.localeCompare(`${b.startDate}${b.createdAt || ''}`),
  )
}

function getDefaultForm(person: Personnel | null): PayForm {
  const nextMonth = new Date()
  nextMonth.setMonth(nextMonth.getMonth() + 1)
  nextMonth.setDate(1)
  const suggested = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`
  return {
    effectiveDate: suggested,
    remark: '转正',
    salary: { ...EMPTY_SALARY, ...(person?.salary || {}) },
    socialInsurance: person?.socialInsurance || 0,
    housingFund: person?.housingFund || 0,
  }
}

export default function MPayPlanDialog({
  person,
  open,
  onOpenChange,
  canEdit,
}: Props) {
  const { adjustPersonnelPay, personnel } = useData()
  const [form, setForm] = useState<PayForm>(() => getDefaultForm(person))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(getDefaultForm(person))
  }, [open, person])

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

  async function handleSubmit() {
    if (!person) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) {
      alert('请填写薪酬生效日')
      return
    }
    if (
      !confirm(
        `确认「${person.name}」自 ${form.effectiveDate} 起使用新薪酬？\n\n`
        + '生效日前（含试用期月份）仍按旧底薪/社保公积金计算；'
        + '从生效日起按新标准。提成仍按成交当月配置。',
      )
    ) {
      return
    }
    setSaving(true)
    try {
      await adjustPersonnelPay(person.id, {
        effectiveDate: form.effectiveDate,
        salary: form.salary,
        socialInsurance: form.socialInsurance,
        housingFund: form.housingFund,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            调整薪酬{person ? ` · ${person.name}` : ''}
          </DialogTitle>
        </DialogHeader>
        {person && (
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              与调岗、分销一样按生效日分段。试用转正请把生效日设为转正月 1 日，
              并改底薪、社保、公积金；9 月成本不会被 10 月新标准覆盖。
            </p>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              当前固定月薪 {formatCurrency(currentFixed)}
              ，社保 {formatCurrency(person.socialInsurance || 0)}
              ，公积金 {formatCurrency(person.housingFund || 0)}
            </div>

            {planRows.length > 0 && (
              <div className="space-y-2">
                <Label>薪酬记录</Label>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>开始日</TableHead>
                        <TableHead>结束日</TableHead>
                        <TableHead className="text-right">固定月薪</TableHead>
                        <TableHead className="text-right">社保</TableHead>
                        <TableHead className="text-right">公积金</TableHead>
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
                            {formatCurrency(row.housingFund)}
                          </TableCell>
                          <TableCell className="max-w-[100px] truncate">
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
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">新标准</Label>
                  <Badge variant="secondary">
                    固定月薪 {formatCurrency(nextFixed)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>生效日 *</Label>
                    <Input
                      type="date"
                      value={form.effectiveDate}
                      onChange={(e) => setForm({
                        ...form,
                        effectiveDate: e.target.value,
                      })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>说明</Label>
                    <Input
                      value={form.remark}
                      onChange={(e) => setForm({ ...form, remark: e.target.value })}
                      placeholder="如：转正"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>底薪 (¥)</Label>
                    <Input
                      type="number"
                      value={form.salary.baseSalary}
                      onChange={(e) => updateSalary('baseSalary', Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
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
                  <div className="space-y-1">
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
                  <div className="space-y-1">
                    <Label>社保 (¥/月)</Label>
                    <Input
                      type="number"
                      value={form.socialInsurance}
                      onChange={(e) => setForm({
                        ...form,
                        socialInsurance: Number(e.target.value),
                      })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>公积金 (¥/月)</Label>
                    <Input
                      type="number"
                      value={form.housingFund}
                      onChange={(e) => setForm({
                        ...form,
                        housingFund: Number(e.target.value),
                      })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          {canEdit && (
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? '保存中…' : '确认调整'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
