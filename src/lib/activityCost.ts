/** 活动默认成本扣除：配置规则 → 新建单时固化金额 */

export type ActivityCostType = 'fixed' | 'percentage'

export type ActivityCostRule = {
  activityName: string
  costType: ActivityCostType
  costValue: number
  updatedBy?: string
  updatedById?: string
  updatedAt?: string
}

export function normalizeActivityName(name: string | null | undefined): string {
  return String(name || '').trim()
}

export function isBlankActivity(name: string | null | undefined): boolean {
  const n = normalizeActivityName(name)
  return !n || n === '无活动'
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * 按活动规则计算本单应扣成本（元）。
 * 无规则 / 无活动 → null（调用方继续走产品自动）。
 */
export function calcActivityCostDeduction(
  rule: Pick<ActivityCostRule, 'costType' | 'costValue'> | null | undefined,
  orderAmount: number,
): number | null {
  if (!rule) return null
  const amount = Math.max(0, Number(orderAmount) || 0)
  const value = Number(rule.costValue)
  if (!Number.isFinite(value) || value < 0) return null
  if (rule.costType === 'percentage') {
    return roundMoney(Math.min(amount, amount * (value / 100)))
  }
  return roundMoney(Math.min(amount, value))
}

export function findActivityCostRule(
  rules: ActivityCostRule[] | undefined,
  activityName: string | null | undefined,
): ActivityCostRule | undefined {
  if (isBlankActivity(activityName) || !rules?.length) return undefined
  const key = normalizeActivityName(activityName)
  return rules.find((r) => normalizeActivityName(r.activityName) === key)
}
