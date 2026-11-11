/** 单位绩效评分规则：分项满分合成考核分 */

export interface PayrollScoreRuleItem {
  id: string
  name: string
  /** 该项满分，建议各项合计 100 */
  maxScore: number
}

export interface PayrollUnitScoreRule {
  unitId: string
  items: PayrollScoreRuleItem[]
}

export function createScoreRuleItemId(): string {
  return `si_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`
}

export function normalizeScoreRuleItems(raw: unknown): PayrollScoreRuleItem[] {
  if (!Array.isArray(raw)) return []
  const out: PayrollScoreRuleItem[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const id = String(row.id || '').trim()
    const name = String(row.name || '').trim()
    const maxScore = Number(row.maxScore)
    if (!id || !name || seen.has(id)) continue
    if (!Number.isFinite(maxScore) || maxScore <= 0) continue
    seen.add(id)
    out.push({
      id,
      name: name.slice(0, 40),
      maxScore: Math.min(100, Math.round(maxScore * 100) / 100),
    })
  }
  return out.slice(0, 12)
}

export function getScoreRuleItemsTotalMax(items: PayrollScoreRuleItem[]): number {
  return items.reduce((sum, item) => sum + (Number(item.maxScore) || 0), 0)
}

export function normalizeScoreItemScores(
  raw: unknown,
): Record<string, number | null> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number | null> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(id || '').trim()
    if (!key) continue
    if (value === null || value === undefined || value === '') {
      out[key] = null
      continue
    }
    const num = Number(value)
    out[key] = Number.isFinite(num) ? num : null
  }
  return out
}

/**
 * 按规则合成考核分。
 * - 各项均未填：返回 null（工资侧按 100 分）
 * - 有任一项填写：合计（每项封顶 maxScore），再夹到 0–100
 */
export function resolveScoreFromItems(
  items: PayrollScoreRuleItem[],
  scores: Record<string, number | null> | undefined,
): number | null {
  if (!items.length) return null
  const map = scores || {}
  let hasAny = false
  let total = 0
  for (const item of items) {
    const raw = map[item.id]
    if (raw === null || raw === undefined) continue
    const num = Number(raw)
    if (!Number.isFinite(num)) continue
    hasAny = true
    const capped = Math.min(Math.max(0, num), Number(item.maxScore) || 0)
    total += capped
  }
  if (!hasAny) return null
  return Math.min(100, Math.max(0, Math.round(total * 100) / 100))
}

export function formatScoreRuleSummary(items: PayrollScoreRuleItem[]): string {
  if (!items.length) return '未配置评分项（可直接填总分 0–100）'
  return items.map((item) => `${item.name} ${item.maxScore}`).join(' + ')
}
