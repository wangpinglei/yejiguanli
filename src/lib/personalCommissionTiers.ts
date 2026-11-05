import type { PersonalCommissionTier, UnitProductSettlement } from '@/types'

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
 * 梯度不适用原因；null = 可以应用（仍需有档位才真正启用）。
 * 按件提成、按件结算、不计入业绩 → 一律不走梯度，保持原提成。
 */
export function getPersonalCommissionTiersBlockReason(opts: {
  personalCommissionType?: 'percentage' | 'fixed' | string | null
  ups?: Pick<UnitProductSettlement, 'excludeFromPerformance' | 'settlementType'> | null
}): string | null {
  if ((opts.personalCommissionType || 'percentage') === 'fixed') {
    return '按件提成不适用业绩梯度，保持原按件金额'
  }
  if (opts.ups?.settlementType === 'fixed') {
    return '按件结算产品不适用业绩梯度，提成保持原规则'
  }
  if (opts.ups?.excludeFromPerformance) {
    return '不计入业绩的产品不适用业绩梯度，提成保持原规则'
  }
  return null
}

/**
 * 是否允许对某产品配置应用业绩梯度。
 * 按件提成、按件结算、不计入业绩 → 一律不走梯度，保持原提成。
 */
export function canApplyPersonalCommissionTiers(opts: {
  personalCommissionType?: 'percentage' | 'fixed' | string | null
  tiers?: PersonalCommissionTier[] | null
  ups?: Pick<UnitProductSettlement, 'excludeFromPerformance' | 'settlementType'> | null
}): boolean {
  if (!hasPersonalCommissionTiers(opts.tiers)) return false
  if (getPersonalCommissionTiersBlockReason(opts)) return false
  return true
}

/** 保存时：不适用梯度则清空，避免脏配置 */
export function sanitizePersonalCommissionTiersForSave(opts: {
  personalCommissionType?: 'percentage' | 'fixed' | string | null
  tiers?: PersonalCommissionTier[] | null
  ups?: Pick<UnitProductSettlement, 'excludeFromPerformance' | 'settlementType'> | null
}): PersonalCommissionTier[] {
  if (getPersonalCommissionTiersBlockReason(opts)) return []
  return normalizePersonalCommissionTiers(opts.tiers)
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
 * 无梯度 / 不适用：返回 null（调用方走原逻辑）。
 */
export function calcPersonalCommissionByTiers(
  salesAmount: number,
  tiers?: PersonalCommissionTier[] | null,
  opts?: {
    personalCommissionType?: 'percentage' | 'fixed' | string | null
    ups?: Pick<UnitProductSettlement, 'excludeFromPerformance' | 'settlementType'> | null
  },
): number | null {
  if (
    opts &&
    !canApplyPersonalCommissionTiers({
      personalCommissionType: opts.personalCommissionType,
      tiers,
      ups: opts.ups,
    })
  ) {
    return null
  }
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
