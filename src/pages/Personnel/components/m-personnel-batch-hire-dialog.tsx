import { useState } from 'react'
import { CalendarRange, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useData } from '@/context/DataContext'
import { parseHireDateCell } from '@/lib/personnelBatchImport'
import type { Personnel } from '@/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  people: Personnel[]
  scopeLabel: string
}

export default function MPersonnelBatchHireDialog({
  open,
  onOpenChange,
  people,
  scopeLabel,
}: Props) {
  const { updatePersonnel } = useData()
  const [hireDate, setHireDate] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const date = parseHireDateCell(hireDate)
    if (!date) {
      alert('请选择入职日期')
      return
    }
    if (people.length === 0) {
      alert('当前范围内没有人员')
      return
    }
    const ok = window.confirm(
      `将【${scopeLabel}】下 ${people.length} 人的入职日期统一设为 ${date}？\n（仅改入职日，归属与薪酬不变）`,
    )
    if (!ok) return
    setSaving(true)
    let success = 0
    let fail = 0
    for (const p of people) {
      try {
        await updatePersonnel(p.id, { hireDate: date })
        success++
      } catch {
        fail++
      }
    }
    setSaving(false)
    alert(`已更新 ${success} 人${fail > 0 ? `，失败 ${fail} 人` : ''}`)
    if (success > 0) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量设置入职日期</DialogTitle>
          <DialogDescription>
            对当前列表筛选结果生效（{scopeLabel}，共 {people.length} 人）。
            适用于表格导入后入职时间被写成「今天」的批量修正。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="batch-hire-date">入职日期</Label>
          <Input
            id="batch-hire-date"
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={saving || people.length === 0} onClick={() => void handleSave()}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                保存中…
              </>
            ) : (
              <>
                <CalendarRange className="mr-2 h-4 w-4" />
                应用到 {people.length} 人
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}