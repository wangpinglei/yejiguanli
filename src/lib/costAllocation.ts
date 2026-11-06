/** 人员固定成本跨单位分摊（按比例 / 固定金额） */

import type {
  CostAllocationMode,
  CostAllocationShare,
  Personnel,
  PersonnelCostAllocation,
} from '@/types'

const RATIO_SUM_TOLERANCE = 0.05

/** 与 salary.isInternalEmployeePerson 同口径，避免循环依赖 */
function isInternalEmployeeForAllocation(
  person: Pick<Personnel, 'isInternalEmployee' | 'position'>,
): boolean {
  if (person.isInternalEmployee === false) return false
  if (person.isInternalEmployee === true) return true
  return !String(person.position || '').includes('分销')
}

export function normalizeCostAllocationMode(
  mode: unknown,
): CostAllocationMode {
  return mode === 'fixedAmount' ? 'fixedAmount' : 'ratio'
}

/** 规范化分摊行 */
export function normalizeCostAllocationShares(
  shares: CostAllocationShare[] | null | undefined,
  mode: CostAllocationMode = 'ratio',
): CostAllocationShare[] {
  if (!Array.isArray(shares)) return []
  if (mode === 'fixedAmount') {
    const map = new Map<string, number>()
    for (const row of shares) {
      const unitId = String(row?.salesUnitId || '').trim()
      const amount = Number(row?.amount ?? row?.ratio)
      if (!unitId || !Number.isFinite(amount) || amount <= 0) continue
      map.set(unitId, (map.get(unitId) || 0) + amount)
    }
    return Array.from(map.entries()).map(([salesUnitId, amount]) => ({
      salesUnitId,
      amount,
      ratio: 0,
    }))
  }
  const map = new Map<string, number>()
  for (const row of shares) {
    const unitId = String(row?.salesUnitId || '').trim()
    const ratio = Number(row?.ratio)
    if (!unitId || !Number.isFinite(ratio) || ratio <= 0) continue
    map.set(unitId, (map.get(unitId) || 0) + ratio)
  }
  return Array.from(map.entries()).map(([salesUnitId, ratio]) => ({
    salesUnitId,
    ratio,
    amount: 0,
  }))
}

/** 配置是否有效（可启用分摊）；允许仅 1 个单位（如成本全在 B=100%） */
export function isValidCostAllocationShares(
  shares: CostAllocationShare[],
  mode: CostAllocationMode = 'ratio',
): boolean {
  if (shares.length < 1) return false
  if (mode === 'fixedAmount') {
    return shares.every((r) => (Number(r.amount) || 0) > 0)
  }
  const sum = shares.reduce((s, r) => s + (Number(r.ratio) || 0), 0)
  return (
    shares.every((r) => (Number(r.ratio) || 0) > 0)
    && Math.abs(sum - 100) <= RATIO_SUM_TOLERANCE
  )
}

/** 校验失败时的中文原因（通过则返回空串） */
export function getCostAllocationSharesInvalidReason(
  shares: CostAllocationShare[],
  mode: CostAllocationMode = 'ratio',
): string {
  if (shares.length < 1) {
    return mode === 'fixedAmount'
      ? '固定金额分摊至少配置 1 个单位，且金额 > 0'
      : '比例分摊至少配置 1 个单位，且合计 100%'
  }
  if (mode === 'fixedAmount') {
    if (shares.some((r) => (Number(r.amount) || 0) <= 0)) {
      return '固定金额分摊每行金额须 > 0（不要填 0）'
    }
    return ''
  }
  if (shares.some((r) => (Number(r.ratio) || 0) <= 0)) {
    return '比例分摊每行比例须 > 0（不要填 0）'
  }
  const sum = shares.reduce((s, r) => s + (Number(r.ratio) || 0), 0)
  if (Math.abs(sum - 100) > RATIO_SUM_TOLERANCE) {
    return '比例分摊合计须为 100%（可只配成本单位 100%）'
  }
  return ''
}

export function parsePersonnelCostAllocation(
  raw: unknown,
): PersonnelCostAllocation | undefined {
  if (!raw) return undefined
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw || 'null')
    } catch {
      return undefined
    }
  }
  if (!obj || typeof obj !== 'object') return undefined
  const data = obj as PersonnelCostAllocation
  const mode = normalizeCostAllocationMode(data.mode)
  const shares = normalizeCostAllocationShares(data.shares, mode)
  const monthOverrides = Array.isArray(data.monthOverrides)
    ? data.monthOverrides
      .map((m) => {
        const mMode = normalizeCostAllocationMode(m?.mode ?? mode)
        return {
          yearMonth: String(m?.yearMonth || '').slice(0, 7),
          mode: mMode,
          shares: normalizeCostAllocationShares(m?.shares, mMode),
        }
      })
      .filter(
        (m) => m.yearMonth && isValidCostAllocationShares(m.shares, m.mode),
      )
    : []
  const effectiveFrom = String(data.effectiveFrom || '').slice(0, 7)
  if (shares.length === 0 && monthOverrides.length === 0) return undefined
  return {
    mode,
    effectiveFrom: /^\d{4}-\d{2}$/.test(effectiveFrom) ? effectiveFrom : undefined,
    shares: shares.length > 0 ? shares : undefined,
    monthOverrides: monthOverrides.length > 0 ? monthOverrides : undefined,
  }
}

export type ResolvedCostAllocation = {
  mode: CostAllocationMode
  shares: CostAllocationShare[]
  primaryUnitId: string
}

/**
 * 解析某人在指定月的有效分摊配置（月度覆盖优先）。
 * 未启用 / 非内部 / 校验失败 → null（走调岗按天）。
 */
export function resolveCostAllocation(
  person: Pick<
    Personnel,
    'isInternalEmployee' | 'position' | 'costAllocation' | 'salesUnitId'
  >,
  yearMonth?: string,
): ResolvedCostAllocation | null {
  if (!isInternalEmployeeForAllocation(person)) return null
  const cfg = person.costAllocation
  if (!cfg) return null
  const defaultMode = normalizeCostAllocationMode(cfg.mode)
  // 月度覆盖：指定月直接用覆盖配置（可早于生效月）
  if (yearMonth && Array.isArray(cfg.monthOverrides)) {
    const hit = cfg.monthOverrides.find((m) => m.yearMonth === yearMonth)
    if (hit) {
      const mode = normalizeCostAllocationMode(hit.mode ?? defaultMode)
      const shares = normalizeCostAllocationShares(hit.shares, mode)
      if (!isValidCostAllocationShares(shares, mode)) return null
      return {
        mode,
        shares,
        primaryUnitId: person.salesUnitId || '',
      }
    }
  }
  const shares = normalizeCostAllocationShares(cfg.shares, defaultMode)
  if (!isValidCostAllocationShares(shares, defaultMode)) return null
  // 默认分摊：未到生效月则不启用（走调岗按天）
  const effectiveFrom = String(cfg.effectiveFrom || '').slice(0, 7)
  if (
    yearMonth
    && /^\d{4}-\d{2}$/.test(effectiveFrom)
    && yearMonth < effectiveFrom
  ) {
    return null
  }
  return {
    mode: defaultMode,
    shares,
    primaryUnitId: person.salesUnitId || '',
  }
}

/** @deprecated 用 resolveCostAllocation */
export function resolveCostAllocationShares(
  person: Pick<
    Personnel,
    'isInternalEmployee' | 'position' | 'costAllocation' | 'salesUnitId'
  >,
  yearMonth?: string,
): CostAllocationShare[] | null {
  return resolveCostAllocation(person, yearMonth)?.shares ?? null
}

export function hasCostAllocation(
  person: Pick<
    Personnel,
    'isInternalEmployee' | 'position' | 'costAllocation' | 'salesUnitId'
  >,
  yearMonth?: string,
): boolean {
  return resolveCostAllocation(person, yearMonth) != null
}

/**
 * 把固定金额配置换成各单位权重（合计 1）。
 * 只在已配置单位之间分配，保证摊完：
 * - 配置合计 ≠ 总成本：按配置额等比缩放（放大或缩小）到总成本
 * - 不再把差额静默塞给主单位
 * @param _primaryUnitId 保留参数兼容旧调用，不再用于剩余归属
 */
export function buildFixedAmountWeights(
  shares: CostAllocationShare[],
  _primaryUnitId: string,
  totalFixed: number,
): Map<string, number> {
  const weights = new Map<string, number>()
  const t = Math.max(0, Number(totalFixed) || 0)
  if (t <= 0 || shares.length === 0) return weights

  let sumConfigured = 0
  for (const row of shares) {
    sumConfigured += Number(row.amount) || 0
  }
  if (sumConfigured <= 0) return weights

  const scale = t / sumConfigured
  for (const row of shares) {
    const amt = (Number(row.amount) || 0) * scale
    weights.set(
      row.salesUnitId,
      (weights.get(row.salesUnitId) || 0) + amt / t,
    )
  }
  return weights
}

/**
 * 某人在某单位的分摊权重（0~1）。
 * 固定金额模式需传入当月固定成本合计 totalFixed。
 * 未启用返回 null；启用但不含本单位返回 0。
 */
export function getCostAllocationRatioForUnit(
  person: Pick<
    Personnel,
    'isInternalEmployee' | 'position' | 'costAllocation' | 'salesUnitId'
  >,
  unitId: string,
  yearMonth?: string,
  totalFixed?: number,
): number | null {
  const resolved = resolveCostAllocation(person, yearMonth)
  if (!resolved) return null
  if (resolved.mode === 'ratio') {
    const row = resolved.shares.find((s) => s.salesUnitId === unitId)
    if (!row) return 0
    return (Number(row.ratio) || 0) / 100
  }
  const t = Number(totalFixed)
  if (!Number.isFinite(t) || t < 0) {
    // 尚不知总成本时：仅已配置单位占位，不把主单位算进来
    const row = resolved.shares.find((s) => s.salesUnitId === unitId)
    if (row && (Number(row.amount) || 0) > 0) return 0.000001
    return 0
  }
  const weights = buildFixedAmountWeights(
    resolved.shares,
    resolved.primaryUnitId,
    t,
  )
  return weights.get(unitId) ?? 0
}

export function getCostAllocationUnitIds(
  person: Pick<
    Personnel,
    'isInternalEmployee' | 'position' | 'costAllocation' | 'salesUnitId'
  >,
  yearMonth?: string,
): string[] {
  const resolved = resolveCostAllocation(person, yearMonth)
  if (!resolved) return []
  return Array.from(new Set(resolved.shares.map((s) => s.salesUnitId)))
}

/** 固定成本合计（用于固定金额权重） */
export function getFixedCostTotalForAllocation(parts: {
  baseSalary: number
  confidentialityFee: number
  performance: number
  positionAllowance: number
  leaveDeduction: number
  socialInsurance: number
  housingFund: number
}): number {
  return (
    (Number(parts.baseSalary) || 0)
    + (Number(parts.confidentialityFee) || 0)
    + (Number(parts.performance) || 0)
    + (Number(parts.positionAllowance) || 0)
    - (Number(parts.leaveDeduction) || 0)
    + (Number(parts.socialInsurance) || 0)
    + (Number(parts.housingFund) || 0)
  )
}
