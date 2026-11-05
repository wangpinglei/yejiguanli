import type { PersonalCommissionTier } from '@/types'

/** 规范化并排序；无效项丢弃 */
export function normalizePersonalCommissionTiers(
  tiers?: PersonalCommissionTier[] | null,
): PersonalCommissionTier[] {
  if (!Array.isArray(tiers) || tiers.length === 0) return []
  return tiers
    .map((t) => ({
      minSalesAmount: Math.max(0, Number(t?.minSalesAmount) || 0),
      ratePercent: Math.max(0, Number(t?.ratePercent) || 0),
    }))
    .sort((a, b) => a.minSalesAmount - b.minSalesAmount)
}

/** 是否启用梯度（未设置 / 空 = 不改变原比例+门槛逻辑） */
export function hasPersonalCommissionTiers(
  tiers?: PersonalCommissionTier[] | null,
): boolean {
  return normalizePersonalCommissionTiers(tiers).length > 0
}

/**
 * 按累计业绩取整段定档比例；无梯度返回 null。
 * 取「最低业绩 ≤ 累计」中最高档的 ratePercent。
 */
export function resolvePersonalTierRatePercent(
  salesAmount: number,
  tiers?: PersonalCommissionTier[] | null,
): number | null {
  const list = normalizePersonalCommissionTiers(tiers)
  if (list.length === 0) return null
  const sales = Number(salesAmount) || 0
  let rate = list[0].ratePercent
  for (const t of list) {
    if (sales >= t.minSalesAmount) rate = t.ratePercent
  }
  return rate
}

/**
 * 有梯度：累计业绩 × 命中档比例%。
 * 无梯度：返回 null（调用方走原逻辑）。
 */
export function calcPersonalCommissionByTiers(
  salesAmount: number,
  tiers?: PersonalCommissionTier[] | null,
): number | null {
  const rate = resolvePersonalTierRatePercent(salesAmount, tiers)
  if (rate == null) return null
  const sales = Number(salesAmount) || 0
  if (sales <= 0 || rate <= 0) return 0
  return sales * (rate / 100)
}

export function formatPersonalCommissionTiersLabel(
  tiers?: PersonalCommissionTier[] | null,
): string {
  const list = normalizePersonalCommissionTiers(tiers)
  if (list.length === 0) return ''
  return list
    .map((t) => `≥${t.minSalesAmount}→${t.ratePercent}%`)
    .join('；')
}

/** DB JSON 列读写 */
export function serializePersonalCommissionTiers(
  tiers?: PersonalCommissionTier[] | null,
): string {
  const list = normalizePersonalCommissionTiers(tiers)
  return list.length > 0 ? JSON.stringify(list) : ''
}

export function parsePersonalCommissionTiers(raw: unknown): PersonalCommissionTier[] {
  if (Array.isArray(raw)) return normalizePersonalCommissionTiers(raw as PersonalCommissionTier[])
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return normalizePersonalCommissionTiers(parsed)
  } catch {
    return []
  }
}
