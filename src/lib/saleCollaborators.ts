import type { SalesRecord, SaleCollaborator, SaleShareMode } from '@/types'

export type { SaleCollaborator, SaleShareMode }

const EPS = 0.01

export type ParsedPerformanceSplit = {
  mode: SaleShareMode
  shares: SaleCollaborator[]
}

/** 兼容旧版纯数组，以及 { mode, shares } */
export function parseCollaboratorsJson(raw: unknown): ParsedPerformanceSplit | undefined {
  if (raw == null || raw === '') return undefined
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return undefined
    }
  }

  let mode: SaleShareMode = 'percent'
  let arr: unknown = data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    if (obj.mode === 'amount' || obj.mode === 'percent') {
      mode = obj.mode
    }
    arr = obj.shares
  }
  if (!Array.isArray(arr) || arr.length === 0) return undefined

  const list: SaleCollaborator[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const personnelId = String(row.personnelId || '').trim()
    if (!personnelId) continue
    const sharePercent = Number(row.sharePercent)
    const shareAmount = Number(row.shareAmount)
    list.push({
      personnelId,
      salesUnitId: String(row.salesUnitId || '').trim() || undefined,
      sharePercent: Number.isFinite(sharePercent) ? sharePercent : undefined,
      shareAmount: Number.isFinite(shareAmount) ? shareAmount : undefined,
    })
  }
  if (list.length === 0) return undefined
  return { mode, shares: list }
}

/** 从销售记录取出分摊列表（兼容旧数据） */
export function getSaleShares(
  sale: Pick<SalesRecord, 'collaborators' | 'shareMode'>,
): SaleCollaborator[] {
  return sale.collaborators || []
}

export function getSaleShareMode(
  sale: Pick<SalesRecord, 'shareMode' | 'collaborators'>,
): SaleShareMode {
  if (sale.shareMode === 'amount' || sale.shareMode === 'percent') return sale.shareMode
  return 'percent'
}

export function serializePerformanceSplit(
  mode: SaleShareMode,
  shares: SaleCollaborator[] | undefined | null,
): string {
  if (!shares || shares.length === 0) return ''
  return JSON.stringify({ mode, shares })
}

export function getCollaboratorsShareSum(list: SaleCollaborator[]): number {
  return list.reduce((sum, c) => sum + (Number(c.sharePercent) || 0), 0)
}

export function getCollaboratorsAmountSum(list: SaleCollaborator[]): number {
  return list.reduce((sum, c) => sum + (Number(c.shareAmount) || 0), 0)
}

export function validatePerformanceSplit(
  mode: SaleShareMode,
  list: SaleCollaborator[] | undefined | null,
  orderTotal: number,
): { ok: true } | { ok: false; message: string } {
  if (!list || list.length === 0) return { ok: true }
  if (list.length < 2) {
    return { ok: false, message: '分业绩至少需要 2 人' }
  }
  const ids = new Set<string>()
  for (const c of list) {
    if (!c.personnelId) return { ok: false, message: '请选择每一位分摊人员' }
    if (ids.has(c.personnelId)) return { ok: false, message: '分摊人员不能重复' }
    ids.add(c.personnelId)
  }

  if (mode === 'percent') {
    for (const c of list) {
      if (!(Number(c.sharePercent) > 0)) {
        return { ok: false, message: '每人分摊比例须大于 0' }
      }
    }
    const sum = getCollaboratorsShareSum(list)
    if (Math.abs(sum - 100) > EPS) {
      return { ok: false, message: `比例合计须为 100%（当前 ${sum.toFixed(1)}%）` }
    }
    return { ok: true }
  }

  // fixed amount
  for (const c of list) {
    if (!(Number(c.shareAmount) > 0)) {
      return { ok: false, message: '每人分摊金额须大于 0' }
    }
  }
  const sum = getCollaboratorsAmountSum(list)
  if (Math.abs(sum - (Number(orderTotal) || 0)) > 0.05) {
    return {
      ok: false,
      message:
        `固定金额合计须等于订单实收 ${orderTotal.toFixed(2)}`
        + `（当前 ${sum.toFixed(2)}）`,
    }
  }
  return { ok: true }
}

/** @deprecated 使用 validatePerformanceSplit */
export function validateCollaborators(
  list: SaleCollaborator[] | undefined | null,
  orderTotal = 0,
  mode: SaleShareMode = 'percent',
): { ok: true } | { ok: false; message: string } {
  return validatePerformanceSplit(mode, list, orderTotal)
}

/** 某人在该单上的分摊比例（用于数量缩放；无分摊时主责 100%） */
export function getSaleSharePercent(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators' | 'shareMode' | 'totalAmount'>,
  personId: string,
): number {
  if (!personId) return 0
  const cols = getSaleShares(sale)
  if (!cols || cols.length === 0) {
    return sale.personnelId === personId ? 100 : 0
  }
  const hit = cols.find((c) => c.personnelId === personId)
  if (!hit) return 0

  const mode = getSaleShareMode(sale)
  if (mode === 'amount') {
    const total = Number(sale.totalAmount) || 0
    if (total <= 0) return 0
    return ((Number(hit.shareAmount) || 0) / total) * 100
  }
  return Number(hit.sharePercent) || 0
}

export function getPersonShareAmount(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators' | 'shareMode' | 'totalAmount'>,
  personId: string,
): number {
  if (!personId) return 0
  const cols = getSaleShares(sale)
  if (!cols || cols.length === 0) {
    return sale.personnelId === personId ? (Number(sale.totalAmount) || 0) : 0
  }
  const hit = cols.find((c) => c.personnelId === personId)
  if (!hit) return 0

  if (getSaleShareMode(sale) === 'amount') {
    return Number(hit.shareAmount) || 0
  }
  return (Number(sale.totalAmount) || 0) * (Number(hit.sharePercent) || 0) / 100
}

export function getPersonShareQuantity(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators' | 'shareMode' | 'totalAmount' | 'quantity'>,
  personId: string,
): number {
  return (Number(sale.quantity) || 0) * getSaleSharePercent(sale, personId) / 100
}

export function saleInvolvesPerson(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators' | 'shareMode' | 'totalAmount' | 'salesPersonName'>,
  personId: string,
  personName?: string,
): boolean {
  if (getPersonShareAmount(sale, personId) > 0 || getSaleSharePercent(sale, personId) > 0) {
    return true
  }
  if (!sale.personnelId && (!sale.collaborators || sale.collaborators.length === 0)) {
    const name = (personName || '').trim()
    if (name && (sale.salesPersonName || '').trim() === name) return true
  }
  return false
}

export function scaleSaleForPerson(
  sale: SalesRecord,
  personId: string,
): SalesRecord | null {
  const amount = getPersonShareAmount(sale, personId)
  if (amount <= 0 && getSaleSharePercent(sale, personId) <= 0) return null
  const pct = getSaleSharePercent(sale, personId)
  if (Math.abs(pct - 100) < EPS) {
    return { ...sale, personnelId: personId }
  }
  return {
    ...sale,
    personnelId: personId,
    totalAmount: amount,
    quantity: (sale.quantity || 0) * pct / 100,
  }
}

export function buildDefaultShares(
  primaryId: string,
  mode: SaleShareMode,
  orderTotal: number,
  secondId = '',
  primaryUnitId = '',
  secondUnitId = '',
): SaleCollaborator[] {
  if (mode === 'amount') {
    const half = Math.round((orderTotal / 2) * 100) / 100
    const rest = Math.round((orderTotal - half) * 100) / 100
    return [
      {
        personnelId: primaryId,
        salesUnitId: primaryUnitId || undefined,
        shareAmount: half,
        sharePercent: 50,
      },
      {
        personnelId: secondId,
        salesUnitId: secondUnitId || primaryUnitId || undefined,
        shareAmount: rest,
        sharePercent: 50,
      },
    ]
  }
  return [
    {
      personnelId: primaryId,
      salesUnitId: primaryUnitId || undefined,
      sharePercent: 50,
    },
    {
      personnelId: secondId,
      salesUnitId: secondUnitId || primaryUnitId || undefined,
      sharePercent: 50,
    },
  ]
}

/** @deprecated */
export function buildDefaultCollaborators(
  primaryId: string,
  secondId = '',
): SaleCollaborator[] {
  return buildDefaultShares(primaryId, 'percent', 0, secondId)
}

export function formatShareLabel(
  sale: Pick<SalesRecord, 'collaborators' | 'shareMode'>,
  c: SaleCollaborator,
  name: string,
): string {
  if (getSaleShareMode(sale) === 'amount') {
    return `${name} ¥${(Number(c.shareAmount) || 0).toFixed(0)}`
  }
  return `${name} ${Number(c.sharePercent) || 0}%`
}
