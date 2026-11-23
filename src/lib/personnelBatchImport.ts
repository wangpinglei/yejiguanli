/**
 * 人员批量导入：Excel / 粘贴表格，识别销售单位、姓名、岗位
 */
import * as XLSX from 'xlsx'
import type { Personnel, SalesUnit } from '@/types'

export type PersonnelBatchImportRow = {
  unitName: string
  name: string
  position: string
  matchedUnitId: string
  unitMatched: boolean
  alreadyExists: boolean
  selected: boolean
}

const FIELD_ALIASES: Record<'unitName' | 'name' | 'position', string[]> = {
  unitName: ['销售单位', '单位', '分仓', '所属单位', 'unit', 'salesunit', 'sales_unit'],
  name: ['姓名', '员工姓名', '销售人员', '员工', 'name', 'person'],
  position: ['岗位', '职位', '职务', '角色', 'position', 'title'],
}

const POSITION_RE =
  /顾问|工程师|负责人|经理|总监|专员|主管|销售|财务|人事|后勤|技术|客服|运营|助理|文员/

function normalizeHeaderCell(raw: string): string {
  return (raw || '').replace(/\s/g, '').toLowerCase()
}

function mapHeaders(headerRow: string[]): Partial<Record<'unitName' | 'name' | 'position', number>> {
  const map: Partial<Record<'unitName' | 'name' | 'position', number>> = {}
  headerRow.forEach((cell, index) => {
    const key = normalizeHeaderCell(cell)
    if (!key) return
    for (const field of Object.keys(FIELD_ALIASES) as Array<keyof typeof FIELD_ALIASES>) {
      const hit = FIELD_ALIASES[field].some(
        (a) => key === normalizeHeaderCell(a) || key.includes(normalizeHeaderCell(a)),
      )
      if (hit && map[field] == null) map[field] = index
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
  return lines.map((line) => line.split(delimiter).map((c) => String(c ?? '').trim()))
}

/** Excel 合并单元格：空单元格沿用上方的值（常见「单位」列） */
export function fillDownEmptyCells(matrix: string[][]): string[][] {
  if (matrix.length === 0) return []
  const colCount = Math.max(...matrix.map((r) => r.length))
  const carry = new Array(colCount).fill('') as string[]
  return matrix.map((row) => {
    const out = new Array(colCount).fill('') as string[]
    for (let i = 0; i < colCount; i++) {
      const v = String(row[i] ?? '').trim()
      if (v) carry[i] = v
      out[i] = v || carry[i]
    }
    return out
  })
}

function looksLikePosition(value: string): boolean {
  const s = (value || '').trim()
  if (!s) return false
  return POSITION_RE.test(s)
}

function looksLikePersonName(value: string): boolean {
  const s = (value || '').trim()
  if (!s) return false
  if (looksLikePosition(s)) return false
  if (/^\d+$/.test(s)) return false
  return s.length >= 2 && s.length <= 8
}

function findUnitByName(units: SalesUnit[], name: string): SalesUnit | undefined {
  const q = (name || '').trim().toLowerCase()
  if (!q) return undefined
  return units.find((u) => (u.name || '').trim().toLowerCase() === q)
}

function personExists(personnel: Personnel[], unitId: string, name: string): boolean {
  const q = (name || '').trim().toLowerCase()
  if (!q || !unitId) return false
  return personnel.some(
    (p) =>
      p.salesUnitId === unitId
      && (p.name || '').trim().toLowerCase() === q,
  )
}

function findHeaderRowIndex(matrix: string[][]): { index: number; map: ReturnType<typeof mapHeaders> } {
  for (let i = 0; i < Math.min(8, matrix.length); i++) {
    const map = mapHeaders(matrix[i])
    if (map.name || (map.unitName && map.position)) {
      return { index: i, map }
    }
  }
  return { index: -1, map: {} }
}

/**
 * 无表头时从一行单元格推断姓名、岗位（支持：单位|姓名|岗位 或 单位|负责人|岗位|姓名）
 */
function inferNameAndPosition(cells: string[]): { name: string; position: string } | null {
  const parts = cells.map((c) => String(c ?? '').trim())
  const nonEmpty = parts.filter(Boolean)
  if (nonEmpty.length < 2) return null

  if (parts.length >= 4) {
    const nameCandidate = (parts[3] || parts[parts.length - 1] || '').trim()
    const posCandidate = (parts[2] || '').trim()
    if (nameCandidate && looksLikePersonName(nameCandidate)) {
      return {
        name: nameCandidate,
        position: posCandidate || (looksLikePosition(parts[1]) ? parts[1] : '销售'),
      }
    }
    const name2 = (parts[1] || '').trim()
    const pos2 = (parts[2] || '').trim()
    if (name2 && looksLikePersonName(name2) && !nameCandidate) {
      return { name: name2, position: pos2 || '销售' }
    }
  }

  if (parts.length >= 3) {
    const a = parts[1]
    const b = parts[2]
    if (looksLikePosition(a) && looksLikePersonName(b)) {
      return { name: b, position: a }
    }
    if (looksLikePersonName(a) && looksLikePosition(b)) {
      return { name: a, position: b }
    }
    if (looksLikePersonName(b)) {
      return { name: b, position: looksLikePosition(a) ? a : '销售' }
    }
    if (looksLikePersonName(a)) {
      return { name: a, position: '销售' }
    }
  }

  if (parts.length >= 2) {
    const name = (parts[parts.length - 1] || '').trim()
    if (looksLikePersonName(name)) {
      const pos = parts.length >= 3 ? parts[parts.length - 2] : '销售'
      return { name, position: looksLikePosition(pos) ? pos : '销售' }
    }
  }
  return null
}

function toImportRow(
  unitName: string,
  name: string,
  position: string,
  units: SalesUnit[],
  personnel: Personnel[],
): PersonnelBatchImportRow {
  const unit = findUnitByName(units, unitName)
  const matchedUnitId = unit?.id || ''
  const alreadyExists = matchedUnitId ? personExists(personnel, matchedUnitId, name) : false
  return {
    unitName,
    name,
    position: (position || '销售').trim() || '销售',
    matchedUnitId,
    unitMatched: Boolean(unit),
    alreadyExists,
    selected: Boolean(unit) && !alreadyExists,
  }
}

export function parsePersonnelBatchImportMatrix(
  rawMatrix: string[][],
  units: SalesUnit[],
  personnel: Personnel[],
): PersonnelBatchImportRow[] {
  const matrix = fillDownEmptyCells(rawMatrix.filter((r) => r.some((c) => String(c ?? '').trim())))
  if (matrix.length === 0) return []

  const { index: headerIndex, map: headerMap } = findHeaderRowIndex(matrix)
  const hasHeader = headerIndex >= 0 && Boolean(headerMap.name)
  const dataRows = hasHeader ? matrix.slice(headerIndex + 1) : matrix

  const unitCol = headerMap.unitName ?? 0
  const nameCol = headerMap.name
  const posCol = headerMap.position

  const result: PersonnelBatchImportRow[] = []
  const seen = new Set<string>()

  for (const row of dataRows) {
    const unitName = (row[unitCol] || '').trim()
    if (!unitName) continue

    let name = ''
    let position = ''

    if (hasHeader && nameCol != null) {
      name = (row[nameCol] || '').trim()
      position =
        posCol != null
          ? (row[posCol] || '').trim()
          : ''
      if (!name && row.length >= 4) {
        const inferred = inferNameAndPosition(row)
        if (inferred) {
          name = inferred.name
          position = position || inferred.position
        }
      }
    } else {
      const inferred = inferNameAndPosition(row)
      if (!inferred) continue
      name = inferred.name
      position = inferred.position
    }

    if (!name || !looksLikePersonName(name)) continue
    if (!position) position = '销售'

    const key = `${unitName.toLowerCase()}|${name}`
    if (seen.has(key)) continue
    seen.add(key)

    result.push(toImportRow(unitName, name, position, units, personnel))
  }
  return result
}

export function parsePersonnelBatchImportText(
  text: string,
  units: SalesUnit[],
  personnel: Personnel[],
): PersonnelBatchImportRow[] {
  return parsePersonnelBatchImportMatrix(textToMatrix(text), units, personnel)
}

export async function parsePersonnelBatchImportFile(
  file: File,
): Promise<string[][]> {
  const buf = await file.arrayBuffer()
  const workbook = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const worksheet = workbook.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  })
  return matrix.map((row) =>
    (row || []).map((cell) => {
      if (cell == null) return ''
      if (typeof cell === 'object' && cell !== null && 'getTime' in cell) {
        return new Date(cell as Date).toISOString().slice(0, 10)
      }
      return String(cell).trim()
    }),
  )
}

export function downloadPersonnelImportTemplateXlsx(): void {
  const headers = ['销售单位', '姓名', '岗位']
  const rows = [
    ['西安分仓', '李春莲', '分仓负责人'],
    ['西安分仓', '陈鑫', '销售顾问'],
    ['西安分仓', '杨德', '销售顾问'],
    ['西安分仓', '王浩栋', '销售顾问'],
    ['西安分仓', '雷河玲', '销售顾问'],
    ['西安分仓', '卢大洋', '分仓负责人'],
    ['西安分仓', '卢梅', '售前售后工程师'],
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '人员导入')
  XLSX.writeFile(wb, '人员批量导入模板.xlsx')
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