/** 活动默认成本扣除：配置规则 → 新建单时固化金额 */

export type ActivityCostType = 'fixed' | 'percentage'

export type ActivityCostRule = {
  activityName: string
  costType: ActivityCostType
  costValue: number
  startDate?: string
  endDate?: string
  updatedBy?: string
  updatedById?: string
  updatedAt?: string
}

export function normalizeRuleDate(value: string | null | undefined): string {
  const s = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

/** 成交日是否在规则有效期内；起/止为空则该侧不限 */
export function isSaleDateInActivityRule(
  saleDate: string | null | undefined,
  rule: Pick<ActivityCostRule, 'startDate' | 'endDate'>,
): boolean {
  const day = normalizeRuleDate(saleDate)
  if (!day) return false
  const start = normalizeRuleDate(rule.startDate)
  const end = normalizeRuleDate(rule.endDate)
  if (start && day < start) return false
  if (end && day > end) return false
  return true
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
