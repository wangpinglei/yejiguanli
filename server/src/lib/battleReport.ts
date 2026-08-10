/**
 * 单位战报计算（服务端，口径对齐前端 SalesBattleReport）
 */

const NON_SALES_POSITION_KEYWORDS = [
  '组织部', '组织', '售后', '人事', '财务', '行政', '后勤',
  '客服', '技术支持', '研发', '运维', '产品运营', '设计师', '法务', '军工',
] as const

const SALES_POSITION_KEYWORDS = [
  '销售', '顾问', '业务员', '业务经理', '客户经理', '外援',
] as const

export type BattlePerson = {
  id: string
  name: string
  salesUnitId: string
  position?: string
  hireDate?: string
  resignDate?: string
  status?: string
}

export type BattleSale = {
  salesUnitId: string
  personnelId?: string
  salesPersonName?: string
  totalAmount: number
  saleDate: string
}

export type BattleTarget = {
  salesUnitId: string
  yearMonth: string
  personnelId?: string
  targetAmount: number
}

export type PositionGroupLabel = {
  keyword: string
  label: string
  color?: string
}

export type BattleReportRow = {
  personId: string
  name: string
  position: string
  targetAmount: number | null
  personalSales: number
  diff: number
  completionRate: number
  positionMatch: PositionGroupLabel | null
  isExternalPerson: boolean
}

export type UnitBattleReport = {
  salesUnitId: string
  salesUnitName: string
  yearMonth: string
  rows: BattleReportRow[]
  totalTarget: number
  battlePersonalSalesTotal: number
  teamTotal: number
  unitTargetAmount: number
  effectiveTeamTarget: number
  teamDiff: number
  effectiveTeamCompletionRate: number
  targetGap: number
}

function filterByMonth(records: BattleSale[], yearMonth: string): BattleSale[] {
  return records.filter((s) => (s.saleDate || '').startsWith(yearMonth))
}

function wasEmployedInMonth(
  person: { hireDate?: string; resignDate?: string; status?: string },
  yearMonth: string,
): boolean {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return person.status !== 'inactive'
  const [y, m] = yearMonth.split('-').map(Number)
  const monthStart = `${yearMonth}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, '0')}`
  const hire = (person.hireDate || '').slice(0, 10)
  const resign = (person.resignDate || '').slice(0, 10)
  if (hire && hire > monthEnd) return false
  if (resign) return resign >= monthStart
  if (person.status === 'inactive') return false
  return true
}

function isSalesBattlePosition(position?: string): boolean {
  const pos = (position || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!pos) return false
  if (pos.includes('销售')) return true
  if (NON_SALES_POSITION_KEYWORDS.some((k) => pos.includes(k.toLowerCase()))) return false
  return SALES_POSITION_KEYWORDS.some((k) => pos.includes(k.toLowerCase()))
}

function getPersonalSales(
  personId: string,
  salesRecords: BattleSale[],
  personName?: string,
): number {
  const name = (personName || '').trim()
  return salesRecords
    .filter((s) => {
      if (s.personnelId === personId) return true
      if (!s.personnelId && name && (s.salesPersonName || '').trim() === name) return true
      return false
    })
    .reduce((sum, s) => sum + (s.totalAmount || 0), 0)
}

function matchPositionLabel(
  position: string,
  labels: PositionGroupLabel[],
): PositionGroupLabel | null {
  const pos = (position || '').toLowerCase()
  return labels.find((l) => pos.includes((l.keyword || '').toLowerCase())) || null
}

export function buildUnitBattleReport(options: {
  salesUnitId: string
  salesUnitName: string
  yearMonth: string
  personnel: BattlePerson[]
  salesRecords: BattleSale[]
  performanceTargets: BattleTarget[]
  positionGroupLabels: PositionGroupLabel[]
}): UnitBattleReport {
  const {
    salesUnitId,
    salesUnitName,
    yearMonth,
    personnel,
    salesRecords,
    performanceTargets,
    positionGroupLabels,
  } = options

  const monthUnitSales = filterByMonth(salesRecords, yearMonth).filter(
    (r) => r.salesUnitId === salesUnitId,
  )

  const unitPersonnel = personnel.filter((p) => {
    if (p.salesUnitId !== salesUnitId) return false
    if (wasEmployedInMonth(p, yearMonth)) return true
    return getPersonalSales(p.id, monthUnitSales, p.name) > 0
  })

  const battlePersonnel = unitPersonnel.filter(
    (p) =>
      isSalesBattlePosition(p.position) ||
      getPersonalSales(p.id, monthUnitSales, p.name) > 0,
  )
  const unitMonthlyRecords = filterByMonth(salesRecords, yearMonth).filter(
    (r) => r.salesUnitId === salesUnitId,
  )
  const teamTotal = unitMonthlyRecords.reduce((sum, r) => sum + (r.totalAmount || 0), 0)

  const unitTarget = performanceTargets.find(
    (t) => t.salesUnitId === salesUnitId && t.yearMonth === yearMonth && !t.personnelId,
  )
  const unitTargetAmount = unitTarget?.targetAmount || 0

  const personnelTargets = new Map<string, number>()
  performanceTargets.forEach((t) => {
    if (t.salesUnitId === salesUnitId && t.yearMonth === yearMonth && t.personnelId) {
      personnelTargets.set(t.personnelId, t.targetAmount)
    }
  })

  const rows: BattleReportRow[] = battlePersonnel.map((p) => {
    const personalSales = getPersonalSales(p.id, unitMonthlyRecords, p.name)
    const targetAmount = personnelTargets.get(p.id)
    const hasTarget = targetAmount !== undefined
    const amt = targetAmount || 0
    const diff = hasTarget ? personalSales - amt : 0
    const completionRate = hasTarget && amt > 0 ? (personalSales / amt) * 100 : 0
    return {
      personId: p.id,
      name: p.name,
      position: p.position || '',
      targetAmount: hasTarget ? amt : null,
      personalSales,
      diff,
      completionRate,
      positionMatch: matchPositionLabel(p.position || '', positionGroupLabels),
      isExternalPerson: false,
    }
  })

  const externalMap = new Map<string, number>()
  unitMonthlyRecords.forEach((r) => {
    if (r.personnelId || !r.salesPersonName?.trim()) return
    const name = r.salesPersonName.trim()
    if (battlePersonnel.some((p) => p.name === name)) return
    externalMap.set(name, (externalMap.get(name) || 0) + r.totalAmount)
  })

  const existingNames = new Set(unitPersonnel.map((p) => p.name))
  externalMap.forEach((sales, name) => {
    if (existingNames.has(name)) return
    rows.push({
      personId: `ext_${name}`,
      name,
      position: '外援',
      targetAmount: null,
      personalSales: sales,
      diff: 0,
      completionRate: 0,
      positionMatch: matchPositionLabel('外援', positionGroupLabels),
      isExternalPerson: true,
    })
  })

  const totalTarget = rows.reduce((sum, row) => sum + (row.targetAmount || 0), 0)
  const battlePersonalSalesTotal = rows.reduce((sum, row) => sum + row.personalSales, 0)
  const effectiveTeamTarget = totalTarget > 0 ? totalTarget : unitTargetAmount
  const teamDiff = effectiveTeamTarget > 0 ? teamTotal - effectiveTeamTarget : 0
  const effectiveTeamCompletionRate =
    effectiveTeamTarget > 0 ? (teamTotal / effectiveTeamTarget) * 100 : 0
  const targetGap = unitTarget ? unitTargetAmount - totalTarget : 0

  return {
    salesUnitId,
    salesUnitName,
    yearMonth,
    rows,
    totalTarget,
    battlePersonalSalesTotal,
    teamTotal,
    unitTargetAmount,
    effectiveTeamTarget,
    teamDiff,
    effectiveTeamCompletionRate,
    targetGap,
  }
}
