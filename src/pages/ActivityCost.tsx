import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useData } from '@/context/DataContext'
import { usePermissions } from '@/hooks/usePermissions'
import {
  activityCostRulesApi,
  type ActivityCostRulePayload,
} from '@/lib/api'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import {
  normalizeActivityName,
  isBlankActivity,
  normalizeRuleDate,
} from '@/lib/activityCost'

type FormState = {
  activityName: string
  costType: 'fixed' | 'percentage'
  costValue: string
  startDate: string
  endDate: string
}

const emptyForm: FormState = {
  activityName: '',
  costType: 'fixed',
  costValue: '',
  startDate: '',
  endDate: '',
}

function formatRulePeriod(startDate?: string, endDate?: string): string {
  const start = normalizeRuleDate(startDate)
  const end = normalizeRuleDate(endDate)
  if (!start && !end) return '未设有效期'
  if (start && end) return `${formatDate(start)} ~ ${formatDate(end)}`
  if (start) return `${formatDate(start)} 起`
  return `至 ${formatDate(end)}`
}

export default function ActivityCost() {
  const { salesRecords } = useData()
  const { canEdit, canView } = usePermissions()
  const canEditPage = canEdit('activity_cost')
  const canViewPage = canView('activity_cost') || canEditPage

  const [rules, setRules] = useState<ActivityCostRulePayload[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState('')

  const activityOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of salesRecords || []) {
      const name = normalizeActivityName(s.activityName)
      if (!isBlankActivity(name)) set.add(name)
    }
    for (const r of rules) {
      const name = normalizeActivityName(r.activityName)
      if (!isBlankActivity(name)) set.add(name)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [salesRecords, rules])

  async function loadRules() {
    setLoading(true)
    try {
      const res = await activityCostRulesApi.list()
      setRules(Array.isArray(res?.rules) ? res.rules : [])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canViewPage) void loadRules()
  }, [canViewPage])

  function openAdd() {
    setEditingName(null)
    setForm(emptyForm)
    setError('')
    setDialogOpen(true)
  }

  function openEdit(rule: ActivityCostRulePayload) {
    setEditingName(rule.activityName)
    setForm({
      activityName: rule.activityName,
      costType: rule.costType,
      costValue: String(rule.costValue ?? ''),
      startDate: normalizeRuleDate(rule.startDate),
      endDate: normalizeRuleDate(rule.endDate),
    })
    setError('')
    setDialogOpen(true)
  }

  async function handleSave() {
    const activityName = normalizeActivityName(form.activityName)
    if (isBlankActivity(activityName)) {
      setError('请填写活动名称')
      return
    }
    const costValue = Number(form.costValue)
    if (!Number.isFinite(costValue) || costValue < 0) {
      setError('扣除值须为 ≥ 0 的数字')
      return
    }
    if (form.costType === 'percentage' && costValue > 100) {
      setError('比例不能超过 100%')
      return
    }
    const startDate = normalizeRuleDate(form.startDate)
    const endDate = normalizeRuleDate(form.endDate)
    if (!startDate || !endDate) {
      setError('请填写活动起止日期')
      return
    }
    if (startDate > endDate) {
      setError('开始日期不能晚于结束日期')
      return
    }
    setSaving(true)
    setError('')
    try {
      await activityCostRulesApi.save({
        activityName,
        costType: form.costType,
        costValue,
        startDate,
        endDate,
      })
      setDialogOpen(false)
      await loadRules()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '保存失败'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(activityName: string) {
    if (!window.confirm(`删除活动「${activityName}」的默认成本规则？\n已有订单不受影响。`)) {
      return
    }
    try {
      await activityCostRulesApi.remove(activityName)
      await loadRules()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '删除失败'
      window.alert(msg)
    }
  }

  if (!canViewPage) {
    return (
      <div className="p-6 text-sm text-muted-foreground">无活动成本查看权限</div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="活动成本"
        description="按活动名配置默认成本扣除与有效期。成交日落在起止日内的新建/新同步订单自动套用；过期后不再自动扣，仍可在销售记录里本单手工扣除。老单不回刷。"
      />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {loading ? '加载中…' : `共 ${rules.length} 条规则`}
            </p>
            {canEditPage && (
              <Button type="button" onClick={openAdd}>
                <Plus className="mr-1 h-4 w-4" />
                新增规则
              </Button>
            )}
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>活动名称</TableHead>
                  <TableHead>活动时间</TableHead>
                  <TableHead>扣除方式</TableHead>
                  <TableHead className="text-right">扣除值</TableHead>
                  <TableHead>最近修改</TableHead>
                  {canEditPage && <TableHead className="w-[120px]">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canEditPage ? 6 : 5}
                      className="h-24 text-center text-muted-foreground"
                    >
                      暂无规则。生态圈带来的活动可在此配置一次，有效期内新单自动按此扣除。
                    </TableCell>
                  </TableRow>
                ) : (
                  rules.map((rule) => (
                    <TableRow key={rule.activityName}>
                      <TableCell className="font-medium max-w-[220px]">
                        <span className="line-clamp-2" title={rule.activityName}>
                          {rule.activityName}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums whitespace-nowrap">
                        {formatRulePeriod(rule.startDate, rule.endDate)}
                      </TableCell>
                      <TableCell>
                        {rule.costType === 'percentage' ? '按实收比例' : '固定金额'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rule.costType === 'percentage'
                          ? `${Number(rule.costValue) || 0}%`
                          : formatCurrency(rule.costValue)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rule.audit?.updatedBy || '—'}
                        {rule.audit?.updatedAt
                          ? ` · ${formatDateTime(rule.audit.updatedAt)}`
                          : ''}
                      </TableCell>
                      {canEditPage && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(rule)}
                              title="编辑"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleDelete(rule.activityName)}
                              title="删除"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingName ? '编辑活动成本' : '新增活动成本'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>活动名称</Label>
              {editingName ? (
                <Input value={form.activityName} disabled />
              ) : (
                <>
                  <Input
                    list="activity-cost-name-options"
                    value={form.activityName}
                    onChange={(e) =>
                      setForm({ ...form, activityName: e.target.value })
                    }
                    placeholder="输入或选择活动名"
                  />
                  <datalist id="activity-cost-name-options">
                    {activityOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label>扣除方式</Label>
              <Select
                value={form.costType}
                onValueChange={(v: 'fixed' | 'percentage') =>
                  setForm({ ...form, costType: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">固定金额（¥）</SelectItem>
                  <SelectItem value="percentage">按实收比例（%）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                {form.costType === 'percentage' ? '比例 (%)' : '金额 (¥)'}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.costValue}
                onChange={(e) => setForm({ ...form, costValue: e.target.value })}
                placeholder={form.costType === 'percentage' ? '如 10' : '如 500'}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>开始日期</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>结束日期</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              仅成交日落在起止日内的新单自动套用；过期后可在销售记录本单手工扣除。已有订单不回刷。
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              取消
            </Button>
            <Button type="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
