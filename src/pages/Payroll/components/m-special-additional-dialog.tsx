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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { formatCurrency, formatDateTime } from '@/lib/format'
import {
  createEmptySpecialAdditional,
  loadTaxProfile,
  resolveSpecialAdditionalMonthly,
  type PersonnelTaxProfile,
  type TaxProfileChangeLog,
} from '@/lib/payrollTax'
import type { Personnel } from '@/types'

type Mode = 'single' | 'batch' | 'history'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: Mode
  person: Personnel | null
  people: Personnel[]
  onAdjusted?: (personnelIds: string[]) => void
}

export default function MSpecialAdditionalDialog({
  open,
  onOpenChange,
  mode,
  person,
  people,
  onAdjusted,
}: Props) {
  const { updatePersonnel } = useData()
  const { user } = useAuth()
  const [amount, setAmount] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === 'single' && person) {
      const profile = loadTaxProfile(
        person.id,
        {
          socialInsurance: person.socialInsurance,
          housingFund: person.housingFund,
        },
        person.taxProfile as Partial<PersonnelTaxProfile> | undefined,
      )
      setAmount(resolveSpecialAdditionalMonthly(profile))
    } else if (mode === 'batch') {
      setAmount(0)
    }
  }, [open, mode, person])

  const targets = mode === 'single'
    ? (person ? [person] : [])
    : people

  const logs: TaxProfileChangeLog[] = mode === 'history' && person
    ? ([...(person.taxProfile?.specialAdditionalLogs || [])] as TaxProfileChangeLog[])
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    : []

  const title = mode === 'history'
    ? `专项附加修改记录${person ? ` · ${person.name}` : ''}`
    : mode === 'single'
      ? `调整专项附加${person ? ` · ${person.name}` : ''}`
      : `批量调整专项附加（${targets.length} 人）`

  async function handleSubmit() {
    if (targets.length === 0) {
      alert('没有可调整的人员')
      return
    }
    const nextAmount = Number(amount) || 0
    const confirmText = mode === 'single'
      ? `确认将「${targets[0].name}」专项附加月额设为 ${formatCurrency(nextAmount)}？\n将写入个税扣除档案并记修改记录。`
      : `确认对当前列表 ${targets.length} 人统一将专项附加月额设为 ${formatCurrency(nextAmount)}？\n将写入各人个税扣除档案并记修改记录。`
    if (!confirm(confirmText)) return

    setSaving(true)
    const ids: string[] = []
    const errors: string[] = []
    const now = new Date().toISOString()
    const operator = user?.name || user?.username || '未知'
    const operatorId = user?.id || ''
    try {
      for (const p of targets) {
        try {
          const prev = loadTaxProfile(
            p.id,
            {
              socialInsurance: p.socialInsurance,
              housingFund: p.housingFund,
            },
            p.taxProfile as Partial<PersonnelTaxProfile> | undefined,
          )
          const log: TaxProfileChangeLog = {
            at: now,
            operator,
            operatorId,
            amount: nextAmount,
            remark: mode === 'batch' ? '批量调整专项附加' : '调整专项附加',
          }
          const nextLogs = [log, ...(prev.specialAdditionalLogs || [])].slice(0, 50)
          const profile: PersonnelTaxProfile = {
            ...prev,
            personnelId: p.id,
            special: prev.special || createEmptySpecialAdditional(),
            specialAdditionalOverride: nextAmount,
            specialAdditionalLogs: nextLogs,
            updatedAt: now,
          }
          await updatePersonnel(p.id, { taxProfile: profile })
          ids.push(p.id)
        } catch (e: unknown) {
          errors.push(`${p.name}: ${e instanceof Error ? e.message : '失败'}`)
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
      <DialogContent className={mode === 'history' ? 'max-w-lg' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {mode === 'history' ? (
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            {logs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">暂无调整记录</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead className="text-right">专项附加月额</TableHead>
                    <TableHead>操作人</TableHead>
                    <TableHead>说明</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((row, idx) => (
                    <TableRow key={`${row.at}-${idx}`}>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.at ? formatDateTime(row.at) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.amount)}
                      </TableCell>
                      <TableCell>{row.operator || '—'}</TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {row.remark || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              保存后覆盖该人员个税档案中的专项附加月额（优先于勾选项合计），
              之后月份工资核算默认用新值，并写入修改记录。
            </p>
            <div className="space-y-1.5">
              <Label>专项附加 (¥/月)</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {mode === 'history' ? '关闭' : '取消'}
          </Button>
          {mode !== 'history' && (
            <Button disabled={saving} onClick={() => void handleSubmit()}>
              {saving ? '保存中…' : '确认调整'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
