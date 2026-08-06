import { isSaleDateInRange, toDateOnly } from '@/lib/settlement'
import type { ProductPersonCommission, SalesRecord, SalesUnit } from '@/types'

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

    const ppc = ppcList.find(
      (x) =>
        x.productId === sale.productId
        && x.salesUnitId === sale.salesUnitId
        && x.personnelId === sale.personnelId,
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
