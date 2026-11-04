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

/** 配置是否有效（可启用分摊） */
export function isValidCostAllocationShares(
  shares: CostAllocationShare[],
  mode: CostAllocationMode = 'ratio',
): boolean {
  if (shares.length < 2) return false
  if (mode === 'fixedAmount') {
    return shares.every((r) => (Number(r.amount) || 0) > 0)
  }
  const sum = shares.reduce((s, r) => s + (Number(r.ratio) || 0), 0)
  return Math.abs(sum - 100) <= RATIO_SUM_TOLERANCE
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
  if (shares.length === 0 && monthOverrides.length === 0) return undefined
  return {
    mode,
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
 * - 配置金额之和 ≤ 总成本：各单位拿配置额，剩余归主单位
 * - 配置金额之和 > 总成本：按配置额等比缩放到总成本
 */
export function buildFixedAmountWeights(
  shares: CostAllocationShare[],
  primaryUnitId: string,
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

  const assigned = new Map<string, number>()
  if (sumConfigured > t) {
    const scale = t / sumConfigured
    for (const row of shares) {
      const amt = (Number(row.amount) || 0) * scale
      assigned.set(
        row.salesUnitId,
        (assigned.get(row.salesUnitId) || 0) + amt,
      )
    }
  } else {
    for (const row of shares) {
      const amt = Number(row.amount) || 0
      assigned.set(
        row.salesUnitId,
        (assigned.get(row.salesUnitId) || 0) + amt,
      )
    }
    const remainder = t - sumConfigured
    if (remainder > 0.0001) {
      const primary = primaryUnitId || shares[0].salesUnitId
      assigned.set(primary, (assigned.get(primary) || 0) + remainder)
    }
  }

  for (const [unitId, amt] of assigned) {
    weights.set(unitId, amt / t)
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
    // 尚不知总成本时：有配置额则先当作「有份额」占位（>0），真正拆分时再算
    const row = resolved.shares.find((s) => s.salesUnitId === unitId)
    if (row && (Number(row.amount) || 0) > 0) return 0.000001
    if (unitId === resolved.primaryUnitId) return 0.000001
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
  const ids = new Set(resolved.shares.map((s) => s.salesUnitId))
  if (resolved.mode === 'fixedAmount' && resolved.primaryUnitId) {
    ids.add(resolved.primaryUnitId)
  }
  return Array.from(ids)
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
