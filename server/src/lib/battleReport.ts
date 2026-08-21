/**
 * 单位战报计算（服务端）
 * 业绩唯一凭证：销售记录；订单分业绩按份额计入对应单位/人员（支持跨单位）
 * 团队总业绩 = 本单位各人个人业绩之和
 */

const NON_SALES_POSITION_KEYWORDS = [
  '组织部', '组织', '售后', '人事', '财务', '行政', '后勤',
  '客服', '技术支持', '研发', '运维', '产品运营', '设计师', '法务', '军工',
] as const

const SALES_POSITION_KEYWORDS = [
  '销售', '顾问', '业务员', '业务经理', '客户经理', '外援',
] as const

const UNATTRIBUTED_ID = 'unattributed'
const UNATTRIBUTED_NAME = '未归集（无销售员）'

export type BattleUnitAssignment = {
  salesUnitId: string
  startDate: string
  endDate?: string
}

export type BattlePerson = {
  id: string
  name: string
  salesUnitId: string
  position?: string
  hireDate?: string
  resignDate?: string
  status?: string
  unitAssignments?: BattleUnitAssignment[]
}

export type BattleSaleCollaborator = {
  personnelId: string
  salesUnitId?: string
  sharePercent?: number
  shareAmount?: number
}

export type BattleSale = {
  salesUnitId: string
  productId?: string
  personnelId?: string
  salesPersonName?: string
  totalAmount: number
  saleDate: string
  collaborators?: BattleSaleCollaborator[]
  shareMode?: 'percent' | 'amount'
}

export type BattleUpsExclude = {
  salesUnitId: string
  productId: string
  excludeFromPerformance?: boolean
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
  effectiveTeamTarget: number
  teamDiff: number
  effectiveTeamCompletionRate: number
}

type SalesAgg = {
  personId: string
  name: string
  position: string
  isExternalPerson: boolean
  amount: number
}

function toDateOnly(value?: string): string {
  return (value || '').slice(0, 10)
}

function eachDateInMonth(yearMonth: string): string[] {
  const [y, m] = yearMonth.split('-').map(Number)
  if (!y || !m) return []
  const last = new Date(y, m, 0).getDate()
  const out: string[] = []
  for (let day = 1; day <= last; day += 1) {
    out.push(`${yearMonth}-${String(day).padStart(2, '0')}`)
  }
  return out
}

function isAssignmentActiveOn(a: BattleUnitAssignment, day: string): boolean {
  const d = toDateOnly(day)
  if (!d) return false
  const start = toDateOnly(a.startDate)
  if (!start || d < start) return false
  const end = toDateOnly(a.endDate)
  if (end && d >= end) return false
  return true
}

function resolveUnitIdAt(person: BattlePerson, asOfDate: string): string {
  const d = toDateOnly(asOfDate) || asOfDate
  const list = person.unitAssignments || []
  if (list.length > 0) {
    const hit = list.find((a) => isAssignmentActiveOn(a, d))
    if (hit?.salesUnitId) return hit.salesUnitId
  }
  return person.salesUnitId || ''
}

function personBelongsToUnitInMonth(
  person: BattlePerson,
  unitId: string,
  yearMonth: string,
): boolean {
  const list = person.unitAssignments || []
  if (list.length === 0) return person.salesUnitId === unitId
  const days = eachDateInMonth(yearMonth)
  return days.some((d) => resolveUnitIdAt(person, d) === unitId)
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

function matchPositionLabel(
  position: string,
  labels: PositionGroupLabel[],
): PositionGroupLabel | null {
  const pos = (position || '').toLowerCase()
  return labels.find((l) => pos.includes((l.keyword || '').toLowerCase())) || null
}

function findPersonByName(
  name: string,
  personnel: BattlePerson[],
  salesUnitId: string,
  yearMonth: string,
): BattlePerson | undefined {
  const hits = personnel.filter((p) => (p.name || '').trim() === name)
  if (hits.length === 0) return undefined
  const inUnit = hits.find((p) => personBelongsToUnitInMonth(p, salesUnitId, yearMonth))
  return inUnit || hits[0]
}

function getPersonShareAmount(sale: BattleSale, personId: string): number {
  if (!personId) return 0
  const cols = sale.collaborators || []
  if (cols.length === 0) {
    return sale.personnelId === personId ? (Number(sale.totalAmount) || 0) : 0
  }
  const hit = cols.find((c) => c.personnelId === personId)
  if (!hit) return 0
  if (sale.shareMode === 'amount') {
    return Number(hit.shareAmount) || 0
  }
  return (Number(sale.totalAmount) || 0) * (Number(hit.sharePercent) || 0) / 100
}

function shareBelongsToUnit(
  c: BattleSaleCollaborator,
  person: BattlePerson | undefined,
  salesUnitId: string,
  yearMonth: string,
): boolean {
  if (c.salesUnitId) return c.salesUnitId === salesUnitId
  if (person) return personBelongsToUnitInMonth(person, salesUnitId, yearMonth)
  return false
}

function isProductInPerformance(
  excludedKeys: Set<string>,
  productId: string | undefined,
  unitId: string,
): boolean {
  if (!productId || !unitId) return true
  return !excludedKeys.has(`${unitId}::${productId}`)
}

function buildExcludedPerformanceKeys(upsList: BattleUpsExclude[]): Set<string> {
  const keys = new Set<string>()
  for (const u of upsList) {
    if (u.excludeFromPerformance && u.salesUnitId && u.productId) {
      keys.add(`${u.salesUnitId}::${u.productId}`)
    }
  }
  return keys
}

function aggregateSalesByPerson(
  monthSales: BattleSale[],
  personnel: BattlePerson[],
  salesUnitId: string,
  yearMonth: string,
  excludedKeys: Set<string> = new Set(),
): Map<string, SalesAgg> {
  const personnelById = new Map(personnel.map((p) => [p.id, p]))
  const agg = new Map<string, SalesAgg>()

  function add(row: Omit<SalesAgg, 'amount'>, amount: number) {
    if (!(amount > 0)) return
    const prev = agg.get(row.personId)
    if (prev) {
      prev.amount += amount
      return
    }
    agg.set(row.personId, { ...row, amount })
  }

  function addFullOrderToPrimary(r: BattleSale) {
    if (r.salesUnitId !== salesUnitId) return
    if (!isProductInPerformance(excludedKeys, r.productId, salesUnitId)) return
    const amount = Number(r.totalAmount) || 0
    const pid = (r.personnelId || '').trim()
    const sname = (r.salesPersonName || '').trim()
    const byId = pid ? personnelById.get(pid) : undefined

    if (byId) {
      add(
        {
          personId: byId.id,
          name: byId.name,
          position: byId.position || '',
          isExternalPerson: false,
        },
        amount,
      )
      return
    }

    if (sname) {
      const byName = findPersonByName(sname, personnel, salesUnitId, yearMonth)
      if (byName) {
        add(
          {
            personId: byName.id,
            name: byName.name,
            position: byName.position || '',
            isExternalPerson: false,
          },
          amount,
        )
      } else {
        add(
          {
            personId: `ext_${sname}`,
            name: sname,
            position: '外援',
            isExternalPerson: true,
          },
          amount,
        )
      }
      return
    }

    add(
      {
        personId: UNATTRIBUTED_ID,
        name: UNATTRIBUTED_NAME,
        position: '',
        isExternalPerson: true,
      },
      amount,
    )
  }

  for (const r of monthSales) {
    const shares = r.collaborators || []
    if (shares.length >= 2) {
      for (const c of shares) {
        const pid = (c.personnelId || '').trim()
        if (!pid) continue
        const amount = getPersonShareAmount(r, pid)
        const person = personnelById.get(pid)
        if (!shareBelongsToUnit(c, person, salesUnitId, yearMonth)) continue
        const shareUnitId = c.salesUnitId || r.salesUnitId
        if (!isProductInPerformance(excludedKeys, r.productId, shareUnitId)) continue
        if (person) {
          add(
            {
              personId: person.id,
              name: person.name,
              position: person.position || '',
              isExternalPerson: false,
            },
            amount,
          )
        } else {
          add(
            {
              personId: `ext_${pid}`,
              name: pid,
              position: '外援',
              isExternalPerson: true,
            },
            amount,
          )
        }
      }
      continue
    }

    addFullOrderToPrimary(r)
  }

  return agg
}

export function buildUnitBattleReport(options: {
  salesUnitId: string
  salesUnitName: string
  yearMonth: string
  personnel: BattlePerson[]
  salesRecords: BattleSale[]
  performanceTargets: BattleTarget[]
  positionGroupLabels: PositionGroupLabel[]
  upsList?: BattleUpsExclude[]
}): UnitBattleReport {
  const {
    salesUnitId,
    salesUnitName,
    yearMonth,
    personnel,
    salesRecords,
    performanceTargets,
    positionGroupLabels,
    upsList = [],
  } = options

  const monthSales = filterByMonth(salesRecords, yearMonth)
  const excludedKeys = buildExcludedPerformanceKeys(upsList)

  const salesAgg = aggregateSalesByPerson(
    monthSales,
    personnel,
    salesUnitId,
    yearMonth,
    excludedKeys,
  )

  for (const p of personnel) {
    if (salesAgg.has(p.id)) continue
    if (!personBelongsToUnitInMonth(p, salesUnitId, yearMonth)) continue
    if (!wasEmployedInMonth(p, yearMonth)) continue
    if (!isSalesBattlePosition(p.position)) continue
    salesAgg.set(p.id, {
      personId: p.id,
      name: p.name,
      position: p.position || '',
      isExternalPerson: false,
      amount: 0,
    })
  }

  const personnelTargets = new Map<string, number>()
  performanceTargets.forEach((t) => {
    if (t.salesUnitId === salesUnitId && t.yearMonth === yearMonth && t.personnelId) {
      personnelTargets.set(t.personnelId, t.targetAmount)
    }
  })

  const rows: BattleReportRow[] = Array.from(salesAgg.values())
    .sort((a, b) => {
      if (a.personId === UNATTRIBUTED_ID) return 1
      if (b.personId === UNATTRIBUTED_ID) return -1
      if (a.isExternalPerson !== b.isExternalPerson) {
        return a.isExternalPerson ? 1 : -1
      }
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    .map((item) => {
      const targetAmount = item.isExternalPerson
        ? undefined
        : personnelTargets.get(item.personId)
      const hasTarget = targetAmount !== undefined
      const amt = targetAmount || 0
      const personalSales = item.amount
      const diff = hasTarget ? personalSales - amt : 0
      const completionRate = hasTarget && amt > 0 ? (personalSales / amt) * 100 : 0
      return {
        personId: item.personId,
        name: item.name,
        position: item.position,
        targetAmount: hasTarget ? amt : null,
        personalSales,
        diff,
        completionRate,
        positionMatch: matchPositionLabel(item.position || '', positionGroupLabels),
        isExternalPerson: item.isExternalPerson,
      }
    })

  const totalTarget = rows.reduce((sum, row) => sum + (row.targetAmount || 0), 0)
  const battlePersonalSalesTotal = rows.reduce((sum, row) => sum + row.personalSales, 0)
  const teamTotal = battlePersonalSalesTotal
  const effectiveTeamTarget = totalTarget
  const teamDiff = effectiveTeamTarget > 0 ? teamTotal - effectiveTeamTarget : 0
  const effectiveTeamCompletionRate =
    effectiveTeamTarget > 0 ? (teamTotal / effectiveTeamTarget) * 100 : 0

  return {
    salesUnitId,
    salesUnitName,
    yearMonth,
    rows,
    totalTarget,
    battlePersonalSalesTotal,
    teamTotal,
    effectiveTeamTarget,
    teamDiff,
    effectiveTeamCompletionRate,
  }
}
