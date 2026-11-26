/** 销售进款（实收）按成交日聚合：日 / 周（周一为起）/ 月 / 年 */

import { roundMoney } from '@/lib/format'
import { normalizeSaleDate } from '@/lib/salesDuplicate'
import { getUnitShareAmount } from '@/lib/saleCollaborators'
import type { Personnel, SalesRecord } from '@/types'

export type ReceiptGrain = 'day' | 'week' | 'month' | 'year'

export type SalesReceiptSalePick = Pick<
  SalesRecord,
  'saleDate' | 'totalAmount' | 'salesUnitId'
> & { saleId?: string }

export type ReceiptBucket = {
  key: string
  label: string
  amount: number
  count: number
  startDate: string
  endDate: string
}

export type ReceiptPeriodSummary = {
  amount: number
  count: number
  label: string
  startDate: string
  endDate: string
}

export type SalesReceiptDashboardResult = {
  buckets: ReceiptBucket[]
  current: ReceiptPeriodSummary
  previous: ReceiptPeriodSummary
  momPct: number | null
}

const DAY_MS = 86400000

function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00`)
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

/** 该日所在自然周：周一为起始（周一至周日） */
export function startOfWeekMonday(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(d, diff)
}

function endOfWeekMonday(weekStart: Date): Date {
  return addDays(weekStart, 6)
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 12)
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31, 12)
}

function sumInRange(
  records: SalesReceiptSalePick[],
  start: string,
  end: string,
): { amount: number; count: number } {
  let amount = 0
  const orderIds = new Set<string>()
  let lineCount = 0
  for (const r of records) {
    const day = normalizeSaleDate(r.saleDate)
    if (!day || day < start || day > end) continue
    const amt = Number(r.totalAmount) || 0
    if (amt === 0) continue
    amount += amt
    if (r.saleId) orderIds.add(r.saleId)
    else lineCount += 1
  }
  const count = orderIds.size > 0 ? orderIds.size : lineCount
  return { amount: roundMoney(amount), count }
}

/**
 * 看板聚合行：选全部单位时按整单实收（不重复）；选部分单位时按分业绩计入本单位份额。
 */
export function buildSalesReceiptRows(
  records: SalesRecord[],
  options: {
    unitFilterIds: string[]
    allScopedUnitIds: string[]
    personnel: Personnel[]
  },
): SalesReceiptSalePick[] {
  const { unitFilterIds, allScopedUnitIds, personnel } = options
  const isAllUnits =
    allScopedUnitIds.length > 0
    && unitFilterIds.length === allScopedUnitIds.length
    && allScopedUnitIds.every((id) => unitFilterIds.includes(id))

  if (isAllUnits) {
    return records.map((r) => ({
      saleId: r.id,
      saleDate: r.saleDate,
      totalAmount: Number(r.totalAmount) || 0,
      salesUnitId: r.salesUnitId,
    }))
  }

  const rows: SalesReceiptSalePick[] = []
  for (const sale of records) {
    for (const unitId of unitFilterIds) {
      const amt = getUnitShareAmount(sale, unitId, personnel)
      if (amt <= 0) continue
      rows.push({
        saleId: sale.id,
        saleDate: sale.saleDate,
        totalAmount: amt,
        salesUnitId: unitId,
      })
    }
  }
  return rows
}

function momPct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : null
  return roundMoney(((current - previous) / previous) * 100)
}

function buildDayBuckets(ref: Date): ReceiptBucket[] {
  const buckets: ReceiptBucket[] = []
  for (let i = 29; i >= 0; i--) {
    const d = addDays(ref, -i)
    const ymd = formatYmd(d)
    buckets.push({
      key: ymd,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      amount: 0,
      count: 0,
      startDate: ymd,
      endDate: ymd,
    })
  }
  return buckets
}

function buildWeekBuckets(ref: Date): ReceiptBucket[] {
  const weekStart = startOfWeekMonday(ref)
  const buckets: ReceiptBucket[] = []
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(weekStart, -i * 7)
    const we = endOfWeekMonday(ws)
    buckets.push({
      key: formatYmd(ws),
      label: `${ws.getMonth() + 1}/${ws.getDate()}周`,
      amount: 0,
      count: 0,
      startDate: formatYmd(ws),
      endDate: formatYmd(we),
    })
  }
  return buckets
}

function buildMonthBuckets(ref: Date): ReceiptBucket[] {
  const buckets: ReceiptBucket[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1, 12)
    const start = formatYmd(startOfMonth(d))
    const end = formatYmd(endOfMonth(d))
    buckets.push({
      key: start.slice(0, 7),
      label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
      amount: 0,
      count: 0,
      startDate: start,
      endDate: end,
    })
  }
  return buckets
}

function buildYearBuckets(ref: Date): ReceiptBucket[] {
  const buckets: ReceiptBucket[] = []
  for (let i = 4; i >= 0; i--) {
    const y = ref.getFullYear() - i
    const d = new Date(y, 0, 1, 12)
    buckets.push({
      key: String(y),
      label: `${y}年`,
      amount: 0,
      count: 0,
      startDate: formatYmd(startOfYear(d)),
      endDate: formatYmd(endOfYear(d)),
    })
  }
  return buckets
}

function fillBuckets(
  records: SalesReceiptSalePick[],
  buckets: ReceiptBucket[],
): ReceiptBucket[] {
  return buckets.map((b) => {
    const { amount, count } = sumInRange(records, b.startDate, b.endDate)
    return { ...b, amount, count }
  })
}

export function buildSalesReceiptDashboard(
  records: SalesReceiptSalePick[],
  options: {
    grain: ReceiptGrain
    referenceDate?: string
  },
): SalesReceiptDashboardResult {
  const refYmd = normalizeSaleDate(options.referenceDate || formatYmd(new Date()))
  const ref = parseYmd(refYmd || formatYmd(new Date()))

  let buckets: ReceiptBucket[]
  let current: ReceiptPeriodSummary
  let previous: ReceiptPeriodSummary

  if (options.grain === 'day') {
    buckets = buildDayBuckets(ref)
    const curStart = refYmd
    const curEnd = refYmd
    const prevD = addDays(ref, -1)
    const prevYmd = formatYmd(prevD)
    const cur = sumInRange(records, curStart, curEnd)
    const prev = sumInRange(records, prevYmd, prevYmd)
    current = {
      ...cur,
      label: `当日 ${refYmd}`,
      startDate: curStart,
      endDate: curEnd,
    }
    previous = {
      ...prev,
      label: `前日 ${prevYmd}`,
      startDate: prevYmd,
      endDate: prevYmd,
    }
  } else if (options.grain === 'week') {
    buckets = buildWeekBuckets(ref)
    const ws = formatYmd(startOfWeekMonday(ref))
    const we = formatYmd(endOfWeekMonday(startOfWeekMonday(ref)))
    const pws = formatYmd(addDays(startOfWeekMonday(ref), -7))
    const pwe = formatYmd(addDays(endOfWeekMonday(startOfWeekMonday(ref)), -7))
    const cur = sumInRange(records, ws, we)
    const prev = sumInRange(records, pws, pwe)
    current = {
      ...cur,
      label: `本周 ${ws} ~ ${we}`,
      startDate: ws,
      endDate: we,
    }
    previous = {
      ...prev,
      label: `上周 ${pws} ~ ${pwe}`,
      startDate: pws,
      endDate: pwe,
    }
  } else if (options.grain === 'month') {
    buckets = buildMonthBuckets(ref)
    const ms = formatYmd(startOfMonth(ref))
    const me = formatYmd(endOfMonth(ref))
    const prevM = new Date(ref.getFullYear(), ref.getMonth() - 1, 1, 12)
    const pms = formatYmd(startOfMonth(prevM))
    const pme = formatYmd(endOfMonth(prevM))
    const cur = sumInRange(records, ms, me)
    const prev = sumInRange(records, pms, pme)
    current = {
      ...cur,
      label: `${ref.getFullYear()}年${ref.getMonth() + 1}月`,
      startDate: ms,
      endDate: me,
    }
    previous = {
      ...prev,
      label: `${prevM.getFullYear()}年${prevM.getMonth() + 1}月`,
      startDate: pms,
      endDate: pme,
    }
  } else {
    buckets = buildYearBuckets(ref)
    const ys = formatYmd(startOfYear(ref))
    const ye = formatYmd(endOfYear(ref))
    const prevY = new Date(ref.getFullYear() - 1, 0, 1, 12)
    const pys = formatYmd(startOfYear(prevY))
    const pye = formatYmd(endOfYear(prevY))
    const cur = sumInRange(records, ys, ye)
    const prev = sumInRange(records, pys, pye)
    current = {
      ...cur,
      label: `${ref.getFullYear()}年`,
      startDate: ys,
      endDate: ye,
    }
    previous = {
      ...prev,
      label: `${ref.getFullYear() - 1}年`,
      startDate: pys,
      endDate: pye,
    }
  }

  buckets = fillBuckets(records, buckets)

  return {
    buckets,
    current,
    previous,
    momPct: momPct(current.amount, previous.amount),
  }
}

/** 当前周期内各单位进款（含分业绩按 collaborators 归属） */
export function buildUnitReceiptRanking(
  records: SalesRecord[],
  unitFilterIds: string[],
  unitNames: Map<string, string>,
  startDate: string,
  endDate: string,
  personnel: Personnel[],
): Array<{ unitId: string; name: string; amount: number; count: number }> {
  const map = new Map<string, { amount: number; orderIds: Set<string> }>()
  for (const unitId of unitFilterIds) {
    map.set(unitId, { amount: 0, orderIds: new Set() })
  }
  for (const sale of records) {
    const day = normalizeSaleDate(sale.saleDate)
    if (!day || day < startDate || day > endDate) continue
    for (const unitId of unitFilterIds) {
      const amt = getUnitShareAmount(sale, unitId, personnel)
      if (amt <= 0) continue
      const row = map.get(unitId)
      if (!row) continue
      row.amount += amt
      row.orderIds.add(sale.id)
    }
  }
  return Array.from(map.entries())
    .map(([unitId, { amount, orderIds }]) => ({
      unitId,
      name: unitNames.get(unitId) || unitId,
      amount: roundMoney(amount),
      count: orderIds.size,
    }))
    .filter((r) => r.amount > 0 || r.count > 0)
    .sort((a, b) => b.amount - a.amount)
}