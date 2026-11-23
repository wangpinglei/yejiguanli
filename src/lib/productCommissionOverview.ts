import { formatCurrency, roundMoney } from '@/lib/format'
import {
  calcSalePersonCommissionPreview,
  findProductPersonCommission,
  formatCommissionRewardPeriod,
} from '@/lib/commissionReward'
import {
  canApplyPersonalCommissionTiers,
  formatPersonalCommissionTiersLabel,
  hasPersonalCommissionTiers,
} from '@/lib/personalCommissionTiers'
import { filterByMonth } from '@/lib/salary'
import { getPersonShareAmount, getSaleShares, scaleSaleForPerson } from '@/lib/saleCollaborators'
import type {
  Personnel,
  ProductPersonCommission,
  SalesRecord,
  SalesUnit,
  UnitProductSettlement,
} from '@/types'

export type ProductCommissionOverviewRow = {
  unitId: string
  unitName: string
  personnelId: string
  personName: string
  position: string
  ppc?: ProductPersonCommission
  ruleSummary: string
  monthProductSales: number
  commissionEstimate: number
}

function rowKey(unitId: string, personnelId: string): string {
  return `${unitId}|${personnelId}`
}

export function formatProductPersonCommissionRuleSummary(
  ppc: ProductPersonCommission | undefined,
  ups?: UnitProductSettlement,
): string {
  if (!ppc) return '未配置'
  const hasTiers = canApplyPersonalCommissionTiers({
    personalCommissionType: ppc.personalCommissionType,
    tiers: ppc.personalCommissionTiers,
    ups,
  })
  const tierLabel = formatPersonalCommissionTiersLabel(ppc.personalCommissionTiers)
  let base: string
  if (ppc.personalCommissionType === 'fixed') {
    base = `按件 ${formatCurrency(ppc.personalCommissionAmount || 0)}`
  } else if (hasTiers && tierLabel) {
    base = `梯度 ${tierLabel}`
  } else if ((ppc.personalCommissionRate || 0) > 0) {
    base = `比例 ${ppc.personalCommissionRate}%` +
      ((ppc.personalCommissionThreshold || 0) > 0
        ? `（门槛 ${formatCurrency(ppc.personalCommissionThreshold)}）`
        : '')
  } else if (hasPersonalCommissionTiers(ppc.personalCommissionTiers)) {
    base = `梯度 ${tierLabel || '已设档'}`
  } else {
    base = '未设置个人比例/按件'
  }
  const rewardPeriod = formatCommissionRewardPeriod(ppc)
  const reward =
    (ppc.rewardAmount || 0) > 0
      ? `；奖励 ${formatCurrency(ppc.rewardAmount || 0)}/件${rewardPeriod ? `（${rewardPeriod}）` : ''}`
      : ''
  return base + reward
}

function calcMonthCommissionEstimate(options: {
  monthlySales: SalesRecord[]
  productId: string
  unitId: string
  personnelId: string
  ppcList: ProductPersonCommission[]
  upsList: UnitProductSettlement[]
}): number {
  const { monthlySales, productId, unitId, personnelId, ppcList, upsList } = options
  return monthlySales
    .filter((s) => s.productId === productId && s.salesUnitId === unitId)
    .reduce((sum, sale) => {
      if (getPersonShareAmount(sale, personnelId) <= 0) return sum
      const scaled = scaleSaleForPerson(sale, personnelId)
      if (!scaled) return sum
      return roundMoney(sum + calcSalePersonCommissionPreview(scaled, ppcList, upsList))
    }, 0)
}

function calcMonthProductSalesInUnit(
  monthlySales: SalesRecord[],
  productId: string,
  unitId: string,
  personnelId: string,
): number {
  return roundMoney(
    monthlySales
      .filter((s) => s.productId === productId && s.salesUnitId === unitId)
      .reduce((sum, s) => sum + getPersonShareAmount(s, personnelId), 0),
  )
}

/** 选定产品 × 月份：单位×人员的规则摘要、分摊销售额与提成预估 */
export function buildProductCommissionOverviewRows(options: {
  productId: string
  yearMonth: string
  salesRecords: SalesRecord[]
  ppcList: ProductPersonCommission[]
  upsList: UnitProductSettlement[]
  personnel: Personnel[]
  units: SalesUnit[]
  /** 无权限单位时剔除 */
  allowedUnitIds?: Set<string>
}): ProductCommissionOverviewRow[] {
  const {
    productId,
    yearMonth,
    salesRecords,
    ppcList,
    upsList,
    personnel,
    units,
    allowedUnitIds,
  } = options
  if (!productId) return []

  const unitNameOf = (id: string) =>
    units.find((u) => u.id === id)?.name || id || '未知单位'
  const personOf = (id: string) => personnel.find((p) => p.id === id)

  const monthlySales = filterByMonth(salesRecords, yearMonth)
  const productMonthSales = monthlySales.filter((s) => s.productId === productId)

  const keys = new Set<string>()

  ppcList
    .filter((x) => x.productId === productId)
    .forEach((ppc) => {
      if (allowedUnitIds && !allowedUnitIds.has(ppc.salesUnitId)) return
      keys.add(rowKey(ppc.salesUnitId, ppc.personnelId))
    })

  for (const sale of productMonthSales) {
    if (allowedUnitIds && !allowedUnitIds.has(sale.salesUnitId)) continue
    const candidateIds = new Set<string>()
    if (sale.personnelId) candidateIds.add(sale.personnelId)
    getSaleShares(sale).forEach((c) => {
      if (c.personnelId) candidateIds.add(c.personnelId)
    })
    candidateIds.forEach((pid) => {
      if (getPersonShareAmount(sale, pid) > 0) {
        keys.add(rowKey(sale.salesUnitId, pid))
      }
    })
  }

  const rows: ProductCommissionOverviewRow[] = []
  keys.forEach((key) => {
    const [unitId, personnelId] = key.split('|')
    const person = personOf(personnelId)
    const ppc =
      findProductPersonCommission(ppcList, productId, unitId, personnelId)
      || ppcList.find(
        (x) =>
          x.productId === productId
          && x.personnelId === personnelId
          && x.salesUnitId === (person?.salesUnitId || ''),
      )
    const ups = upsList.find(
      (x) => x.productId === productId && x.salesUnitId === unitId,
    )
    const monthProductSales = calcMonthProductSalesInUnit(
      monthlySales,
      productId,
      unitId,
      personnelId,
    )
    const commissionEstimate = calcMonthCommissionEstimate({
      monthlySales,
      productId,
      unitId,
      personnelId,
      ppcList,
      upsList,
    })
    rows.push({
      unitId,
      unitName: unitNameOf(unitId),
      personnelId,
      personName: person?.name || personnelId,
      position: person?.position || '',
      ppc,
      ruleSummary: formatProductPersonCommissionRuleSummary(ppc, ups),
      monthProductSales,
      commissionEstimate,
    })
  })

  rows.sort((a, b) => {
    const u = a.unitName.localeCompare(b.unitName, 'zh-CN')
    if (u !== 0) return u
    return a.personName.localeCompare(b.personName, 'zh-CN')
  })
  return rows
}