/** 工资核算 → 个人业绩提成明细（核对用） */

import { calcSaleCommissionReward, findProductPersonCommission } from '@/lib/commissionReward'
import {
  calculateMonthlySalary,
  filterByMonth,
  getPersonalSales,
  type TeamMgmtSalaryContext,
} from '@/lib/salary'
import { calcUnitTeamMgmtCommission } from '@/lib/teamMgmtCommission'
import { getPersonShareAmount, scaleSaleForPerson } from '@/lib/saleCollaborators'
import type {
  PerformanceTarget,
  Personnel,
  Product,
  ProductPersonCommission,
  SalesRecord,
  TeamMgmtCommissionRule,
  UnitProductSettlement,
} from '@/types'

export type CommissionDetailKind = 'personal' | 'internalSales' | 'teamMgmt' | 'reward'

export interface CommissionDetailLine {
  id: string
  kind: CommissionDetailKind
  kindLabel: string
  productId: string
  productName: string
  unitId: string
  unitName: string
  /** 业绩基数（销售额或团队计佣业绩） */
  performanceAmount: number
  quantity: number
  /** 提成规则文案，如 3% / ¥50/件 / 门槛后 2% */
  rateLabel: string
  /** 实际提成金额 */
  amount: number
  note?: string
}

export interface PayrollCommissionDetailResult {
  personnelId: string
  personnelName: string
  unitId: string
  unitName: string
  yearMonth: string
  personalTotal: number
  internalTotal: number
  teamMgmtTotal: number
  /** 与工资表「业绩提成」一致 */
  commissionTotal: number
  personalSales: number
  lines: CommissionDetailLine[]
}

function formatRateLabel(opts: {
  type?: string
  rate?: number
  amount?: number
  threshold?: number
}): string {
  const type = opts.type || 'percentage'
  const threshold = opts.threshold || 0
  if (type === 'fixed') {
    return `¥${Number(opts.amount || 0).toFixed(2)}/件`
  }
  const rate = Number(opts.rate || 0)
  if (threshold > 0) {
    return `门槛¥${threshold.toFixed(0)}后 ${rate}%`
  }
  return `${rate}%`
}

/**
 * 按产品×单位汇总个人提成明细行（含特殊奖励拆行）
 */
function buildPersonalProductLines(options: {
  person: Personnel
  unitId: string
  yearMonth: string
  salesRecords: SalesRecord[]
  products: Product[]
  ppcList: ProductPersonCommission[]
  unitName: string
}): CommissionDetailLine[] {
  const { person, unitId, yearMonth, salesRecords, products, ppcList, unitName } = options
  const monthly = filterByMonth(salesRecords, yearMonth)
  const personRecords = monthly
    .map((r) => scaleSaleForPerson(r, person.id))
    .filter((r): r is SalesRecord => r != null)
    .filter((r) => !unitId || r.salesUnitId === unitId || getPersonShareAmount(r, person.id) > 0)

  // 若指定单位：只保留该单位成交（含分业绩挂到本单位的）
  const scoped = unitId
    ? personRecords.filter((r) => {
        if (r.salesUnitId === unitId) return true
        // 分业绩：本人份额在任意单上，但单位以成交单位为准；工资核算按 unit 调 calculateMonthlySalary
        return r.salesUnitId === unitId
      })
    : personRecords

  const productName = (id: string) => products.find((p) => p.id === id)?.name || id || '未知产品'

  const byKey = new Map<string, SalesRecord[]>()
  for (const r of scoped) {
    const key = `${r.productId}||${r.salesUnitId}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(r)
  }

  const lines: CommissionDetailLine[] = []
  let lineIdx = 0

  byKey.forEach((recs, key) => {
    const [productId, saleUnitId] = key.split('||')
    const sales = recs.reduce((s, r) => s + (r.totalAmount || 0), 0)
    const qty = recs.reduce((s, r) => s + (r.quantity || 0), 0)
    const ppc = findProductPersonCommission(ppcList, productId, saleUnitId, person.id)
      || findProductPersonCommission(ppcList, productId, person.salesUnitId, person.id)

    let rateLabel = '未配置（走人员默认）'
    let amount = 0
    if (ppc) {
      const type = ppc.personalCommissionType || 'percentage'
      rateLabel = formatRateLabel({
        type,
        rate: ppc.personalCommissionRate,
        amount: ppc.personalCommissionAmount,
        threshold: ppc.personalCommissionThreshold,
      })
      if (type === 'fixed') {
        amount = qty * (ppc.personalCommissionAmount || 0)
      } else {
        const th = ppc.personalCommissionThreshold || 0
        const rate = ppc.personalCommissionRate || 0
        if (sales > th && rate > 0) amount = (sales - th) * (rate / 100)
      }
    } else {
      const s = person.salary
      rateLabel = formatRateLabel({
        type: 'percentage',
        rate: s?.personalCommissionRate,
        threshold: s?.personalCommissionThreshold,
      })
      const th = s?.personalCommissionThreshold || 0
      const rate = s?.personalCommissionRate || 0
      if (sales > th && rate > 0) amount = (sales - th) * (rate / 100)
    }

    lines.push({
      id: `personal-${lineIdx++}`,
      kind: 'personal',
      kindLabel: '个人提成',
      productId,
      productName: productName(productId),
      unitId: saleUnitId,
      unitName,
      performanceAmount: sales,
      quantity: qty,
      rateLabel,
      amount,
    })

    for (const r of recs) {
      const reward = calcSaleCommissionReward(r, ppc || undefined)
      if (reward <= 0) continue
      lines.push({
        id: `reward-${lineIdx++}`,
        kind: 'reward',
        kindLabel: '特殊奖励',
        productId,
        productName: productName(productId),
        unitId: saleUnitId,
        unitName,
        performanceAmount: r.totalAmount || 0,
        quantity: r.quantity || 0,
        rateLabel: `¥${ppc?.rewardAmount || 0}/件`,
        amount: reward,
        note: (r.saleDate || '').slice(0, 10),
      })
    }
  })

  return lines
}

export function buildPayrollCommissionDetail(options: {
  personnelId: string
  unitId: string
  yearMonth: string
  personnel: Personnel[]
  salesUnits: { id: string; name: string }[]
  salesRecords: SalesRecord[]
  products: Product[]
  productPersonCommissions: ProductPersonCommission[]
  teamMgmtRules: TeamMgmtCommissionRule[]
  performanceTargets: PerformanceTarget[]
  unitProductSettlements: UnitProductSettlement[]
}): PayrollCommissionDetailResult | null {
  const {
    personnelId,
    unitId,
    yearMonth,
    personnel,
    salesUnits,
    salesRecords,
    products,
    productPersonCommissions,
    teamMgmtRules,
    performanceTargets,
    unitProductSettlements,
  } = options

  const person = personnel.find((p) => p.id === personnelId)
  if (!person) return null

  const unitName = salesUnits.find((u) => u.id === unitId)?.name || unitId
  const monthly = filterByMonth(salesRecords, yearMonth)
  const unitScopedSales = monthly.filter((s) => s.salesUnitId === unitId)

  const teamMgmtContext: TeamMgmtSalaryContext = {
    rules: teamMgmtRules,
    targets: performanceTargets,
    upsList: unitProductSettlements,
  }
  // 与工资核算同一套口径
  const calc = calculateMonthlySalary(
    person,
    salesRecords,
    products,
    yearMonth,
    undefined,
    productPersonCommissions,
    teamMgmtContext,
    unitId,
  )
  const personalTotal = calc.personalCommission || 0
  const internalTotal = calc.internalSalesCommission || 0
  const teamMgmtTotal = calc.managementCommission || 0

  const lines = buildPersonalProductLines({
    person,
    unitId,
    yearMonth,
    salesRecords,
    products,
    ppcList: productPersonCommissions,
    unitName,
  })

  if (internalTotal > 0) {
    lines.push({
      id: 'internal-total',
      kind: 'internalSales',
      kindLabel: '内部销售提成',
      productId: '',
      productName: '—（按内部销售配置汇总）',
      unitId,
      unitName,
      performanceAmount: getPersonalSales(personnelId, unitScopedSales, person.name),
      quantity: 0,
      rateLabel: '见人员/产品内部销售配置',
      amount: internalTotal,
    })
  }

  if (teamMgmtTotal > 0) {
    const tm = calcUnitTeamMgmtCommission(
      unitId,
      yearMonth,
      salesRecords,
      unitProductSettlements,
      performanceTargets,
      teamMgmtRules.find((r) => r.salesUnitId === unitId),
    )
    const alloc = tm.allocations.find((a) => a.personnelId === personnelId)
    lines.push({
      id: 'team-mgmt',
      kind: 'teamMgmt',
      kindLabel: '团队管理提成',
      productId: '',
      productName: '—（单位团队池分摊）',
      unitId,
      unitName,
      performanceAmount: tm.eligibleSales,
      quantity: 0,
      rateLabel: `完成率${tm.completionPercent.toFixed(1)}% · 池比例${tm.commissionRatePercent}% · 权重${alloc?.weight ?? 0}`,
      amount: teamMgmtTotal,
      note: `团队目标¥${tm.targetAmount.toFixed(0)}`,
    })
  }

  return {
    personnelId,
    personnelName: person.name,
    unitId,
    unitName,
    yearMonth,
    personalTotal,
    internalTotal,
    teamMgmtTotal,
    commissionTotal: personalTotal + internalTotal + teamMgmtTotal,
    personalSales: getPersonalSales(personnelId, unitScopedSales, person.name),
    lines,
  }
}

/** 生成销售记录页核对链接 */
export function buildSalesRecordsCheckHref(opts: {
  personnelId: string
  unitId: string
  yearMonth: string
}): string {
  const [y, m] = opts.yearMonth.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const from = `${opts.yearMonth}-01`
  const to = `${opts.yearMonth}-${String(lastDay).padStart(2, '0')}`
  const q = new URLSearchParams({
    person: opts.personnelId,
    unit: opts.unitId,
    from,
    to,
  })
  return `/sales-records?${q.toString()}`
}
