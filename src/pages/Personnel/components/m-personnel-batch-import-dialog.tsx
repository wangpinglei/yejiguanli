import { useMemo, useRef, useState } from 'react'
import { Download, FileUp, Loader2, Upload } from 'lucide-react'

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
  downloadPersonnelImportTemplateXlsx,
  parsePersonnelBatchImportFile,
  parsePersonnelBatchImportMatrix,
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
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [fileLabel, setFileLabel] = useState('')
  const [rows, setRows] = useState<PersonnelBatchImportRow[]>([])
  const [step, setStep] = useState<'paste' | 'preview'>('paste')
  const [importing, setImporting] = useState(false)
  const [parsing, setParsing] = useState(false)

  const stats = useMemo(() => {
    const selected = rows.filter((r) => r.selected)
    return {
      total: rows.length,
      selected: selected.length,
      noUnit: rows.filter((r) => !r.unitMatched).length,
      exists: rows.filter((r) => r.alreadyExists).length,
    }
  }, [rows])

  function applyParsed(parsed: PersonnelBatchImportRow[]) {
    if (parsed.length === 0) {
      alert(
        '未识别到有效人员行。\n'
        + '请使用表头：销售单位、姓名、岗位；\n'
        + '或四列：单位、负责人、岗位、姓名（合并单元格的单位会自动向下填充）。',
      )
      return
    }
    setRows(parsed)
    setStep('preview')
  }

  function handleParseText() {
    const parsed = parsePersonnelBatchImportText(text, units, personnel)
    applyParsed(parsed)
  }

  async function handlePickFile(file: File | null) {
    if (!file) return
    setParsing(true)
    setFileLabel(file.name)
    try {
      const matrix = await parsePersonnelBatchImportFile(file)
      const parsed = parsePersonnelBatchImportMatrix(matrix, units, personnel)
      setText('')
      applyParsed(parsed)
    } catch (err) {
      alert(err instanceof Error ? err.message : '读取表格失败')
    } finally {
      setParsing(false)
    }
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

  const selectable = rows.filter((r) => r.unitMatched && !r.alreadyExists)
  const allSelected = selectable.length > 0 && selectable.every((r) => r.selected)

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
      setText('')
      setFileLabel('')
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
          <DialogTitle>表格导入人员</DialogTitle>
          <DialogDescription>
            上传 <strong>.xlsx / .xls</strong> 或粘贴 Excel 区域。自动识别列：
            <strong>销售单位、姓名、岗位</strong>。
            若表格为「单位｜负责人｜岗位｜姓名」四列，或单位列有合并单元格，也会按行解析。
            单位名须与系统中销售单位完全一致。
          </DialogDescription>
        </DialogHeader>

        {step === 'paste' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={parsing}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {parsing ? '读取中…' : '选择 Excel 表格'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => downloadPersonnelImportTemplateXlsx()}>
                <Download className="mr-2 h-4 w-4" />
                下载模板
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  void handlePickFile(f || null)
                  e.target.value = ''
                }}
              />
            </div>
            {fileLabel && (
              <p className="text-sm text-muted-foreground">已选文件：{fileLabel}</p>
            )}
            <p className="text-xs text-muted-foreground">或在下方粘贴（含表头，制表符分隔）：</p>
            <Textarea
              className="min-h-[180px] font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={personnelBatchImportTemplateTsv()}
            />
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
                      checked={allSelected}
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
            <Button type="button" disabled={!text.trim() || parsing} onClick={handleParseText}>
              解析粘贴内容
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