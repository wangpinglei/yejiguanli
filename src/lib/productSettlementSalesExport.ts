import ExcelJS from 'exceljs'
import type { UnitSettlementBlock } from '@/lib/saleSettlementReconcile'

const DETAIL_HEADERS = [
  '成交日期',
  '销售人员',
  '客户',
  '产品',
  '订单金额',
  '实收金额',
  '业绩扣除',
  '扣除原因',
  '记佣金额',
  '结算比例',
  '预估结算',
  '实际结算',
  '来源',
  '订单号',
] as const

function uniqueWorksheetName(base: string, used: Set<string>): string {
  const cleaned =
    base.replace(/[*?:\\/[\]]/g, '_').trim().slice(0, 31) || '单位'
  let name = cleaned
  let n = 2
  while (used.has(name)) {
    const suffix = `(${n})`
    name = `${cleaned.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    n += 1
  }
  used.add(name)
  return name
}

function autoFitColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((col) => {
    let max = 10
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? '').length
      if (len > max) max = len
    })
    col.width = Math.min(36, Math.max(10, max + 2))
  })
}

function addUnitDetailSheet(
  workbook: ExcelJS.Workbook,
  block: UnitSettlementBlock,
  yearMonth: string,
  usedNames: Set<string>,
) {
  const sheet = workbook.addWorksheet(
    uniqueWorksheetName(block.unit.name, usedNames),
    { views: [{ state: 'frozen', ySplit: 3 }] },
  )

  sheet.addRow(['销售单位', block.unit.name, '月份', yearMonth])
  sheet.addRow([
    '预估结算合计',
    block.estimatedTotal,
    '实际结算合计',
    block.actualTotal,
    '笔数',
    block.lines.length,
    '是否已确认',
    block.isAdjusted ? '是' : '否',
  ])
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(2).font = { bold: true }

  const headerRow = sheet.addRow([...DETAIL_HEADERS])
  headerRow.font = { bold: true }

  for (const l of block.lines) {
    sheet.addRow([
      l.saleDate,
      l.salesPersonName,
      l.customerName,
      l.productName,
      l.orderAmount,
      l.receivedAmount,
      l.performanceDeduction,
      l.performanceDeductionRemark,
      l.commissionBase,
      l.settlementRatioLabel,
      l.estimatedSettlement,
      l.actualSettlement,
      l.synced ? '生态圈' : '手动',
      l.orderNumber,
    ])
  }

  if (block.lines.length > 0) {
    sheet.addRow([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '合计',
      '',
      block.estimatedTotal,
      block.actualTotal,
      '',
      '',
    ])
    sheet.lastRow!.font = { bold: true }
  }

  autoFitColumns(sheet)
}

export async function downloadProductSettlementSalesExcel(
  blocks: UnitSettlementBlock[],
  yearMonth: string,
  fileNameSuffix?: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'yejiguanli'

  const summary = workbook.addWorksheet('单位汇总', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  summary.addRow([
    '月份',
    '销售单位',
    '预估结算',
    '实际结算',
    '差额',
    '笔数',
    '是否已确认',
    '确认人',
    '确认时间',
  ])
  summary.getRow(1).font = { bold: true }
  for (const b of blocks) {
    summary.addRow([
      yearMonth,
      b.unit.name,
      b.estimatedTotal,
      b.actualTotal,
      b.actualTotal - b.estimatedTotal,
      b.lines.length,
      b.isAdjusted ? '是' : '否',
      b.settlement?.adjustedBy || '',
      b.settlement?.adjustedAt
        ? String(b.settlement.adjustedAt).slice(0, 19).replace('T', ' ')
        : '',
    ])
  }
  autoFitColumns(summary)

  const usedNames = new Set<string>(['单位汇总'])
  for (const b of blocks) {
    if (b.lines.length === 0) continue
    addUnitDetailSheet(workbook, b, yearMonth, usedNames)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const extra = fileNameSuffix
    ? `_${fileNameSuffix}`.replace(/[\\/:*?"<>|]/g, '_')
    : ''
  a.download = `产品结算_${yearMonth}${extra}.xlsx`.replace(/[\\/:*?"<>|]/g, '_')
  a.click()
  URL.revokeObjectURL(url)
}