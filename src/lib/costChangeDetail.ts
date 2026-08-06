import type { CostItem, CostRecord } from '@/types'
import { formatCurrency } from '@/lib/format'

function itemLabel(item: CostItem): string {
  const desc = (item.description || '').trim()
  return desc ? `${item.category}（${desc}）` : item.category
}

function formatItemsLine(items: CostItem[]): string {
  if (!items.length) return '无明细'
  return items
    .map((i) => `${itemLabel(i)} ${formatCurrency(i.amount || 0)}`)
    .join('；')
}

/** 新增成本的可展示明细 */
export function buildCostCreateDetail(
  record: CostRecord,
  unitName?: string,
): string {
  const lines = [
    `单位：${unitName || '-'} · 日期：${record.date || '-'} · 合计：${formatCurrency(record.totalCost || 0)}`,
    `明细：${formatItemsLine(record.items || [])}`,
  ]
  if ((record.remark || '').trim()) {
    lines.push(`备注：${record.remark.trim()}`)
  }
  return lines.join('\n')
}

/** 删除成本的可展示明细 */
export function buildCostDeleteDetail(
  record: CostRecord,
  unitName?: string,
): string {
  const lines = [
    `单位：${unitName || '-'} · 日期：${record.date || '-'} · 原合计：${formatCurrency(record.totalCost || 0)}`,
    `原明细：${formatItemsLine(record.items || [])}`,
  ]
  if ((record.remark || '').trim()) {
    lines.push(`备注：${record.remark.trim()}`)
  }
  return lines.join('\n')
}

/** 对比成本记录，生成「由什么变为什么」 */
export function buildCostUpdateDetail(
  before: CostRecord,
  after: CostRecord,
  unitNameBefore?: string,
  unitNameAfter?: string,
): string {
  const changes: string[] = []

  if (before.salesUnitId !== after.salesUnitId) {
    changes.push(
      `单位：${unitNameBefore || before.salesUnitId || '-'} → ${unitNameAfter || after.salesUnitId || '-'}`,
    )
  }
  if ((before.date || '') !== (after.date || '')) {
    changes.push(`日期：${before.date || '-'} → ${after.date || '-'}`)
  }
  if (Number(before.totalCost || 0) !== Number(after.totalCost || 0)) {
    changes.push(
      `合计：${formatCurrency(before.totalCost || 0)} → ${formatCurrency(after.totalCost || 0)}`,
    )
  }
  if ((before.remark || '').trim() !== (after.remark || '').trim()) {
    changes.push(
      `备注：${(before.remark || '').trim() || '（空）'} → ${(after.remark || '').trim() || '（空）'}`,
    )
  }

  const itemChanges = diffCostItems(before.items || [], after.items || [])
  if (itemChanges.length > 0) {
    changes.push('明细变更：')
    itemChanges.forEach((line) => changes.push(`· ${line}`))
  }

  if (changes.length === 0) {
    return '内容无字段变化（可能仅更新了变更原因）'
  }
  return changes.join('\n')
}

function diffCostItems(before: CostItem[], after: CostItem[]): string[] {
  const lines: string[] = []
  const beforeById = new Map(before.map((i) => [i.id, i]))
  const matchedBefore = new Set<string>()
  const matchedAfter = new Set<string>()

  after.forEach((a) => {
    const b = beforeById.get(a.id)
    if (!b) return
    matchedBefore.add(b.id)
    matchedAfter.add(a.id)
    const sameCategory = (b.category || '') === (a.category || '')
    const sameDesc = (b.description || '') === (a.description || '')
    const sameAmount = Number(b.amount || 0) === Number(a.amount || 0)
    if (sameCategory && sameDesc && sameAmount) return
    if (sameCategory && sameDesc) {
      lines.push(
        `${itemLabel(a)}：${formatCurrency(b.amount || 0)} → ${formatCurrency(a.amount || 0)}`,
      )
      return
    }
    lines.push(
      `${itemLabel(b)} ${formatCurrency(b.amount || 0)} → ${itemLabel(a)} ${formatCurrency(a.amount || 0)}`,
    )
  })

  // 无相同 id 时，按「类别+说明」兜底匹配，减少误报新增/删除
  const unmatchedBefore = before.filter((i) => !matchedBefore.has(i.id))
  const unmatchedAfter = after.filter((i) => !matchedAfter.has(i.id))
  const usedAfterIdx = new Set<number>()

  unmatchedBefore.forEach((b) => {
    const idx = unmatchedAfter.findIndex((a, i) => {
      if (usedAfterIdx.has(i)) return false
      return (
        (a.category || '') === (b.category || '')
        && (a.description || '') === (b.description || '')
      )
    })
    if (idx >= 0) {
      usedAfterIdx.add(idx)
      const a = unmatchedAfter[idx]
      matchedBefore.add(b.id)
      matchedAfter.add(a.id)
      if (Number(b.amount || 0) !== Number(a.amount || 0)) {
        lines.push(
          `${itemLabel(a)}：${formatCurrency(b.amount || 0)} → ${formatCurrency(a.amount || 0)}`,
        )
      }
    }
  })

  before.forEach((b) => {
    if (matchedBefore.has(b.id)) return
    lines.push(`删除 ${itemLabel(b)} ${formatCurrency(b.amount || 0)}`)
  })
  after.forEach((a) => {
    if (matchedAfter.has(a.id)) return
    lines.push(`新增 ${itemLabel(a)} ${formatCurrency(a.amount || 0)}`)
  })

  return lines
}

export function buildCostNotificationMessage(options: {
  operatorName: string
  action: 'create' | 'update' | 'delete'
  detail: string
  reason?: string
}): string {
  const actionLabel =
    options.action === 'create'
      ? '新增了成本记录'
      : options.action === 'update'
        ? '修改了成本记录'
        : '删除了成本记录'
  const lines = [
    `${options.operatorName || '用户'} ${actionLabel}`,
    options.detail,
  ]
  if ((options.reason || '').trim()) {
    lines.push(`原因：${options.reason!.trim()}`)
  }
  return lines.filter(Boolean).join('\n')
}
