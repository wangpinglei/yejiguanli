/**
 * 人员批量导入：从 Excel 粘贴（制表符/逗号），列：销售单位、姓名、岗位
 */
import type { Personnel, SalesUnit } from '@/types'

export type PersonnelBatchImportRow = {
  unitName: string
  name: string
  position: string
  matchedUnitId: string
  unitMatched: boolean
  /** 系统中同单位已有同名 */
  alreadyExists: boolean
  selected: boolean
}

const FIELD_ALIASES: Record<'unitName' | 'name' | 'position', string[]> = {
  unitName: ['销售单位', '单位', '分仓', 'unit', 'salesunit', 'sales_unit'],
  name: ['姓名', '销售人员', '员工', 'name', 'person'],
  position: ['岗位', '职位', '职务', 'position', 'title', '角色'],
}

function normalizeHeaderCell(raw: string): string {
  return (raw || '').replace(/\s/g, '').toLowerCase()
}

function mapHeaders(headerRow: string[]): Partial<Record<'unitName' | 'name' | 'position', number>> {
  const map: Partial<Record<'unitName' | 'name' | 'position', number>> = {}
  headerRow.forEach((cell, index) => {
    const key = normalizeHeaderCell(cell)
    if (!key) return
    for (const field of Object.keys(FIELD_ALIASES) as Array<keyof typeof FIELD_ALIASES>) {
      if (FIELD_ALIASES[field].some((a) => key === normalizeHeaderCell(a) || key.includes(normalizeHeaderCell(a)))) {
        map[field] = index
      }
    }
  })
  return map
}

function textToMatrix(text: string): string[][] {
  const cleaned = text.replace(/^\ufeff/, '').trim()
  if (!cleaned) return []
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const sampleLine = lines[0]
  const delimiter = sampleLine.includes('\t')
    ? '\t'
    : (sampleLine.split(',').length >= sampleLine.split('，').length ? ',' : '，')
  return lines.map((line) => line.split(delimiter).map((c) => c.trim()))
}

function findUnitByName(units: SalesUnit[], name: string): SalesUnit | undefined {
  const q = (name || '').trim().toLowerCase()
  if (!q) return undefined
  return units.find((u) => (u.name || '').trim().toLowerCase() === q)
}

function personExists(
  personnel: Personnel[],
  unitId: string,
  name: string,
): boolean {
  const q = (name || '').trim().toLowerCase()
  if (!q || !unitId) return false
  return personnel.some(
    (p) =>
      p.salesUnitId === unitId
      && (p.name || '').trim().toLowerCase() === q,
  )
}

/**
 * 解析粘贴内容。无表头时按固定列序：销售单位、姓名、岗位（第 4 列起忽略）。
 * 销售单位可留空：沿用上一行的单位（适配合并单元格粘贴）。
 */
export function parsePersonnelBatchImportText(
  text: string,
  units: SalesUnit[],
  personnel: Personnel[],
): PersonnelBatchImportRow[] {
  const matrix = textToMatrix(text)
  if (matrix.length === 0) return []

  const firstRow = matrix[0]
  const headerMap = mapHeaders(firstRow)
  const hasHeader = Boolean(headerMap.name && (headerMap.unitName || headerMap.position))

  const dataRows = hasHeader ? matrix.slice(1) : matrix
  const unitCol = headerMap.unitName ?? 0
  // 无表头：三列「单位、姓名、岗位」；四列及以上时常见「单位、负责人、岗位、姓名」→ 姓名取最后一列
  const nameCol = headerMap.name ?? (hasHeader ? 1 : (matrix[0]?.length >= 4 ? 3 : 1))
  const posCol = headerMap.position ?? (hasHeader ? 2 : (matrix[0]?.length >= 4 ? 2 : 2))

  const result: PersonnelBatchImportRow[] = []
  let carryUnit = ''

  for (const row of dataRows) {
    const rawUnit = (row[unitCol] || '').trim()
    if (rawUnit) carryUnit = rawUnit
    const unitName = carryUnit
    let name = (row[nameCol] || '').trim()
    let position = (row[posCol] || '').trim()
    // 合并单元格粘贴：岗位/姓名可能错位，末列像姓名则采用
    if (!name && row.length >= 3) {
      const last = (row[row.length - 1] || '').trim()
      const prev = (row[row.length - 2] || '').trim()
      if (last && last.length <= 8 && !last.includes('顾问') && !last.includes('工程师')) {
        name = last
        if (!position && prev) position = prev
      }
    }
    if (!name) continue
    // 表里没有岗位列时，姓名误贴在岗位列的兜底
    if (!position && !hasHeader && row.length === 2) {
      // 仅两列：单位、姓名
      position = '销售'
    }
    if (!position) position = '销售'

    const unit = findUnitByName(units, unitName)
    const matchedUnitId = unit?.id || ''
    const alreadyExists = matchedUnitId
      ? personExists(personnel, matchedUnitId, name)
      : false

    result.push({
      unitName,
      name,
      position,
      matchedUnitId,
      unitMatched: Boolean(unit),
      alreadyExists,
      selected: Boolean(unit) && !alreadyExists,
    })
  }
  return result
}

export function personnelBatchImportTemplateTsv(): string {
  return [
    '销售单位\t姓名\t岗位',
    '西安分仓\t李春莲\t分仓负责人',
    '西安分仓\t陈鑫\t销售顾问',
    '西安分仓\t杨德\t销售顾问',
    '西安分仓\t王浩栋\t销售顾问',
    '西安分仓\t雷河玲\t销售顾问',
    '西安分仓\t卢大洋\t分仓负责人',
    '西安分仓\t卢梅\t售前售后工程师',
  ].join('\n')
}