/**
 * 单位战报计算
 * 业绩唯一凭证：销售记录；订单分业绩按份额计入对应单位/人员（支持跨单位）
 * 团队总业绩 = 本单位各人个人业绩之和
 */
import {
  filterByMonth,
  wasEmployedInMonth,
  isSalesBattlePosition,
  EMPTY_SALARY,
} from '@/lib/salary'
import {
  getPersonShareAmount,
  getSaleShares,
} from '@/lib/saleCollaborators'
import { personBelongsToUnitInMonth } from '@/lib/unitAssignment'
import type { Personnel, PerformanceTarget, SalesRecord, SaleCollaborator } from '@/types'

export type PositionGroupMatch = {
  keyword: string
  label: string
  color?: string
} | null

export type BattleReportRow = {
  personId: string
  name: string
  position: string
  targetAmount: number | null
  personalSales: number
  diff: number
  completionRate: number
  positionMatch: PositionGroupMatch
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

export type MatchPositionFn = (position: string) => PositionGroupMatch

const UNATTRIBUTED_ID = 'unattributed'
const UNATTRIBUTED_NAME = '未归集（无销售员）'

type SalesAgg = {
  personId: string
  name: string
  position: string
  isExternalPerson: boolean
  amount: number
}

function getUnitRosterPersonnel(
  personnel: Personnel[],
  salesUnitId: string,
  yearMonth: string,
): Personnel[] {
  return personnel.filter((p) => {
    const belongs = personBelongsToUnitInMonth(p, salesUnitId, yearMonth)
    if (belongs && wasEmployedInMonth(p, yearMonth)) return true
    return false
  })
}

function findPersonByName(
  name: string,
  personnel: Personnel[],
  salesUnitId: string,
  yearMonth: string,
): Personnel | undefined {
  const hits = personnel.filter((p) => (p.name || '').trim() === name)
  if (hits.length === 0) return undefined
  const inUnit = hits.find((p) => personBelongsToUnitInMonth(p, salesUnitId, yearMonth))
  return inUnit || hits[0]
}

/** 该分摊份额是否计入本单位战报 */
function shareBelongsToUnit(
  c: SaleCollaborator,
  person: Personnel | undefined,
  salesUnitId: string,
  yearMonth: string,
): boolean {
  if (c.salesUnitId) return c.salesUnitId === salesUnitId
  if (person) return personBelongsToUnitInMonth(person, salesUnitId, yearMonth)
  return false
}

/**
 * 按销售记录归集到人（含订单分业绩 / 跨单位）：
 * - 有分摊：按每人份额计入其所属单位战报
 * - 无分摊：仍按订单 salesUnitId 整单归主责/姓名
 */
function aggregateSalesByPerson(
  monthSales: SalesRecord[],
  personnel: Personnel[],
  salesUnitId: string,
  yearMonth: string,
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

  function addFullOrderToPrimary(r: SalesRecord) {
    if (r.salesUnitId !== salesUnitId) return
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
    const shares = getSaleShares(r)
    if (shares.length >= 2) {
      for (const c of shares) {
        const pid = (c.personnelId || '').trim()
        if (!pid) continue
        const amount = getPersonShareAmount(r, pid)
        const person = personnelById.get(pid)
        if (!shareBelongsToUnit(c, person, salesUnitId, yearMonth)) continue

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

/**
 * 计算单个销售单位的战报表数据（业绩以销售记录为唯一凭证）
 */
export function buildUnitBattleReport(options: {
  salesUnitId: string
  salesUnitName: string
  yearMonth: string
  personnel: Personnel[]
  salesRecords: SalesRecord[]
  performanceTargets: PerformanceTarget[]
  matchPositionLabel: MatchPositionFn
}): UnitBattleReport {
  const {
    salesUnitId,
    salesUnitName,
    yearMonth,
    personnel,
    salesRecords,
    performanceTargets,
    matchPositionLabel,
  } = options

  const monthSales = filterByMonth(salesRecords, yearMonth)

  const salesAgg = aggregateSalesByPerson(
    monthSales,
    personnel,
    salesUnitId,
    yearMonth,
  )

  // 本单位在职销售岗：无成交也保留行，便于录目标
  const roster = getUnitRosterPersonnel(personnel, salesUnitId, yearMonth)
  for (const p of roster) {
    if (salesAgg.has(p.id)) continue
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
        positionMatch: matchPositionLabel(item.position || ''),
        isExternalPerson: item.isExternalPerson,
      }
    })

  const totalTarget = rows.reduce((sum, row) => sum + (row.targetAmount || 0), 0)
  const battlePersonalSalesTotal = rows.reduce((sum, row) => sum + row.personalSales, 0)
  // 团队总业绩 = 计入本单位的个人业绩之和（含跨单位分来的份额）
  const teamTotal = battlePersonalSalesTotal
  const effectiveTeamTarget = totalTarget
  const teamDiff = effectiveTeamTarget > 0 ? teamTotal - effectiveTeamTarget : 0
  const effectiveTeamCompletionRate =
    effectiveTeamTarget > 0 ? (teamTotal / effectiveTeamTarget) * 100 : 0

  void EMPTY_SALARY

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

/** 供页面构造伪 Personnel（外援/未归集） */
export function toBattlePersonStub(
  row: BattleReportRow,
  salesUnitId: string,
): Personnel {
  return {
    id: row.personId,
    name: row.name,
    salesUnitId,
    position: row.position,
    phone: '',
    email: '',
    salary: EMPTY_SALARY,
    socialInsurance: 0,
    housingFund: 0,
    hireDate: '',
    status: 'active',
  }
}
