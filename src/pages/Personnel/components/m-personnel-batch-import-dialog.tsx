import { useMemo, useState } from 'react'
import { FileUp, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useData } from '@/context/DataContext'
import { EMPTY_SALARY } from '@/lib/salary'
import {
  parsePersonnelBatchImportText,
  personnelBatchImportTemplateTsv,
  type PersonnelBatchImportRow,
} from '@/lib/personnelBatchImport'
import type { Personnel, SalesUnit } from '@/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  units: SalesUnit[]
  personnel: Personnel[]
}

export default function MPersonnelBatchImportDialog({
  open,
  onOpenChange,
  units,
  personnel,
}: Props) {
  const { addPersonnel } = useData()
  const [text, setText] = useState(() => personnelBatchImportTemplateTsv())
  const [rows, setRows] = useState<PersonnelBatchImportRow[]>([])
  const [step, setStep] = useState<'paste' | 'preview'>('paste')
  const [importing, setImporting] = useState(false)

  const stats = useMemo(() => {
    const selected = rows.filter((r) => r.selected)
    return {
      total: rows.length,
      selected: selected.length,
      noUnit: rows.filter((r) => !r.unitMatched).length,
      exists: rows.filter((r) => r.alreadyExists).length,
    }
  }, [rows])

  function handleParse() {
    const parsed = parsePersonnelBatchImportText(text, units, personnel)
    if (parsed.length === 0) {
      alert('未解析到有效行。请包含表头：销售单位、姓名、岗位（或仅三列：单位、姓名、岗位）')
      return
    }
    setRows(parsed)
    setStep('preview')
  }

  function toggleRow(index: number) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r)),
    )
  }

  function toggleAll(checked: boolean) {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        selected: checked && r.unitMatched && !r.alreadyExists,
      })),
    )
  }

  async function handleImport() {
    const targets = rows.filter((r) => r.selected && r.unitMatched && !r.alreadyExists)
    if (targets.length === 0) {
      alert('没有可导入的行（请勾选、且单位须已存在、且非重复）')
      return
    }
    setImporting(true)
    let ok = 0
    let fail = 0
  const errors: string[] = []
    for (const row of targets) {
      try {
        await addPersonnel({
          name: row.name,
          salesUnitId: row.matchedUnitId,
          position: row.position,
          phone: '',
          email: '',
          salary: { ...EMPTY_SALARY },
          socialInsurance: 0,
          housingFund: 0,
          hireDate: new Date().toISOString().slice(0, 10),
          status: 'active',
          isInternalEmployee: !String(row.position).includes('分销'),
        })
        ok++
      } catch (err) {
        fail++
        errors.push(`${row.unitName} ${row.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setImporting(false)
    alert(
      `批量导入完成：成功 ${ok} 人${fail > 0 ? `，失败 ${fail} 人` : ''}`
      + (errors.length ? `\n${errors.slice(0, 5).join('\n')}` : ''),
    )
    if (ok > 0) {
      onOpenChange(false)
      setStep('paste')
    }
  }

  function handleClose(next: boolean) {
    if (!next) {
      setStep('paste')
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量导入人员</DialogTitle>
          <DialogDescription>
            从 Excel 复制三列粘贴：<strong>销售单位、姓名、岗位</strong>。单位名称须与系统中一致；
            合并单元格粘贴时可只填首行单位，下面行留空会自动沿用。已存在同单位同名会标记为跳过。
          </DialogDescription>
        </DialogHeader>

        {step === 'paste' ? (
          <div className="space-y-3">
            <Textarea
              className="min-h-[220px] font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={personnelBatchImportTemplateTsv()}
            />
            <p className="text-xs text-muted-foreground">
              下图西安分仓名单已预填在文本框，确认单位名为「西安分仓」后可点「解析预览」。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>共 {stats.total} 行</span>
              <span>待导入 {stats.selected}</span>
              {stats.noUnit > 0 && (
                <span className="text-amber-700">单位未匹配 {stats.noUnit}</span>
              )}
              {stats.exists > 0 && (
                <span className="text-sky-700">已存在 {stats.exists}</span>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={rows.every((r) => !r.selected ? false : true) && rows.some((r) => r.selected)}
                      onCheckedChange={(v) => toggleAll(v === true)}
                    />
                  </TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>岗位</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={`${row.unitName}-${row.name}-${index}`}>
                    <TableCell>
                      <Checkbox
                        checked={row.selected}
                        disabled={!row.unitMatched || row.alreadyExists}
                        onCheckedChange={() => toggleRow(index)}
                      />
                    </TableCell>
                    <TableCell>{row.unitName || '—'}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.position}</TableCell>
                    <TableCell className="text-xs">
                      {!row.unitMatched && <span className="text-amber-700">单位未建</span>}
                      {row.unitMatched && row.alreadyExists && (
                        <span className="text-muted-foreground">已存在</span>
                      )}
                      {row.unitMatched && !row.alreadyExists && (
                        <span className="text-green-700">可导入</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 'preview' && (
            <Button type="button" variant="outline" onClick={() => setStep('paste')}>
              返回修改
            </Button>
          )}
          {step === 'paste' ? (
            <Button type="button" onClick={handleParse}>
              解析预览
            </Button>
          ) : (
            <Button type="button" disabled={importing || stats.selected === 0} onClick={() => void handleImport()}>
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  导入中…
                </>
              ) : (
                <>
                  <FileUp className="mr-2 h-4 w-4" />
                  导入 {stats.selected} 人
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}