/** 工资核算 → 个人业绩提成明细（按销售记录逐单核对） */

import {
  applyCommissionOrderAdj,
  formatCommissionOrderAdjSummary,
  hasCommissionOrderAdj,
  loadCommissionOrderAdjMap,
  type CommissionOrderAdj,
} from '@/lib/commissionOrderAdj'
import {
  calcSaleCommissionReward,
  calcSalePersonCommissionPreview,
  findProductPersonCommission,
} from '@/lib/commissionReward'
import { roundMoney } from '@/lib/format'
import {
  canApplyPersonalCommissionTiers,
  formatPersonalCommissionTiersLabel,
} from '@/lib/personalCommissionTiers'
import {
  findProductById,
  getPersonCommissionBaseAmount,
  resolveOrderCostDeduction,
} from '@/lib/orderCostBase'
import { findUnitProductSettlement } from '@/lib/settlement'
import {
  calculateMonthlySalary,
  filterByMonth,
  getPersonalSales,
  type TeamMgmtSalaryContext,
} from '@/lib/salary'
import { getPersonShareAmount, saleInvolvesPerson } from '@/lib/saleCollaborators'
import type {
  PerformanceTarget,
  Personnel,
  Product,
  ProductPersonCommission,
  SalesRecord,
  TeamMgmtCommissionRule,
  UnitProductSettlement,
} from '@/types'

export interface CommissionDetailLine {
  id: string
  saleId: string
  saleDate: string
  /** 客户姓名（对齐销售记录） */
  customerName: string
  /** 购买产品（对齐销售记录） */
  productName: string
  productId: string
  /** 参加活动（对齐销售记录 activityName；无活动则空） */
  activityName: string
  /** 订单金额 / 本人业绩份额（扣成本前） */
  orderAmount: number
  /** 本人分摊的成本扣除 */
  costDeduction: number
  /** 系统成本（产品配置） */
  systemCost: number
  /** 是否手工改过成本扣除 */
  costIsManual: boolean
  /** 扣成本后计佣业绩（尚未加人工业绩调整） */
  billableBase: number
  /** 提成规则文案 */
  rateLabel: string
  /** 原比例 %（fixed 为 0） */
  baseRatePct: number
  commissionType: 'percentage' | 'fixed'
  /** 系统未调整提成 */
  systemAmount: number
  /** 单笔调整（无则空） */
  adj: CommissionOrderAdj | null
  /** 调整摘要 */
  adjSummary: string
  /** 最终提成（含调整；明细与工资个人提成对齐用） */
  amount: number
}

export interface PayrollCommissionDetailResult {
  personnelId: string
  personnelName: string
  unitId: string
  unitName: string
  yearMonth: string
  /** 系统个人提成（未含单笔调整） */
  systemPersonalTotal: number
  /** 个人提成（有调整时 = 明细行合计） */
  personalTotal: number
  internalTotal: number
  teamMgmtTotal: number
  /** 与工资表「业绩提成」一致 */
  commissionTotal: number
  personalSales: number
  /** 是否存在任意单笔调整 */
  hasOrderAdj: boolean
  lines: CommissionDetailLine[]
}

function formatRateLabel(opts: {
  type?: string
  rate?: number
  amount?: number
  threshold?: number
  tiersLabel?: string
  rewardAmount?: number
}): string {
  const type = opts.type || 'percentage'
  const parts: string[] = []
  if (type === 'fixed') {
    parts.push(`¥${Number(opts.amount || 0).toFixed(2)}/件`)
  } else if (opts.tiersLabel) {
    parts.push(`月度梯度 ${opts.tiersLabel}`)
  } else {
    const rate = Number(opts.rate || 0)
    const threshold = opts.threshold || 0
    if (threshold > 0) parts.push(`门槛¥${threshold.toFixed(0)}后 ${rate}%`)
    else parts.push(`${rate}%`)
  }
  if (opts.rewardAmount && opts.rewardAmount > 0) {
    parts.push(`+奖励¥${opts.rewardAmount}/件`)
  }
  return parts.join(' ')
}

/**
 * 按销售记录逐单列出（对齐销售记录：客户 / 产品 / 订单金额）
 */
function buildSaleRecordLines(options: {
  person: Personnel
  unitId: string
  yearMonth: string
  salesRecords: SalesRecord[]
  products: Product[]
  ppcList: ProductPersonCommission[]
  upsList: UnitProductSettlement[]
  adjMap: Record<string, CommissionOrderAdj>
}): CommissionDetailLine[] {
  const {
    person, unitId, yearMonth, salesRecords, products, ppcList, upsList, adjMap,
  } = options
  const monthly = filterByMonth(salesRecords, yearMonth)

  const productNameOf = (id: string, fallback?: string) =>
    products.find((p) => p.id === id)?.name || fallback || id || '未知产品'

  const related = monthly.filter((s) => {
    if (unitId && s.salesUnitId !== unitId) return false
    const share = getPersonShareAmount(s, person.id)
    if (share > 0) return true
    return saleInvolvesPerson(s, person.id, person.name)
  })

  related.sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''))

  return related.map((sale) => {
    const product = findProductById(products, sale.productId)
    let orderAmount = getPersonShareAmount(sale, person.id)
    if (orderAmount <= 0 && saleInvolvesPerson(sale, person.id, person.name)) {
      orderAmount = sale.totalAmount || 0
    }
    const costResolved = resolveOrderCostDeduction(sale, product)
    const fullTotal = Number(sale.totalAmount) || 0
    const shareRatio = fullTotal > 0 ? orderAmount / fullTotal : 0
    const costDeduction = roundMoney(costResolved.cost * shareRatio)
    const systemCostShare = roundMoney(costResolved.systemCost * shareRatio)
    let billableBase = getPersonCommissionBaseAmount(sale, person.id, product)
    if (billableBase <= 0 && orderAmount > 0) {
      billableBase = roundMoney(Math.max(0, orderAmount - costDeduction))
    }

    const ppc =
      findProductPersonCommission(ppcList, sale.productId, sale.salesUnitId, person.id)
      || findProductPersonCommission(ppcList, sale.productId, person.salesUnitId, person.id)

    const commissionType: 'percentage' | 'fixed' =
      ppc?.personalCommissionType === 'fixed' ? 'fixed' : 'percentage'
    let baseRatePct = 0
    if (ppc) {
      baseRatePct =
        commissionType === 'fixed' ? 0 : Number(ppc.personalCommissionRate) || 0
    } else {
      baseRatePct = Number(person.salary?.personalCommissionRate) || 0
    }

    const ups = findUnitProductSettlement(
      upsList,
      sale.productId,
      sale.salesUnitId,
      sale.saleDate,
    ) || findUnitProductSettlement(upsList, sale.productId, person.salesUnitId)

    let rateLabel = '未配置（走人员默认）'
    if (ppc) {
      const useTiers = canApplyPersonalCommissionTiers({
        personalCommissionType: ppc.personalCommissionType,
        tiers: ppc.personalCommissionTiers,
        ups,
      })
      rateLabel = formatRateLabel({
        type: ppc.personalCommissionType || 'percentage',
        rate: ppc.personalCommissionRate,
        amount: ppc.personalCommissionAmount,
        threshold: ppc.personalCommissionThreshold,
        tiersLabel: useTiers
          ? formatPersonalCommissionTiersLabel(ppc.personalCommissionTiers)
          : undefined,
        rewardAmount: ppc.rewardAmount,
      })
    } else {
      const s = person.salary
      rateLabel = formatRateLabel({
        type: 'percentage',
        rate: s?.personalCommissionRate,
        threshold: s?.personalCommissionThreshold,
      })
    }

    const preview = calcSalePersonCommissionPreview(
      {
        productId: sale.productId,
        salesUnitId: sale.salesUnitId,
        personnelId: person.id,
        quantity: sale.quantity,
        totalAmount: billableBase,
        saleDate: sale.saleDate,
      },
      ppcList,
      upsList,
    )
    // 无产品配置时用默认比例估算本单
    let systemAmount = preview
    if (systemAmount <= 0 && !ppc) {
      const rate = person.salary?.personalCommissionRate || 0
      const th = person.salary?.personalCommissionThreshold || 0
      if (rate > 0 && billableBase > th) {
        systemAmount = billableBase * (rate / 100)
      }
    }
    if (ppc) {
      systemAmount = preview
      if ((sale.collaborators || []).length > 0 && billableBase > 0 && fullTotal > 0) {
        const netSale = {
          ...sale,
          totalAmount: costResolved.netAmount,
        }
        const fullPreview = calcSalePersonCommissionPreview(netSale, ppcList, upsList)
        const reward = calcSaleCommissionReward(sale, ppc)
        const baseFull = Math.max(0, fullPreview - reward)
        const netShareRatio = costResolved.netAmount > 0
          ? billableBase / costResolved.netAmount
          : shareRatio
        systemAmount = baseFull * netShareRatio + reward * shareRatio
      }
    }

    systemAmount = roundMoney(systemAmount)
    const adj = adjMap[sale.id] || null
    const applied = applyCommissionOrderAdj({
      orderAmount: billableBase,
      baseRatePct,
      systemAmount,
      commissionType,
      adj,
    })

    return {
      id: sale.id,
      saleId: sale.id,
      saleDate: (sale.saleDate || '').slice(0, 10),
      customerName: (sale.customerName || '').trim() || '—',
      productName: productNameOf(sale.productId, sale.productName),
      productId: sale.productId,
      activityName: (() => {
        const act = (sale.activityName || '').trim()
        return !act || act === '无活动' ? '' : act
      })(),
      orderAmount: roundMoney(orderAmount),
      costDeduction,
      systemCost: systemCostShare,
      costIsManual: costResolved.isManual,
      billableBase: roundMoney(billableBase),
      rateLabel,
      baseRatePct,
      commissionType,
      systemAmount,
      adj: hasCommissionOrderAdj(adj) ? adj : null,
      adjSummary: formatCommissionOrderAdjSummary(adj),
      amount: applied.amount,
    }
  })
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
  const systemPersonalTotal = roundMoney(calc.personalCommission || 0)
  const internalTotal = roundMoney(calc.internalSalesCommission || 0)
  const teamMgmtTotal = roundMoney(calc.managementCommission || 0)

  const adjMap = loadCommissionOrderAdjMap(yearMonth, personnelId, unitId)
  const lines = buildSaleRecordLines({
    person,
    unitId,
    yearMonth,
    salesRecords,
    products,
    ppcList: productPersonCommissions,
    upsList: unitProductSettlements,
    adjMap,
  })

  const hasOrderAdj = lines.some((l) => hasCommissionOrderAdj(l.adj))
  const lineSum = roundMoney(lines.reduce((s, l) => s + l.amount, 0))
  // 有单笔调整时：个人提成与明细行合计对齐；否则沿用系统月汇总
  const personalTotal = hasOrderAdj ? lineSum : systemPersonalTotal

  return {
    personnelId,
    personnelName: person.name,
    unitId,
    unitName,
    yearMonth,
    systemPersonalTotal,
    personalTotal,
    internalTotal,
    teamMgmtTotal,
    commissionTotal: roundMoney(personalTotal + internalTotal + teamMgmtTotal),
    personalSales: roundMoney(
      getPersonalSales(personnelId, unitScopedSales, person.name, products),
    ),
    hasOrderAdj,
    lines,
  }
}

/**
 * 工资表用：个人提成在有单笔调整时改为明细合计，再加内部销售+团队管理
 */
export function resolvePayrollCommissionTotal(options: {
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
  /** 系统已算好的三块提成（避免重复重算时可传入） */
  systemParts?: {
    personal: number
    internal: number
    teamMgmt: number
  }
}): {
  personal: number
  internal: number
  teamMgmt: number
  total: number
  hasOrderAdj: boolean
} {
  const adjMap = loadCommissionOrderAdjMap(
    options.yearMonth,
    options.personnelId,
    options.unitId,
  )
  const p = options.systemParts
  if (Object.keys(adjMap).length === 0 && p) {
    return {
      personal: p.personal || 0,
      internal: p.internal || 0,
      teamMgmt: p.teamMgmt || 0,
      total: roundMoney((p.personal || 0) + (p.internal || 0) + (p.teamMgmt || 0)),
      hasOrderAdj: false,
    }
  }

  const detail = buildPayrollCommissionDetail(options)
  if (!detail) {
    return {
      personal: p?.personal || 0,
      internal: p?.internal || 0,
      teamMgmt: p?.teamMgmt || 0,
      total: roundMoney((p?.personal || 0) + (p?.internal || 0) + (p?.teamMgmt || 0)),
      hasOrderAdj: false,
    }
  }
  return {
    personal: detail.personalTotal,
    internal: detail.internalTotal,
    teamMgmt: detail.teamMgmtTotal,
    total: detail.commissionTotal,
    hasOrderAdj: detail.hasOrderAdj,
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
