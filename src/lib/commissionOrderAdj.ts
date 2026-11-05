/** 工资业绩提成 — 单笔订单人工调整（本机） */

import { roundMoney } from '@/lib/format'

export const COMMISSION_ORDER_ADJ_STORAGE_KEY = 'pm_commission_order_adj'

/** 三类调整：业绩 / 比例百分点 / 提成金额 */
export type CommissionOrderAdj = {
  /** 计佣业绩加减（元），如 −1000 */
  salesAmountAdj: number
  /** 提成比例加减（百分点），如 +5 表示 +5% */
  rateAdjPct: number
  /** 提成金额加减（元） */
  commissionAmountAdj: number
  /** 说明 */
  note: string
}

export type CommissionOrderAdjMap = Record<string, CommissionOrderAdj>

function scopeKey(yearMonth: string, personnelId: string, unitId: string): string {
  return `${yearMonth}::${personnelId}::${unitId}`
}

export function createEmptyCommissionOrderAdj(): CommissionOrderAdj {
  return {
    salesAmountAdj: 0,
    rateAdjPct: 0,
    commissionAmountAdj: 0,
    note: '',
  }
}

export function hasCommissionOrderAdj(adj?: CommissionOrderAdj | null): boolean {
  if (!adj) return false
  return (
    Math.abs(Number(adj.salesAmountAdj) || 0) > 0.0005
    || Math.abs(Number(adj.rateAdjPct) || 0) > 0.0005
    || Math.abs(Number(adj.commissionAmountAdj) || 0) > 0.0005
    || Boolean((adj.note || '').trim())
  )
}

export function normalizeCommissionOrderAdj(
  raw?: Partial<CommissionOrderAdj> | null,
): CommissionOrderAdj {
  const base = createEmptyCommissionOrderAdj()
  if (!raw) return base
  return {
    salesAmountAdj: Number(raw.salesAmountAdj) || 0,
    rateAdjPct: Number(raw.rateAdjPct) || 0,
    commissionAmountAdj: Number(raw.commissionAmountAdj) || 0,
    note: String(raw.note || '').trim(),
  }
}

function loadAll(): Record<string, CommissionOrderAdjMap> {
  try {
    const raw = localStorage.getItem(COMMISSION_ORDER_ADJ_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, CommissionOrderAdjMap>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function loadCommissionOrderAdjMap(
  yearMonth: string,
  personnelId: string,
  unitId: string,
): CommissionOrderAdjMap {
  const all = loadAll()
  const scope = all[scopeKey(yearMonth, personnelId, unitId)] || {}
  const out: CommissionOrderAdjMap = {}
  for (const [saleId, adj] of Object.entries(scope)) {
    const n = normalizeCommissionOrderAdj(adj)
    if (hasCommissionOrderAdj(n)) out[saleId] = n
  }
  return out
}

export function saveCommissionOrderAdj(
  yearMonth: string,
  personnelId: string,
  unitId: string,
  saleId: string,
  adj: CommissionOrderAdj | null,
): CommissionOrderAdjMap {
  const all = loadAll()
  const key = scopeKey(yearMonth, personnelId, unitId)
  const scope = { ...(all[key] || {}) }
  const normalized = normalizeCommissionOrderAdj(adj)
  if (!hasCommissionOrderAdj(normalized)) {
    delete scope[saleId]
  } else {
    scope[saleId] = normalized
  }
  if (Object.keys(scope).length === 0) delete all[key]
  else all[key] = scope
  localStorage.setItem(COMMISSION_ORDER_ADJ_STORAGE_KEY, JSON.stringify(all))
  return loadCommissionOrderAdjMap(yearMonth, personnelId, unitId)
}

/** 摘要文案，用于单元格展示 */
export function formatCommissionOrderAdjSummary(adj?: CommissionOrderAdj | null): string {
  if (!hasCommissionOrderAdj(adj)) return ''
  const a = normalizeCommissionOrderAdj(adj)
  const parts: string[] = []
  if (Math.abs(a.salesAmountAdj) > 0.0005) {
    parts.push(`业绩${a.salesAmountAdj > 0 ? '+' : ''}${roundMoney(a.salesAmountAdj)}`)
  }
  if (Math.abs(a.rateAdjPct) > 0.0005) {
    parts.push(`比例${a.rateAdjPct > 0 ? '+' : ''}${a.rateAdjPct}%`)
  }
  if (Math.abs(a.commissionAmountAdj) > 0.0005) {
    parts.push(`提成${a.commissionAmountAdj > 0 ? '+' : ''}${roundMoney(a.commissionAmountAdj)}`)
  }
  if (a.note) parts.push(a.note)
  return parts.join('；')
}

/** 批注/悬停多行说明 */
export function formatCommissionOrderAdjComment(adj?: CommissionOrderAdj | null): string {
  if (!hasCommissionOrderAdj(adj)) return ''
  const a = normalizeCommissionOrderAdj(adj)
  const lines: string[] = []
  if (Math.abs(a.salesAmountAdj) > 0.0005) {
    lines.push(`业绩调整：${a.salesAmountAdj > 0 ? '+' : ''}${roundMoney(a.salesAmountAdj)}`)
  }
  if (Math.abs(a.rateAdjPct) > 0.0005) {
    lines.push(`比例调整：${a.rateAdjPct > 0 ? '+' : ''}${a.rateAdjPct}%`)
  }
  if (Math.abs(a.commissionAmountAdj) > 0.0005) {
    lines.push(
      `提成金额调整：${a.commissionAmountAdj > 0 ? '+' : ''}${roundMoney(a.commissionAmountAdj)}`,
    )
  }
  if (a.note) lines.push(`说明：${a.note}`)
  return lines.join('\n')
}

export type ApplyCommissionAdjInput = {
  /** 本人订单/份额金额 */
  orderAmount: number
  /** 原提成比例 %；fixed 时可为 0 */
  baseRatePct: number
  /** 系统原提成（未调整） */
  systemAmount: number
  /** fixed 时：数量×单价已含奖励的系统额，仍用 systemAmount 作底 */
  commissionType: 'percentage' | 'fixed'
  adj?: CommissionOrderAdj | null
}

export type ApplyCommissionAdjResult = {
  billableSales: number
  effectiveRatePct: number
  amount: number
  delta: number
}

/**
 * 计佣业绩 = max(0, 订单金额 + 业绩调整)
 * 有效比例 = 原比例 + 比例调整
 * percentage: 提成 = 计佣业绩 × 有效比例% + 提成金额调整
 *   （保留「系统额相对原单」的奖励差：system − order×baseRate，再按份额近似）
 * fixed: 提成 = 系统额 + 提成金额调整（业绩/比例调整折算进金额）
 */
export function applyCommissionOrderAdj(
  input: ApplyCommissionAdjInput,
): ApplyCommissionAdjResult {
  const adj = normalizeCommissionOrderAdj(input.adj)
  const orderAmount = Number(input.orderAmount) || 0
  const baseRatePct = Number(input.baseRatePct) || 0
  const systemAmount = Number(input.systemAmount) || 0
  const billableSales = roundMoney(Math.max(0, orderAmount + adj.salesAmountAdj))
  const effectiveRatePct = baseRatePct + adj.rateAdjPct

  let amount = systemAmount
  if (input.commissionType === 'fixed') {
    // 固定额：系统提成 + 业绩调整×原比例折算 + 订单×比例调整折算 + 提成金额调整
    const salesDeltaAsMoney = adj.salesAmountAdj * (baseRatePct / 100)
    const rateDeltaAsMoney = orderAmount * (adj.rateAdjPct / 100)
    amount = roundMoney(
      systemAmount + salesDeltaAsMoney + rateDeltaAsMoney + adj.commissionAmountAdj,
    )
  } else {
    const rewardExtra = roundMoney(
      systemAmount - orderAmount * (baseRatePct / 100),
    )
    amount = roundMoney(
      billableSales * (effectiveRatePct / 100)
      + rewardExtra
      + adj.commissionAmountAdj,
    )
  }

  return {
    billableSales,
    effectiveRatePct,
    amount,
    delta: roundMoney(amount - systemAmount),
  }
}
