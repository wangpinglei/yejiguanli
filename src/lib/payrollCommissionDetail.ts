/** 工资核算 → 个人业绩提成明细（按销售记录逐单核对） */

import {
  calcSaleCommissionReward,
  calcSalePersonCommissionPreview,
  findProductPersonCommission,
} from '@/lib/commissionReward'
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
  /** 订单金额 / 本人业绩份额 */
  orderAmount: number
  /** 提成规则文案 */
  rateLabel: string
  /** 本单提成预估（含特殊奖励；月门槛可能与合计有细微差） */
  amount: number
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
  rewardAmount?: number
}): string {
  const type = opts.type || 'percentage'
  const parts: string[] = []
  if (type === 'fixed') {
    parts.push(`¥${Number(opts.amount || 0).toFixed(2)}/件`)
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
}): CommissionDetailLine[] {
  const { person, unitId, yearMonth, salesRecords, products, ppcList } = options
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
    let orderAmount = getPersonShareAmount(sale, person.id)
    if (orderAmount <= 0 && saleInvolvesPerson(sale, person.id, person.name)) {
      orderAmount = sale.totalAmount || 0
    }

    const ppc =
      findProductPersonCommission(ppcList, sale.productId, sale.salesUnitId, person.id)
      || findProductPersonCommission(ppcList, sale.productId, person.salesUnitId, person.id)

    let rateLabel = '未配置（走人员默认）'
    if (ppc) {
      rateLabel = formatRateLabel({
        type: ppc.personalCommissionType || 'percentage',
        rate: ppc.personalCommissionRate,
        amount: ppc.personalCommissionAmount,
        threshold: ppc.personalCommissionThreshold,
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
        totalAmount: orderAmount,
        saleDate: sale.saleDate,
      },
      ppcList,
    )
    // 无产品配置时用默认比例估算本单
    let amount = preview
    if (amount <= 0 && !ppc) {
      const rate = person.salary?.personalCommissionRate || 0
      const th = person.salary?.personalCommissionThreshold || 0
      if (rate > 0 && orderAmount > th) {
        // 行级不含月门槛分摊，仅作核对参考
        amount = orderAmount * (rate / 100)
      }
    }
    if (ppc) {
      amount = preview + 0 // reward already in preview
      // 若 preview 按全单人员 id 配置，分业绩时按份额重算比例部分
      if ((sale.collaborators || []).length > 0 && orderAmount > 0 && (sale.totalAmount || 0) > 0) {
        const fullPreview = calcSalePersonCommissionPreview(sale, ppcList)
        const reward = calcSaleCommissionReward(sale, ppc)
        const baseFull = Math.max(0, fullPreview - reward)
        const shareRatio = orderAmount / (sale.totalAmount || 1)
        amount = baseFull * shareRatio + reward * shareRatio
      }
    }

    return {
      id: sale.id,
      saleId: sale.id,
      saleDate: (sale.saleDate || '').slice(0, 10),
      customerName: (sale.customerName || '').trim() || '—',
      productName: productNameOf(sale.productId, sale.productName),
      productId: sale.productId,
      orderAmount,
      rateLabel,
      amount,
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
  const personalTotal = calc.personalCommission || 0
  const internalTotal = calc.internalSalesCommission || 0
  const teamMgmtTotal = calc.managementCommission || 0

  const lines = buildSaleRecordLines({
    person,
    unitId,
    yearMonth,
    salesRecords,
    products,
    ppcList: productPersonCommissions,
  })

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
