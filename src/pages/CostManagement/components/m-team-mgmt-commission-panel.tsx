import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import { usePermissions } from '@/hooks/usePermissions'
import { formatCurrency } from '@/lib/format'
import {
  DEFAULT_TEAM_MGMT_TIERS,
  calcUnitTeamMgmtCommission,
} from '@/lib/teamMgmtCommission'
import type {
  TeamMgmtCommissionManager,
  TeamMgmtCommissionTier,
} from '@/types'
import {
  Building2, Plus, Trash2, Save, Users, Percent, Calculator, Pencil, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type DraftRule = {
  managers: TeamMgmtCommissionManager[]
  tiers: TeamMgmtCommissionTier[]
  note: string
}

function cloneDefaultDraft(): DraftRule {
  return {
    managers: [],
    tiers: DEFAULT_TEAM_MGMT_TIERS.map((t) => ({ ...t })),
    note: '',
  }
}

type Props = {
  selectedMonth: string
}

export default function MTeamMgmtCommissionPanel({ selectedMonth }: Props) {
  const {
    personnel,
    allSalesRecords: salesRecords,
    teamMgmtCommissionRules,
    performanceTargets,
    unitProductSettlements,
    upsertTeamMgmtCommissionRule,
    deleteTeamMgmtCommissionRule,
  } = useData()
  const { visibleSalesUnits: units, canEditCost, isReadOnly } = usePermissions()
  const canEdit = canEditCost && !isReadOnly

  const [activeUnitId, setActiveUnitId] = useState<string>(() => units[0]?.id || '')
  const [draft, setDraft] = useState<DraftRule>(cloneDefaultDraft())
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  /** 仅编辑态展开管理人员/档位配置；默认折叠只看预览 */
  const [isEditing, setIsEditing] = useState(false)

  const unitPeople = useMemo(
    () => personnel.filter((p) => p.salesUnitId === activeUnitId && p.status === 'active'),
    [personnel, activeUnitId],
  )

  const existingRule = useMemo(
    () => teamMgmtCommissionRules.find((r) => r.salesUnitId === activeUnitId),
    [teamMgmtCommissionRules, activeUnitId],
  )

  function loadUnit(unitId: string) {
    setActiveUnitId(unitId)
    const rule = teamMgmtCommissionRules.find((r) => r.salesUnitId === unitId)
    if (rule) {
      setDraft({
        managers: rule.managers.map((m) => ({ ...m })),
        tiers: (rule.tiers?.length ? rule.tiers : DEFAULT_TEAM_MGMT_TIERS).map((t) => ({ ...t })),
        note: rule.note || '',
      })
    } else {
      setDraft(cloneDefaultDraft())
    }
    setDirty(false)
    setIsEditing(false)
  }

  function handleCancelEdit() {
    if (dirty && !confirm('有未保存修改，取消编辑将丢弃，是否继续？')) return
    if (existingRule) {
      setDraft({
        managers: existingRule.managers.map((m) => ({ ...m })),
        tiers: (existingRule.tiers?.length
          ? existingRule.tiers
          : DEFAULT_TEAM_MGMT_TIERS
        ).map((t) => ({ ...t })),
        note: existingRule.note || '',
      })
    } else {
      setDraft(cloneDefaultDraft())
    }
    setDirty(false)
    setIsEditing(false)
  }

  useEffect(() => {
    if (!units.length) return
    if (!activeUnitId || !units.some((u) => u.id === activeUnitId)) {
      loadUnit(units[0].id)
      return
    }
    if (dirty) return
    const rule = teamMgmtCommissionRules.find((r) => r.salesUnitId === activeUnitId)
    if (rule) {
      setDraft({
        managers: rule.managers.map((m) => ({ ...m })),
        tiers: (rule.tiers?.length ? rule.tiers : DEFAULT_TEAM_MGMT_TIERS).map((t) => ({ ...t })),
        note: rule.note || '',
      })
    } else {
      setDraft(cloneDefaultDraft())
    }
  // 仅在外部规则/单位列表变化时同步；编辑中不覆盖
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, teamMgmtCommissionRules, activeUnitId])

  const preview = useMemo(() => {
    if (!activeUnitId) return null
    const ruleForCalc = {
      id: existingRule?.id || '',
      salesUnitId: activeUnitId,
      managers: draft.managers,
      tiers: draft.tiers,
      note: draft.note,
      createdAt: existingRule?.createdAt || '',
    }
    return calcUnitTeamMgmtCommission(
      activeUnitId,
      selectedMonth,
      salesRecords,
      unitProductSettlements,
      performanceTargets,
      ruleForCalc,
    )
  }, [
    activeUnitId, selectedMonth, salesRecords, unitProductSettlements,
    performanceTargets, draft, existingRule,
  ])

  function updateDraft(next: Partial<DraftRule>) {
    setDraft((prev) => ({ ...prev, ...next }))
    setDirty(true)
  }

  function handleAddManager() {
    const used = new Set(draft.managers.map((m) => m.personnelId))
    const nextPerson = unitPeople.find((p) => !used.has(p.id))
    if (!nextPerson) {
      alert('该单位已无可添加的在职人员')
      return
    }
    updateDraft({
      managers: [...draft.managers, { personnelId: nextPerson.id, weight: 1 }],
    })
  }

  function handleSave() {
    if (!activeUnitId) return
    const managers = draft.managers.filter((m) => m.personnelId && m.weight > 0)
    if (managers.length === 0) {
      alert('请至少添加一名管理人员并设置权重 > 0')
      return
    }
    const tiers = draft.tiers
      .filter((t) => t.minCompletionPercent >= 0)
      .sort((a, b) => a.minCompletionPercent - b.minCompletionPercent)
    if (tiers.length === 0) {
      alert('请至少配置一档完成率提成')
      return
    }
    setSaving(true)
    upsertTeamMgmtCommissionRule({
      salesUnitId: activeUnitId,
      managers,
      tiers,
      note: draft.note,
    })
      .then(() => {
        setDirty(false)
        setIsEditing(false)
      })
      .catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : '未知错误'
        alert('保存失败: ' + msg)
      })
      .finally(() => setSaving(false))
  }

  async function handleClear() {
    if (!existingRule?.id) {
      setDraft(cloneDefaultDraft())
      setDirty(false)
      setIsEditing(false)
      return
    }
    if (!confirm('确定清除该单位的团队管理提成规则？')) return
    try {
      await deleteTeamMgmtCommissionRule(existingRule.id)
      setDraft(cloneDefaultDraft())
      setDirty(false)
      setIsEditing(false)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('清除失败: ' + msg)
    }
  }

  const totalWeight = draft.managers.reduce((s, m) => s + (m.weight || 0), 0)

  const managerSummary = draft.managers.length === 0
    ? '尚未配置管理人员'
    : draft.managers
      .map((m) => {
        const name = personnel.find((p) => p.id === m.personnelId)?.name || '未知'
        return `${name}(权重${m.weight})`
      })
      .join('、')

  const tierSummary = draft.tiers
    .map((t) => `≥${t.minCompletionPercent}%→${t.commissionRatePercent}%`)
    .join('；')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-emerald-900">团队管理提成</h3>
            <p className="text-xs text-muted-foreground">
              按单位实收（可排除产品）÷ 人员月目标合计算完成率，匹配档位后形成提成池，再按管理人员权重分摊
            </p>
          </div>
        </div>
        <Badge variant="outline" className="border-emerald-200 text-emerald-700 shrink-0">
          {selectedMonth} 预览
        </Badge>
      </div>

      {units.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-sm text-muted-foreground">
            暂无销售单位，请先在「销售单位」中录入。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <Card>
            <CardContent className="p-2 space-y-1">
              {units.map((u) => {
                const hasRule = teamMgmtCommissionRules.some((r) => r.salesUnitId === u.id)
                const active = u.id === activeUnitId
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-emerald-100 text-emerald-900 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                    onClick={() => {
                      if (dirty && activeUnitId !== u.id) {
                        if (!confirm('当前单位有未保存修改，切换将丢弃，是否继续？')) return
                      }
                      loadUnit(u.id)
                    }}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1">{u.name}</span>
                    {hasRule && (
                      <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0">
                        已配
                      </Badge>
                    )}
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {preview && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calculator className="h-3 w-3" />可计实收
                    </p>
                    <p className="text-base font-semibold text-emerald-700">
                      {formatCurrency(preview.eligibleSales)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">月目标 / 完成率</p>
                    <p className="text-base font-semibold">
                      {preview.targetAmount > 0
                        ? `${formatCurrency(preview.targetAmount)} · ${preview.completionPercent.toFixed(1)}%`
                        : '无目标（池=0）'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Percent className="h-3 w-3" />适用比例
                    </p>
                    <p className="text-base font-semibold text-violet-700">
                      {preview.commissionRatePercent}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">提成池</p>
                    <p className="text-base font-semibold text-amber-700">
                      {formatCurrency(preview.pool)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {!isEditing ? (
              <Card>
                <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5 text-sm">
                    <p>
                      <span className="text-muted-foreground">管理人员：</span>
                      {managerSummary}
                    </p>
                    <p>
                      <span className="text-muted-foreground">完成率档位：</span>
                      {tierSummary || '未配置'}
                    </p>
                    {draft.note ? (
                      <p>
                        <span className="text-muted-foreground">备注：</span>
                        {draft.note}
                      </p>
                    ) : null}
                  </div>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setIsEditing(true)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      编辑规则
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium">管理人员与权重</Label>
                  {canEdit && (
                    <Button type="button" variant="outline" size="sm" onClick={handleAddManager}>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      添加
                    </Button>
                  )}
                </div>
                {draft.managers.length === 0 && (
                  <p className="text-xs text-muted-foreground">尚未添加管理人员</p>
                )}
                <div className="space-y-2">
                  {draft.managers.map((m, idx) => {
                    const person = personnel.find((p) => p.id === m.personnelId)
                    const share = totalWeight > 0 && preview
                      ? preview.pool * (m.weight / totalWeight)
                      : 0
                    return (
                      <div
                        key={`${m.personnelId}-${idx}`}
                        className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-2"
                      >
                        <div className="space-y-1 min-w-[140px] flex-1">
                          <Label className="text-xs">人员</Label>
                          <Select
                            value={m.personnelId}
                            disabled={!canEdit}
                            onValueChange={(v) => {
                              const next = draft.managers.map((x, i) =>
                                i === idx ? { ...x, personnelId: v } : x,
                              )
                              updateDraft({ managers: next })
                            }}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {unitPeople.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}（{p.position}）
                                </SelectItem>
                              ))}
                              {person && !unitPeople.some((p) => p.id === person.id) && (
                                <SelectItem value={person.id}>
                                  {person.name}（已离职/不可见）
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 w-24">
                          <Label className="text-xs">权重</Label>
                          <Input
                            type="number"
                            min={0}
                            step={0.1}
                            disabled={!canEdit}
                            value={m.weight}
                            onChange={(e) => {
                              const next = draft.managers.map((x, i) =>
                                i === idx
                                  ? { ...x, weight: Number(e.target.value) }
                                  : x,
                              )
                              updateDraft({ managers: next })
                            }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground pb-2 w-28">
                          分摊 {formatCurrency(share)}
                        </div>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              updateDraft({
                                managers: draft.managers.filter((_, i) => i !== idx),
                              })
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {totalWeight > 0 && (
                  <p className="text-xs text-muted-foreground">权重合计 {totalWeight}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium">完成率档位（%）</Label>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const last = draft.tiers[draft.tiers.length - 1]
                        updateDraft({
                          tiers: [
                            ...draft.tiers,
                            {
                              minCompletionPercent: (last?.minCompletionPercent || 0) + 20,
                              commissionRatePercent: (last?.commissionRatePercent || 0) + 1,
                            },
                          ],
                        })
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      加档
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  匹配规则：取「完成率 ≥ 档位下限」中的最高档
                </p>
                <div className="space-y-2">
                  {draft.tiers.map((t, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-2"
                    >
                      <div className="space-y-1 w-32">
                        <Label className="text-xs">完成率下限 %</Label>
                        <Input
                          type="number"
                          disabled={!canEdit}
                          value={t.minCompletionPercent}
                          onChange={(e) => {
                            const next = draft.tiers.map((x, i) =>
                              i === idx
                                ? { ...x, minCompletionPercent: Number(e.target.value) }
                                : x,
                            )
                            updateDraft({ tiers: next })
                          }}
                        />
                      </div>
                      <div className="space-y-1 w-32">
                        <Label className="text-xs">提成比例 %</Label>
                        <Input
                          type="number"
                          step={0.1}
                          disabled={!canEdit}
                          value={t.commissionRatePercent}
                          onChange={(e) => {
                            const next = draft.tiers.map((x, i) =>
                              i === idx
                                ? { ...x, commissionRatePercent: Number(e.target.value) }
                                : x,
                            )
                            updateDraft({ tiers: next })
                          }}
                        />
                      </div>
                      {canEdit && draft.tiers.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            updateDraft({
                              tiers: draft.tiers.filter((_, i) => i !== idx),
                            })
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label className="text-xs">备注</Label>
              <Input
                disabled={!canEdit}
                value={draft.note}
                onChange={(e) => updateDraft({ note: e.target.value })}
                placeholder="可选说明"
              />
            </div>

            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={saving} onClick={handleSave}>
                  <Save className="mr-1.5 h-4 w-4" />
                  {saving ? '保存中…' : '保存本单位规则'}
                </Button>
                <Button variant="outline" disabled={saving} onClick={handleCancelEdit}>
                  <X className="mr-1.5 h-4 w-4" />
                  取消编辑
                </Button>
                <Button variant="outline" disabled={saving} onClick={handleClear}>
                  清除规则
                </Button>
                {dirty && (
                  <span className="text-xs text-amber-700 self-center">有未保存修改</span>
                )}
              </div>
            )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
