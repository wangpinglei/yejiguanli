/**
 * 销售记录 → 订单核对 Excel（当前筛选结果）
 */
import ExcelJS from 'exceljs'

import { formatCurrency } from '@/lib/format'
import {
  formatShareLabel,
  getPersonShareAmount,
  getSaleShares,
} from '@/lib/saleCollaborators'
import type { Personnel, Product, SalesRecord, SalesUnit } from '@/types'

export type SalesReconcileFilterMeta = {
  unitId: string
  unitName: string
  personId: string
  personName: string
  dateFrom: string
  dateTo: string
  search: string
  sourceLabel: string
  domainLabel: string
  duplicateLabel: string
}

export type SalesReconcileExportRow = {
  saleDate: string
  customerName: string
  productName: string
  activityName: string
  orderAmount: number
  receivedAmount: number
  orderType: string
  unitName: string
  mainSalesName: string
  shareDetail: string
  attributedAmount: number
  source: string
  orderNumber: string
  remark: string
}

function resolvePersonName(
  personnelId: string,
  personnel: Personnel[],
  fallback = '',
): string {
  if (!personnelId) return fallback || ''
  return personnel.find((p) => p.id === personnelId)?.name || fallback || personnelId
}

function resolveProductName(sale: SalesRecord, products: Product[]): string {
  if (sale.productName) return sale.productName
  return products.find((p) => p.id === sale.productId)?.name || ''
}

function resolveUnitName(sale: SalesRecord, salesUnits: SalesUnit[]): string {
  if (sale.salesUnitName) return sale.salesUnitName
  return salesUnits.find((u) => u.id === sale.salesUnitId)?.name || ''
}

function buildShareDetail(sale: SalesRecord, personnel: Personnel[]): string {
  const shares = getSaleShares(sale)
  if (shares.length < 2) return ''
  return shares
    .map((c) => {
      const name = resolvePersonName(c.personnelId, personnel)
      return formatShareLabel(sale, c, name)
    })
    .join('；')
}

/**
 * 把筛选后的销售记录整理成核对导出行
 * attributedAmount 由页面按当前筛选口径传入（与列表合计一致）
 */
export function buildSalesReconcileExportRows(options: {
  records: SalesRecord[]
  personnel: Personnel[]
  products: Product[]
  salesUnits: SalesUnit[]
  getAttributedAmount: (sale: SalesRecord) => number
}): SalesReconcileExportRow[] {
  const { records, personnel, products, salesUnits, getAttributedAmount } = options
  return records.map((sale) => {
    const mainName = resolvePersonName(
      sale.personnelId,
      personnel,
      sale.salesPersonName || '',
    )
    const orderAmount = Number(sale.orderAmount)
    return {
      saleDate: (sale.saleDate || '').slice(0, 10),
      customerName: sale.customerName || '',
      productName: resolveProductName(sale, products),
      activityName: sale.activityName || '',
      orderAmount: Number.isFinite(orderAmount) ? orderAmount : Number(sale.totalAmount) || 0,
      receivedAmount: Number(sale.totalAmount) || 0,
      orderType: sale.orderType || '',
      unitName: resolveUnitName(sale, salesUnits),
      mainSalesName: mainName,
      shareDetail: buildShareDetail(sale, personnel),
      attributedAmount: Number(getAttributedAmount(sale)) || 0,
      source: sale.synced ? '生态圈同步' : '手动录入',
      orderNumber: sale.orderNumber || sale.externalOrderId || '',
      remark: sale.remark || '',
    }
  })
}

export function buildSalesReconcilePersonSummary(
  records: SalesRecord[],
  personnel: Personnel[],
): Array<{ name: string; count: number; amount: number }> {
  const map = new Map<string, { name: string; count: number; amount: number }>()

  function add(personId: string, name: string, amount: number) {
    const key = personId || name || '_'
    const prev = map.get(key) || { name: name || personId || '未归属', count: 0, amount: 0 }
    prev.count += 1
    prev.amount += amount
    if (name) prev.name = name
    map.set(key, prev)
  }

  for (const sale of records) {
    const shares = getSaleShares(sale)
    if (shares.length >= 2) {
      for (const c of shares) {
        const amount = getPersonShareAmount(sale, c.personnelId)
        if (!(amount > 0)) continue
        add(
          c.personnelId,
          resolvePersonName(c.personnelId, personnel),
          amount,
        )
      }
      continue
    }
    const amount = Number(sale.totalAmount) || 0
    add(
      sale.personnelId,
      resolvePersonName(sale.personnelId, personnel, sale.salesPersonName || ''),
      amount,
    )
  }

  return Array.from(map.values()).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'zh-CN'))
}

function formatFilterLine(meta: SalesReconcileFilterMeta): string {
  const parts: string[] = []
  if (meta.unitId !== 'all') parts.push(`单位：${meta.unitName}`)
  else parts.push('单位：全部')
  if (meta.personId !== 'all') parts.push(`人员：${meta.personName}`)
  else parts.push('人员：全部')
  if (meta.dateFrom || meta.dateTo) {
    parts.push(`成交日：${meta.dateFrom || '…'} ~ ${meta.dateTo || '…'}`)
  } else {
    parts.push('成交日：未限')
  }
  if (meta.search.trim()) parts.push(`搜索：${meta.search.trim()}`)
  if (meta.sourceLabel) parts.push(`来源：${meta.sourceLabel}`)
  if (meta.domainLabel) parts.push(`业务域：${meta.domainLabel}`)
  if (meta.duplicateLabel) parts.push(`重复：${meta.duplicateLabel}`)
  return parts.join('　')
}

/** 下载订单核对 Excel */
export async function downloadSalesOrderReconcileExcel(options: {
  rows: SalesReconcileExportRow[]
  personSummary: Array<{ name: string; count: number; amount: number }>
  filterMeta: SalesReconcileFilterMeta
  attributedTotal: number
}): Promise<void> {
  const { rows, personSummary, filterMeta, attributedTotal } = options
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'yejiguanli'
  workbook.created = new Date()

  const detail = workbook.addWorksheet('订单明细', {
    views: [{ state: 'frozen', ySplit: 2 }],
  })
  detail.mergeCells(1, 1, 1, 14)
  detail.getCell(1, 1).value =
    `订单核对导出｜${formatFilterLine(filterMeta)}｜共 ${rows.length} 笔｜计入口径合计 ${formatCurrency(attributedTotal)}`
  detail.getCell(1, 1).font = { bold: true, size: 11 }
  detail.addRow([
    '成交日期',
    '客户姓名',
    '购买产品',
    '活动',
    '订单金额',
    '实收金额',
    '订单类型',
    '销售单位',
    '主销售',
    '分摊明细',
    '计入筛选口径业绩',
    '来源',
    '订单号',
    '备注',
  ])
  detail.getRow(2).font = { bold: true }
  for (const row of rows) {
    detail.addRow([
      row.saleDate,
      row.customerName,
      row.productName,
      row.activityName,
      row.orderAmount,
      row.receivedAmount,
      row.orderType,
      row.unitName,
      row.mainSalesName,
      row.shareDetail,
      row.attributedAmount,
      row.source,
      row.orderNumber,
      row.remark,
    ])
  }
  detail.addRow([
    '合计',
    '',
    '',
    '',
    rows.reduce((s, r) => s + r.orderAmount, 0),
    rows.reduce((s, r) => s + r.receivedAmount, 0),
    '',
    '',
    '',
    '',
    attributedTotal,
    '',
    '',
    '',
  ])
  detail.getRow(detail.rowCount).font = { bold: true }

  const summary = workbook.addWorksheet('按人汇总', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  summary.addRow(['销售人员', '涉及笔数', '个人份额合计'])
  summary.getRow(1).font = { bold: true }
  for (const p of personSummary) {
    summary.addRow([p.name, p.count, p.amount])
  }
  summary.addRow([
    '合计',
    personSummary.reduce((s, p) => s + p.count, 0),
    personSummary.reduce((s, p) => s + p.amount, 0),
  ])
  summary.getRow(summary.rowCount).font = { bold: true }

  for (const sheet of [detail, summary]) {
    sheet.columns.forEach((col) => {
      let max = 10
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = String(cell.value ?? '').length
        if (len > max) max = len
      })
      col.width = Math.min(36, Math.max(10, max + 2))
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const unitPart = filterMeta.unitId !== 'all' ? filterMeta.unitName : '全部单位'
  const datePart = filterMeta.dateFrom || filterMeta.dateTo
    ? `${filterMeta.dateFrom || '起'}_${filterMeta.dateTo || '止'}`
    : '全部日期'
  a.download = `订单核对_${unitPart}_${datePart}.xlsx`.replace(/[\\/:*?"<>|]/g, '_')
  a.click()
  URL.revokeObjectURL(url)
}
