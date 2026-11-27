/** 活动默认成本扣除：配置规则 → 新建单时固化金额 */

import { normalizeSaleDate } from '@/lib/salesDuplicate'

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
  const day =
    normalizeSaleDate(saleDate ?? undefined) || normalizeRuleDate(saleDate)
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const start = normalizeRuleDate(rule.startDate)
  const end = normalizeRuleDate(rule.endDate)
  if (start && day < start) return false
  if (end && day > end) return false
  return true
}

export function normalizeActivityName(name: string | null | undefined): string {
  return String(name || '').trim()
}

/** 活动名比对：去首尾空白、忽略大小写与中间空格、统一括号 */
export function activityNameMatchKey(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
}

export function isBlankActivity(name: string | null | undefined): boolean {
  const n = normalizeActivityName(name)
  return !n || n === '无活动'
}

/** 列表「活动」列：去掉上游常见的「无活动,+活动名」拼接前缀 */
export function formatSaleActivityDisplayName(
  name: string | null | undefined,
): string {
  const n = normalizeActivityName(name)
  if (isBlankActivity(n)) return ''
  const stripped = n.replace(/^无活动[,，、]\s*/u, '').trim()
  if (!stripped || stripped === '无活动') return ''
  return stripped
}

export function saleRecordHasActivity(name: string | null | undefined): boolean {
  return formatSaleActivityDisplayName(name).length > 0
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * 按活动规则计算本单应扣成本（元）。
 * 无规则 / 无活动 → null（调用方继续走产品自动）。
 *
 * 实收不足以承担固定扣除额，或按比例会扣光实收时 → null（本单不直接扣，常见于定金）。
 */
export function calcActivityCostDeduction(
  rule: Pick<ActivityCostRule, 'costType' | 'costValue'> | null | undefined,
  orderAmount: number,
): number | null {
  if (!rule) return null
  const amount = Math.max(0, Number(orderAmount) || 0)
  if (amount <= 0) return null
  const value = Number(rule.costValue)
  if (!Number.isFinite(value) || value < 0) return null
  if (rule.costType === 'percentage') {
    const deducted = roundMoney(Math.min(amount, amount * (value / 100)))
    if (deducted >= amount) return null
    return deducted
  }
  if (amount <= value) return null
  return roundMoney(Math.min(amount, value))
}

export function findActivityCostRule(
  rules: ActivityCostRule[] | undefined,
  activityName: string | null | undefined,
): ActivityCostRule | undefined {
  if (isBlankActivity(activityName) || !rules?.length) return undefined
  const key = activityNameMatchKey(activityName)
  if (!key) return undefined
  return rules.find((r) => activityNameMatchKey(r.activityName) === key)
}

/**
 * 为单笔销售匹配活动成本规则：活动名（宽松）+ 成交日；
 * 名称未命中但该成交日仅有一条有效规则时兜底（同期唯一补贴）。
 */
export function findActivityCostRuleForSale(
  rules: ActivityCostRule[] | undefined,
  activityName: string | null | undefined,
  saleDate: string | null | undefined,
): ActivityCostRule | undefined {
  if (isBlankActivity(activityName) || !rules?.length) return undefined
  const exact = findActivityCostRule(rules, activityName)
  if (exact && isSaleDateInActivityRule(saleDate, exact)) return exact
  const dated = rules.filter((r) => isSaleDateInActivityRule(saleDate, r))
  if (dated.length === 1) return dated[0]
  return undefined
}
