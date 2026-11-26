/**
 * 产品结算核对：记佣金额（实收−业绩扣除）× 结算比例；单位手工实际按预估占比分摊。
 */
import { filterByMonth } from '@/lib/salary'
import { roundMoney } from '@/lib/format'
import { findProductById, resolveOrderCostDeduction } from '@/lib/orderCostBase'
import { buildUnitScopedSalesRecords } from '@/lib/saleCollaborators'
import {
  calcSaleSettlementIncome,
  calcSaleSettlementReward,
  calcSaleSettlementBase,
  findUnitProductSettlement,
  formatSaleSettlementRatioForSale,
} from '@/lib/settlement'
import type {
  Personnel,
  Product,
  RevenueSettlement,
  SalesRecord,
  SalesUnit,
  UnitProductSettlement,
} from '@/types'

export type SaleSettlementLine = {
  saleId: string
  saleDate: string
  customerName: string
  productName: string
  salesPersonName: string
  orderAmount: number
  receivedAmount: number
  performanceDeduction: number
  commissionBase: number
  settlementRatioLabel: string
  estimatedSettlement: number
  actualSettlement: number
  synced: boolean
  orderNumber: string
}

export type UnitSettlementBlock = {
  unit: SalesUnit
  lines: SaleSettlementLine[]
  estimatedTotal: number
  actualTotal: number
  isAdjusted: boolean
  settlement?: RevenueSettlement
}

function proportionalOrderAmount(full: SalesRecord, scaled: SalesRecord): number {
  const fullRecv = Number(full.totalAmount) || 0
  const scaledRecv = Number(scaled.totalAmount) || 0
  const orderAmt = Number(full.orderAmount)
  if (orderAmt > 0 && fullRecv > 0) {
    return roundMoney(orderAmt * (scaledRecv / fullRecv))
  }
  if (orderAmt > 0) return roundMoney(orderAmt)
  return scaledRecv
}

function buildLine(
  full: SalesRecord,
  scaled: SalesRecord,
  personnel: Personnel[],
  products: Product[],
  upsList: UnitProductSettlement[],
): SaleSettlementLine {
  const product = findProductById(products, scaled.productId)
  const { cost, netAmount } = resolveOrderCostDeduction(scaled, product)
  const received = Number(scaled.totalAmount) || 0
  const person = personnel.find((p) => p.id === scaled.personnelId)
  const ups = findUnitProductSettlement(
    upsList,
    scaled.productId,
    scaled.salesUnitId,
    scaled.saleDate,
  )
  const estimated =
    calcSaleSettlementBase(scaled, ups, product)
    + calcSaleSettlementReward(scaled, ups)

  return {
    saleId: scaled.id,
    saleDate: (scaled.saleDate || '').slice(0, 10),
    customerName: scaled.customerName || full.customerName || '',
    productName: scaled.productName || product?.name || '',
    salesPersonName: person?.name || scaled.salesPersonName || '',
    orderAmount: proportionalOrderAmount(full, scaled),
    receivedAmount: roundMoney(received),
    performanceDeduction: roundMoney(cost),
    commissionBase: roundMoney(netAmount),
    settlementRatioLabel: formatSaleSettlementRatioForSale(scaled, upsList),
    estimatedSettlement: roundMoney(estimated),
    actualSettlement: roundMoney(estimated),
    synced: Boolean(scaled.synced),
    orderNumber: scaled.orderNumber || scaled.externalOrderId || full.externalOrderId || '',
  }
}

function distributeActual(lines: SaleSettlementLine[], unitActual: number): void {
  const est = lines.reduce((s, l) => s + l.estimatedSettlement, 0)
  if (!lines.length) return
  if (Math.abs(est) < 0.005) {
    lines.forEach((l) => {
      l.actualSettlement = 0
    })
    return
  }
  let allocated = 0
  for (let i = 0; i < lines.length; i++) {
    if (i === lines.length - 1) {
      lines[i].actualSettlement = roundMoney(unitActual - allocated)
    } else {
      const v = roundMoney(unitActual * (lines[i].estimatedSettlement / est))
      lines[i].actualSettlement = v
      allocated += v
    }
  }
}

export function buildUnitSettlementBlocks(options: {
  salesUnits: SalesUnit[]
  salesRecords: SalesRecord[]
  personnel: Personnel[]
  products: Product[]
  upsList: UnitProductSettlement[]
  revenueSettlements: RevenueSettlement[]
  yearMonth: string
  unitFilterIds: string[] | null
}): UnitSettlementBlock[] {
  const {
    salesUnits,
    salesRecords,
    personnel,
    products,
    upsList,
    revenueSettlements,
    yearMonth,
    unitFilterIds,
  } = options

  const monthly = filterByMonth(salesRecords, yearMonth)
  const byId = new Map(salesRecords.map((s) => [s.id, s]))
  const units =
    unitFilterIds && unitFilterIds.length > 0
      ? salesUnits.filter((u) => unitFilterIds.includes(u.id))
      : salesUnits

  return units.map((unit) => {
    const scoped = buildUnitScopedSalesRecords(monthly, unit.id, personnel)
    const lines: SaleSettlementLine[] = []
    for (const scaled of scoped) {
      const full = byId.get(scaled.id) || scaled
      lines.push(buildLine(full, scaled, personnel, products, upsList))
    }
    lines.sort(
      (a, b) => b.saleDate.localeCompare(a.saleDate) || a.saleId.localeCompare(b.saleId),
    )

    const estimatedTotal = roundMoney(
      lines.reduce((s, l) => s + l.estimatedSettlement, 0),
    )
    const settlement = revenueSettlements.find(
      (r) => r.salesUnitId === unit.id && r.yearMonth === yearMonth,
    )
    const isAdjusted = Boolean(
      settlement?.isAdjusted && settlement.actualAmount != null,
    )
    const actualTotal = isAdjusted
      ? roundMoney(Number(settlement!.actualAmount))
      : estimatedTotal

    if (isAdjusted && estimatedTotal > 0 && Math.abs(actualTotal - estimatedTotal) > 0.005) {
      distributeActual(lines, actualTotal)
    } else {
      lines.forEach((l) => {
        l.actualSettlement = l.estimatedSettlement
      })
    }

    return {
      unit,
      lines,
      estimatedTotal,
      actualTotal,
      isAdjusted,
      settlement,
    }
  })
}

/** 单笔校验用（与列表记佣一致） */
export function previewSettlementForRecord(
  sale: SalesRecord,
  upsList: UnitProductSettlement[],
  product?: Product | null,
): { commissionBase: number; estimated: number; ratio: string } {
  const base = resolveOrderCostDeduction(sale, product)
  return {
    commissionBase: base.netAmount,
    estimated: calcSaleSettlementIncome(sale, upsList, product ?? undefined),
    ratio: formatSaleSettlementRatioForSale(sale, upsList),
  }
}