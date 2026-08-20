import type { SalesRecord } from '@/types'

/** 合作单分摊人：比例合计须为 100 */
export type SaleCollaborator = {
  personnelId: string
  sharePercent: number
}

const EPS = 0.01

export function parseCollaboratorsJson(raw: unknown): SaleCollaborator[] | undefined {
  if (raw == null || raw === '') return undefined
  let arr: unknown = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return undefined
  const list: SaleCollaborator[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const personnelId = String(row.personnelId || '').trim()
    const sharePercent = Number(row.sharePercent)
    if (!personnelId || !Number.isFinite(sharePercent)) continue
    list.push({ personnelId, sharePercent })
  }
  return list.length > 0 ? list : undefined
}

export function getCollaboratorsShareSum(list: SaleCollaborator[]): number {
  return list.reduce((sum, c) => sum + (Number(c.sharePercent) || 0), 0)
}

export function validateCollaborators(
  list: SaleCollaborator[] | undefined | null,
): { ok: true } | { ok: false; message: string } {
  if (!list || list.length === 0) return { ok: true }
  if (list.length < 2) {
    return { ok: false, message: '合作分摊至少需要 2 人' }
  }
  const ids = new Set<string>()
  for (const c of list) {
    if (!c.personnelId) return { ok: false, message: '请选择每一位合作人员' }
    if (ids.has(c.personnelId)) return { ok: false, message: '合作人员不能重复' }
    ids.add(c.personnelId)
    if (!(c.sharePercent > 0)) {
      return { ok: false, message: '每人分摊比例须大于 0' }
    }
  }
  const sum = getCollaboratorsShareSum(list)
  if (Math.abs(sum - 100) > EPS) {
    return { ok: false, message: `分摊比例合计须为 100%（当前 ${sum.toFixed(1)}%）` }
  }
  return { ok: true }
}

/** 某人在该单上的分摊比例（无合作单时：主责人 100%） */
export function getSaleSharePercent(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators'>,
  personId: string,
): number {
  if (!personId) return 0
  const cols = sale.collaborators
  if (!cols || cols.length === 0) {
    return sale.personnelId === personId ? 100 : 0
  }
  const hit = cols.find((c) => c.personnelId === personId)
  return hit ? Number(hit.sharePercent) || 0 : 0
}

export function getPersonShareAmount(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators' | 'totalAmount'>,
  personId: string,
): number {
  return (Number(sale.totalAmount) || 0) * getSaleSharePercent(sale, personId) / 100
}

export function getPersonShareQuantity(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators' | 'quantity'>,
  personId: string,
): number {
  return (Number(sale.quantity) || 0) * getSaleSharePercent(sale, personId) / 100
}

/** 是否参与该单（含合作分摊） */
export function saleInvolvesPerson(
  sale: Pick<SalesRecord, 'personnelId' | 'collaborators' | 'salesPersonName'>,
  personId: string,
  personName?: string,
): boolean {
  if (getSaleSharePercent(sale, personId) > 0) return true
  if (!sale.personnelId && (!sale.collaborators || sale.collaborators.length === 0)) {
    const name = (personName || '').trim()
    if (name && (sale.salesPersonName || '').trim() === name) return true
  }
  return false
}

/** 按某人份额缩放后的虚拟销售行（用于提成汇总） */
export function scaleSaleForPerson(
  sale: SalesRecord,
  personId: string,
): SalesRecord | null {
  const pct = getSaleSharePercent(sale, personId)
  if (pct <= 0) return null
  if (Math.abs(pct - 100) < EPS) {
    return { ...sale, personnelId: personId }
  }
  return {
    ...sale,
    personnelId: personId,
    totalAmount: (sale.totalAmount || 0) * pct / 100,
    quantity: (sale.quantity || 0) * pct / 100,
  }
}

export function buildDefaultCollaborators(
  primaryId: string,
  secondId = '',
): SaleCollaborator[] {
  return [
    { personnelId: primaryId, sharePercent: 50 },
    { personnelId: secondId, sharePercent: 50 },
  ]
}
