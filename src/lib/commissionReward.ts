import { isSaleDateInRange, toDateOnly } from '@/lib/settlement'
import type { ProductPersonCommission, SalesRecord, SalesUnit } from '@/types'

/** 查找单位×产品×人员提成配置 */
export function findProductPersonCommission(
  list: ProductPersonCommission[],
  productId: string,
  unitId: string,
  personnelId: string,
): ProductPersonCommission | undefined {
  return list.find(
    (x) =>
      x.productId === productId
      && x.salesUnitId === unitId
      && x.personnelId === personnelId,
  )
}

/** 单笔销售命中的特殊提成奖励金额 */
export function calcSaleCommissionReward(
  sale: { quantity?: number; saleDate?: string },
  ppc?: ProductPersonCommission,
): number {
  if (!ppc || !(ppc.rewardAmount && ppc.rewardAmount > 0)) return 0
  if (sale.saleDate && !isSaleDateInRange(sale.saleDate, ppc.rewardFrom, ppc.rewardTo)) {
    return 0
  }
  return (ppc.rewardAmount || 0) * (sale.quantity || 0)
}

/**
 * 单笔销售的个人提成预估（行级展示用）
 * - fixed: 数量 × 每件提成
 * - percentage: 本单实收 × 比例%（门槛按月汇总，行级不含门槛扣减，仅作预览）
 * - 另加特殊时段按件奖励
 */
export function calcSaleInternalSalesCommissionPreview(
  sale: {
    productId: string
    salesUnitId: string
    personnelId: string
    quantity?: number
    totalAmount?: number
  },
  ppcList: ProductPersonCommission[],
): number {
  const ppc = findProductPersonCommission(
    ppcList,
    sale.productId,
    sale.salesUnitId,
    sale.personnelId,
  )
  if (!ppc) return 0

  if (ppc.internalSalesCommissionType === 'fixed') {
    return (sale.quantity || 0) * (ppc.internalSalesCommissionAmount || 0)
  }
  if ((ppc.internalSalesCommissionRate || 0) > 0) {
    return (sale.totalAmount || 0) * (ppc.internalSalesCommissionRate / 100)
  }
  return 0
}

export function calcSalePersonCommissionPreview(
  sale: {
    productId: string
    salesUnitId: string
    personnelId: string
    quantity?: number
    totalAmount?: number
    saleDate?: string
  },
  ppcList: ProductPersonCommission[],
): number {
  const ppc = findProductPersonCommission(
    ppcList,
    sale.productId,
    sale.salesUnitId,
    sale.personnelId,
  )
  if (!ppc) return 0

  let base = 0
  if (ppc.personalCommissionType === 'fixed') {
    base = (sale.quantity || 0) * (ppc.personalCommissionAmount || 0)
  } else if ((ppc.personalCommissionRate || 0) > 0) {
    base = (sale.totalAmount || 0) * (ppc.personalCommissionRate / 100)
  }
  return base + calcSaleCommissionReward(sale, ppc)
}

export function formatCommissionRewardPeriod(ppc?: ProductPersonCommission): string {
  if (!ppc || !(ppc.rewardAmount && ppc.rewardAmount > 0)) return ''
  const from = toDateOnly(ppc.rewardFrom) || '不限'
  const to = toDateOnly(ppc.rewardTo) || '不限'
  if (from === '不限' && to === '不限') return '长期'
  return `${from} ~ ${to}`
}

export type CommissionRewardHit = {
  sale: SalesRecord
  reward: number
  unitId: string
}

export type CommissionRewardUnitGroup = {
  unitId: string
  unitName: string
  hits: CommissionRewardHit[]
  totalQty: number
  totalAmount: number
  totalReward: number
}

/**
 * 按配置筛选命中特殊奖励的销售记录，并按销售单位分组
 */
export function groupCommissionRewardHits(options: {
  salesRecords: SalesRecord[]
  ppcList: ProductPersonCommission[]
  units: SalesUnit[]
  productId: string
  unitId?: string
  personnelId?: string
}): CommissionRewardUnitGroup[] {
  const { salesRecords, ppcList, units, productId, unitId, personnelId } = options
  const unitNameMap = new Map(units.map((u) => [u.id, u.name]))

  const hits: CommissionRewardHit[] = []
  for (const sale of salesRecords) {
    if (sale.productId !== productId) continue
    if (unitId && sale.salesUnitId !== unitId) continue
    if (personnelId && sale.personnelId !== personnelId) continue

    const ppc = findProductPersonCommission(
      ppcList,
      sale.productId,
      sale.salesUnitId,
      sale.personnelId,
    )
    const reward = calcSaleCommissionReward(sale, ppc)
    if (reward <= 0) continue
    hits.push({ sale, reward, unitId: sale.salesUnitId })
  }

  const groupMap = new Map<string, CommissionRewardUnitGroup>()
  for (const hit of hits) {
    let group = groupMap.get(hit.unitId)
    if (!group) {
      group = {
        unitId: hit.unitId,
        unitName: unitNameMap.get(hit.unitId) || hit.sale.salesUnitName || hit.unitId,
        hits: [],
        totalQty: 0,
        totalAmount: 0,
        totalReward: 0,
      }
      groupMap.set(hit.unitId, group)
    }
    group.hits.push(hit)
    group.totalQty += hit.sale.quantity || 0
    group.totalAmount += hit.sale.totalAmount || 0
    group.totalReward += hit.reward
  }

  return Array.from(groupMap.values()).sort((a, b) =>
    a.unitName.localeCompare(b.unitName, 'zh-CN'),
  )
}
