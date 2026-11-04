/** 人员固定成本跨单位比例分摊 */

import type {
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

/** 规范化分摊行：去掉空单位与非法比例 */
export function normalizeCostAllocationShares(
  shares: CostAllocationShare[] | null | undefined,
): CostAllocationShare[] {
  if (!Array.isArray(shares)) return []
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
  }))
}

/** 比例合计是否≈100 */
export function isValidCostAllocationShares(
  shares: CostAllocationShare[],
): boolean {
  if (shares.length < 2) return false
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
  const shares = normalizeCostAllocationShares(data.shares)
  const monthOverrides = Array.isArray(data.monthOverrides)
    ? data.monthOverrides
      .map((m) => ({
        yearMonth: String(m?.yearMonth || '').slice(0, 7),
        shares: normalizeCostAllocationShares(m?.shares),
      }))
      .filter((m) => m.yearMonth && isValidCostAllocationShares(m.shares))
    : []
  if (shares.length === 0 && monthOverrides.length === 0) return undefined
  return {
    shares: shares.length > 0 ? shares : undefined,
    monthOverrides: monthOverrides.length > 0 ? monthOverrides : undefined,
  }
}

/**
 * 解析某人在指定月的有效分摊（月度覆盖优先）。
 * 未启用 / 非内部 / 校验失败 → null（走调岗按天）。
 */
export function resolveCostAllocationShares(
  person: Pick<Personnel, 'isInternalEmployee' | 'position' | 'costAllocation'>,
  yearMonth?: string,
): CostAllocationShare[] | null {
  if (!isInternalEmployeeForAllocation(person)) return null
  const cfg = person.costAllocation
  if (!cfg) return null
  if (yearMonth && Array.isArray(cfg.monthOverrides)) {
    const hit = cfg.monthOverrides.find((m) => m.yearMonth === yearMonth)
    if (hit) {
      const shares = normalizeCostAllocationShares(hit.shares)
      return isValidCostAllocationShares(shares) ? shares : null
    }
  }
  const shares = normalizeCostAllocationShares(cfg.shares)
  return isValidCostAllocationShares(shares) ? shares : null
}

/** 是否对该人启用了比例分摊 */
export function hasCostAllocation(
  person: Pick<Personnel, 'isInternalEmployee' | 'position' | 'costAllocation'>,
  yearMonth?: string,
): boolean {
  return resolveCostAllocationShares(person, yearMonth) != null
}

/** 某人在某单位的分摊比例（0~1）；未启用返回 null */
export function getCostAllocationRatioForUnit(
  person: Pick<Personnel, 'isInternalEmployee' | 'position' | 'costAllocation'>,
  unitId: string,
  yearMonth?: string,
): number | null {
  const shares = resolveCostAllocationShares(person, yearMonth)
  if (!shares) return null
  const row = shares.find((s) => s.salesUnitId === unitId)
  if (!row) return 0
  return (Number(row.ratio) || 0) / 100
}

/** 某人分摊涉及的单位 id 列表 */
export function getCostAllocationUnitIds(
  person: Pick<Personnel, 'isInternalEmployee' | 'position' | 'costAllocation'>,
  yearMonth?: string,
): string[] {
  const shares = resolveCostAllocationShares(person, yearMonth)
  if (!shares) return []
  return shares.map((s) => s.salesUnitId)
}
