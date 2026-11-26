import ExcelJS from 'exceljs'
import type { UnitSettlementBlock } from '@/lib/saleSettlementReconcile'

export async function downloadProductSettlementSalesExcel(
  blocks: UnitSettlementBlock[],
  yearMonth: string,
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
    '是否手工调整',
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
    ])
  }

  const detail = workbook.addWorksheet('订单明细', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  detail.addRow([
    '月份',
    '销售单位',
    '成交日期',
    '销售人员',
    '客户',
    '产品',
    '订单金额',
    '实收金额',
    '业绩扣除',
    '记佣金额',
    '结算比例',
    '预估结算',
    '实际结算',
    '来源',
    '订单号',
  ])
  detail.getRow(1).font = { bold: true }
  for (const b of blocks) {
    for (const l of b.lines) {
      detail.addRow([
        yearMonth,
        b.unit.name,
        l.saleDate,
        l.salesPersonName,
        l.customerName,
        l.productName,
        l.orderAmount,
        l.receivedAmount,
        l.performanceDeduction,
        l.commissionBase,
        l.settlementRatioLabel,
        l.estimatedSettlement,
        l.actualSettlement,
        l.synced ? '生态圈' : '手动',
        l.orderNumber,
      ])
    }
  }

  for (const sheet of [summary, detail]) {
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
  a.download = `产品结算_${yearMonth}.xlsx`.replace(/[\\/:*?"<>|]/g, '_')
  a.click()
  URL.revokeObjectURL(url)
}