/**
 * 工资核算 Excel：主表 + 核算过程多 Sheet（范围 = 纳入工资核算的全部单位）
 */
import ExcelJS from 'exceljs'
import type {
  PerformanceTarget,
  Personnel,
  Product,
  ProductPersonCommission,
  SalesRecord,
  SalesUnit,
  TeamMgmtCommissionRule,
  UnitProductSettlement,
} from '@/types'
import {
  formatAdjLinesComment,
  formatAdjLinesNote,
  PAYROLL_STANDARD_HOURS,
  type PayrollMonthEntry,
  type PayrollRowResult,
} from '@/lib/payrollCalc'
import { buildPayrollCommissionDetail } from '@/lib/payrollCommissionDetail'
import { calcUnitTeamMgmtCommission } from '@/lib/teamMgmtCommission'
import type { TeamMgmtSalaryContext } from '@/lib/salary'

export type PayrollExportRow = PayrollRowResult & {
  personalSales: number
  hasCommissionOrderAdj: boolean
  commissionPersonal: number
  commissionInternal: number
  commissionTeamMgmt: number
}

export type PayrollExportArchiveInsurance = {
  socialEmployer: number
  housingEmployer: number
  socialPersonal: number
  housingPersonal: number
}

export type PayrollExportContext = {
  yearMonth: string
  scopeUnitNames: string[]
  rows: PayrollExportRow[]
  entries: Record<string, PayrollMonthEntry>
  personnel: Personnel[]
  salesUnits: SalesUnit[]
  salesRecords: SalesRecord[]
  products: Product[]
  productPersonCommissions: ProductPersonCommission[]
  teamMgmtCommissionRules: TeamMgmtCommissionRule[]
  performanceTargets: PerformanceTarget[]
  unitProductSettlements: UnitProductSettlement[]
  teamMgmtContext: TeamMgmtSalaryContext
  getArchiveInsurance: (
    person: Personnel,
    yearMonth: string,
  ) => PayrollExportArchiveInsurance
}

function monthLabel(yearMonth: string): string {
  return /^\d{4}-\d{2}$/.test(yearMonth)
    ? `${yearMonth.slice(0, 4)}年${Number(yearMonth.slice(5, 7))}月`
    : yearMonth
}

function autoSizeColumns(sheet: ExcelJS.Worksheet, maxWidth = 36, minWidth = 10) {
  sheet.columns.forEach((col) => {
    let max = minWidth
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? '').length
      if (len > max) max = len
    })
    col.width = Math.min(maxWidth, Math.max(minWidth, max + 2))
  })
}

function safeFilePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '').slice(0, 80) || '工资表'
}

function num(n: number): number {
  return Number(Number(n).toFixed(2))
}

function addOverviewSheet(workbook: ExcelJS.Workbook, ctx: PayrollExportContext) {
  const sheet = workbook.addWorksheet('核算说明')
  const lines = [
    ['工资核算明细导出'],
    ['月份', monthLabel(ctx.yearMonth)],
    ['核算单位范围', ctx.scopeUnitNames.join('、') || '（未选单位）'],
    ['导出时间', new Date().toLocaleString('zh-CN')],
    ['人数', String(ctx.rows.length)],
    [],
    ['应发公式（内部员工）'],
    [
      '应发 = 业绩提成 + 实发底薪 + 保密费 + 岗位补贴 + 实发绩效 + 其他加项 − 其他减项',
    ],
    ['实发底薪 = 标准底薪 ×（实际出勤 ÷ 应出勤）'],
    ['实发绩效 = 标准绩效 × 出勤系数 ×（考核分 ÷ 100）'],
    [`应出勤 = ${PAYROLL_STANDARD_HOURS} 小时（21.75 天 × 7.5 小时）`],
    ['未填缺勤按满勤；未填考核分按 100 分'],
    ['业绩提成 = 个人提成 + 内部销售提成 + 团队管理提成（个人提成有单笔调整时与「个人业绩提成明细」合计一致）'],
    [],
    ['实发公式'],
    ['实发 = 应发 − 社保个人 − 公积金个人 − 本期个税'],
    [],
    ['工作表说明'],
    ['工资表', '汇总行，与页面工资表一致'],
    ['应发拆解', '固定薪酬与提成构成'],
    ['个人业绩提成明细', '逐单计佣过程（与业绩提成明细页同源）'],
    ['团队管理提成', '各单位团队池与经理分摊'],
    ['个税计算', '累计预扣法各中间项'],
    ['加减项明细', '其他加项/减项多行录入'],
  ]
  lines.forEach((row) => sheet.addRow(row))
  sheet.getColumn(1).width = 22
  sheet.getColumn(2).width = 72
  sheet.getCell(1, 1).font = { bold: true, size: 12 }
}

function addPayrollMainSheet(
  workbook: ExcelJS.Workbook,
  ctx: PayrollExportContext,
) {
  const monthText = monthLabel(ctx.yearMonth)
  const header = [
    '月份',
    '单位',
    '姓名',
    '标准底薪',
    '保密费',
    '岗位补贴',
    '标准绩效',
    '个人提成',
    '内部销售提成',
    '团队管理提成',
    '业绩提成',
    '实际出勤',
    '缺勤时间',
    '应出勤时间',
    '考核分',
    '实发底薪',
    '实发绩效',
    '其他加项',
    '加项明细',
    '其他减项',
    '减项明细',
    '应发合计',
    '社保企业',
    '社保个人',
    '公积金企业',
    '公积金个人',
    '专项附加',
    '本期个税',
    '实发',
  ]
  const bonusCol = header.indexOf('其他加项') + 1
  const deductCol = header.indexOf('其他减项') + 1

  const sheet = workbook.addWorksheet('工资表', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.addRow(header)
  sheet.getRow(1).font = { bold: true }

  for (const r of ctx.rows) {
    const entry = ctx.entries[r.personnelId] || {
      personnelId: r.personnelId,
      otherBonus: 0,
      otherDeduction: 0,
    } as PayrollMonthEntry
    const person = ctx.personnel.find((p) => p.id === r.personnelId)
    const archive = person
      ? ctx.getArchiveInsurance(person, ctx.yearMonth)
      : {
        socialEmployer: 0,
        housingEmployer: 0,
        socialPersonal: r.socialInsurancePersonal || 0,
        housingPersonal: r.housingFundPersonal || 0,
      }
    const bonusNote =
      entry.otherBonusNote
      || (entry.otherBonusLines?.length
        ? formatAdjLinesNote(entry.otherBonusLines)
        : '')
    const deductNote =
      entry.otherDeductionNote
      || (entry.otherDeductionLines?.length
        ? formatAdjLinesNote(entry.otherDeductionLines)
        : '')
    const bonusComment = formatAdjLinesComment(
      entry.otherBonusLines || [],
      entry.otherBonusNote || '',
    )
    const deductComment = formatAdjLinesComment(
      entry.otherDeductionLines || [],
      entry.otherDeductionNote || '',
    )

    const row = sheet.addRow([
      monthText,
      r.unitName,
      r.name,
      num(r.standardBaseSalary),
      num(r.paidConfidentialityFee),
      num(r.paidPositionAllowance),
      num(r.standardPerformance),
      num(r.commissionPersonal),
      num(r.commissionInternal),
      num(r.commissionTeamMgmt),
      num(r.commission),
      num(r.attendanceHours),
      num(r.absenceHours),
      num(r.expectedAttendanceHours),
      num(r.score),
      num(r.paidBaseSalary),
      num(r.paidPerformance),
      num(entry.otherBonus || 0),
      bonusNote,
      num(entry.otherDeduction || 0),
      deductNote,
      num(r.payable),
      num(archive.socialEmployer),
      num(archive.socialPersonal),
      num(archive.housingEmployer),
      num(archive.housingPersonal),
      num(r.specialAdditional || 0),
      num(r.incomeTax || 0),
      num(r.netPay || 0),
    ])

    if (bonusComment) {
      row.getCell(bonusCol).note = bonusComment
      row.getCell(bonusCol).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF7ED' },
      }
    }
    if (deductComment) {
      row.getCell(deductCol).note = deductComment
      row.getCell(deductCol).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF2F2' },
      }
    }
  }
  autoSizeColumns(sheet, 28)
}

function addPayableBreakdownSheet(
  workbook: ExcelJS.Workbook,
  ctx: PayrollExportContext,
) {
  const sheet = workbook.addWorksheet('应发拆解', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.addRow([
    '单位',
    '姓名',
    '仅核算提成',
    '标准底薪',
    '实际出勤(h)',
    '应出勤(h)',
    '出勤系数',
    '实发底薪',
    '保密费',
    '岗位补贴',
    '标准绩效',
    '考核分',
    '考核系数',
    '实发绩效',
    '个人提成',
    '内部销售提成',
    '团队管理提成',
    '业绩提成合计',
    '其他加项',
    '其他减项',
    '应发合计',
    '本月个人销售额',
    '有提成单笔调整',
  ])
  sheet.getRow(1).font = { bold: true }

  for (const r of ctx.rows) {
    const entry = ctx.entries[r.personnelId]
    sheet.addRow([
      r.unitName,
      r.name,
      r.commissionOnly ? '是' : '否',
      num(r.standardBaseSalary),
      num(r.attendanceHours),
      num(r.expectedAttendanceHours),
      num(r.attendanceRatio),
      num(r.paidBaseSalary),
      num(r.paidConfidentialityFee),
      num(r.paidPositionAllowance),
      num(r.standardPerformance),
      num(r.score),
      num(r.scoreRatio),
      num(r.paidPerformance),
      num(r.commissionPersonal),
      num(r.commissionInternal),
      num(r.commissionTeamMgmt),
      num(r.commission),
      num(entry?.otherBonus || 0),
      num(entry?.otherDeduction || 0),
      num(r.payable),
      num(r.personalSales),
      r.hasCommissionOrderAdj ? '是' : '否',
    ])
  }
  autoSizeColumns(sheet)
}

function addCommissionDetailSheet(
  workbook: ExcelJS.Workbook,
  ctx: PayrollExportContext,
) {
  const sheet = workbook.addWorksheet('个人业绩提成明细', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.addRow([
    '单位',
    '姓名',
    '成交日期',
    '客户姓名',
    '购买产品',
    '活动',
    '订单份额',
    '成本扣除',
    '计佣业绩',
    '提成规则',
    '系统提成',
    '单笔调整',
    '最终提成',
  ])
  sheet.getRow(1).font = { bold: true }

  for (const row of ctx.rows) {
    const detail = buildPayrollCommissionDetail({
      personnelId: row.personnelId,
      unitId: row.unitId,
      yearMonth: ctx.yearMonth,
      personnel: ctx.personnel,
      salesUnits: ctx.salesUnits,
      salesRecords: ctx.salesRecords,
      products: ctx.products,
      productPersonCommissions: ctx.productPersonCommissions,
      teamMgmtRules: ctx.teamMgmtCommissionRules,
      performanceTargets: ctx.performanceTargets,
      unitProductSettlements: ctx.unitProductSettlements,
    })
    if (!detail) continue
    for (const line of detail.lines) {
      sheet.addRow([
        row.unitName,
        row.name,
        line.saleDate,
        line.customerName,
        line.productName,
        line.activityName || '—',
        num(line.orderAmount),
        num(line.costDeduction),
        num(line.billableBase),
        line.rateLabel,
        num(line.systemAmount),
        line.adjSummary || '',
        num(line.amount),
      ])
    }
  }
  autoSizeColumns(sheet, 40)
}

function addTeamMgmtSheet(
  workbook: ExcelJS.Workbook,
  ctx: PayrollExportContext,
) {
  const sheet = workbook.addWorksheet('团队管理提成', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.addRow([
    '单位',
    '月份',
    '可计实收',
    '月目标',
    '完成率%',
    '档位提成%',
    '提成池',
    '经理',
    '权重',
    '分得金额',
  ])
  sheet.getRow(1).font = { bold: true }

  const unitIds = Array.from(new Set(ctx.rows.map((r) => r.unitId)))
  for (const unitId of unitIds) {
    const unitName =
      ctx.salesUnits.find((u) => u.id === unitId)?.name || unitId
    const rule = ctx.teamMgmtCommissionRules.find(
      (r) => r.salesUnitId === unitId,
    )
    const result = calcUnitTeamMgmtCommission(
      unitId,
      ctx.yearMonth,
      ctx.salesRecords,
      ctx.unitProductSettlements,
      ctx.performanceTargets,
      rule,
    )
    if (result.allocations.length === 0) {
      sheet.addRow([
        unitName,
        monthLabel(ctx.yearMonth),
        num(result.eligibleSales),
        num(result.targetAmount),
        num(result.completionPercent),
        num(result.commissionRatePercent),
        num(result.pool),
        '（无配置或未分摊）',
        '',
        '',
      ])
      continue
    }
    for (const alloc of result.allocations) {
      const person = ctx.personnel.find((p) => p.id === alloc.personnelId)
      sheet.addRow([
        unitName,
        monthLabel(ctx.yearMonth),
        num(result.eligibleSales),
        num(result.targetAmount),
        num(result.completionPercent),
        num(result.commissionRatePercent),
        num(result.pool),
        person?.name || alloc.personnelId,
        num(alloc.weight),
        num(alloc.amount),
      ])
    }
  }
  autoSizeColumns(sheet)
}

function addTaxSheet(workbook: ExcelJS.Workbook, ctx: PayrollExportContext) {
  const sheet = workbook.addWorksheet('个税计算', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.addRow([
    '单位',
    '姓名',
    '周期第N月',
    '本期应发',
    '社保个人',
    '公积金个人',
    '专项附加',
    '累计扣税基数(上月C)',
    '自动C',
    'C应纳税所得额',
    'C手工覆盖',
    '减除费用5000×N',
    'A计税税基',
    'A累计应纳税',
    'B已预缴',
    '系统本期个税',
    '本期个税',
    '个税手工覆盖',
    '实发',
  ])
  sheet.getRow(1).font = { bold: true }

  for (const r of ctx.rows) {
    const entry = ctx.entries[r.personnelId]
    const cOverride =
      entry?.taxableIncomeOverride != null
      && Number.isFinite(Number(entry.taxableIncomeOverride))
    const taxOverride =
      entry?.incomeTaxOverride != null
      && Number.isFinite(Number(entry.incomeTaxOverride))
    sheet.addRow([
      r.unitName,
      r.name,
      r.iitCycleMonthIndex ?? '',
      num(r.payableForTax ?? r.payable),
      num(r.socialInsurancePersonal || 0),
      num(r.housingFundPersonal || 0),
      num(r.specialAdditional || 0),
      num(r.cumulativeTaxBase ?? 0),
      num(r.autoTaxableIncome ?? 0),
      num(r.cumulativeTaxable ?? 0),
      cOverride ? '是' : '否',
      num(r.cumulativeBasicDeduction ?? 0),
      num(r.taxBaseForA ?? 0),
      num(r.cumulativeTaxDue ?? 0),
      num(r.taxPaidBeforeThisMonth ?? 0),
      num(r.systemIncomeTax ?? 0),
      num(r.incomeTax || 0),
      taxOverride ? '是' : '否',
      num(r.netPay || 0),
    ])
  }
  autoSizeColumns(sheet, 32)
}

function addAdjLinesSheet(workbook: ExcelJS.Workbook, ctx: PayrollExportContext) {
  const sheet = workbook.addWorksheet('加减项明细', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.addRow(['单位', '姓名', '类型', '说明', '金额', '备注汇总'])
  sheet.getRow(1).font = { bold: true }

  for (const r of ctx.rows) {
    const entry = ctx.entries[r.personnelId]
    if (!entry) continue
    const noteBonus = entry.otherBonusNote || ''
    const noteDeduct = entry.otherDeductionNote || ''
    for (const line of entry.otherBonusLines || []) {
      sheet.addRow([
        r.unitName,
        r.name,
        '加项',
        (line.label || '').trim(),
        num(line.amount),
        noteBonus,
      ])
    }
    for (const line of entry.otherDeductionLines || []) {
      sheet.addRow([
        r.unitName,
        r.name,
        '减项',
        (line.label || '').trim(),
        num(line.amount),
        noteDeduct,
      ])
    }
    if (
      (!(entry.otherBonusLines?.length) && (entry.otherBonus || 0) !== 0)
      || (!(entry.otherDeductionLines?.length) && (entry.otherDeduction || 0) !== 0)
    ) {
      if (!(entry.otherBonusLines?.length) && (entry.otherBonus || 0) !== 0) {
        sheet.addRow([
          r.unitName,
          r.name,
          '加项',
          '（合计，无明细行）',
          num(entry.otherBonus || 0),
          noteBonus,
        ])
      }
      if (!(entry.otherDeductionLines?.length) && (entry.otherDeduction || 0) !== 0) {
        sheet.addRow([
          r.unitName,
          r.name,
          '减项',
          '（合计，无明细行）',
          num(entry.otherDeduction || 0),
          noteDeduct,
        ])
      }
    }
  }
  autoSizeColumns(sheet)
}

function buildDownloadFileName(ctx: PayrollExportContext): string {
  const monthText = monthLabel(ctx.yearMonth)
  const names = ctx.scopeUnitNames
  let unitPart: string
  if (names.length === 0) unitPart = '工资表'
  else if (names.length === 1) unitPart = names[0]
  else if (names.length <= 3) unitPart = names.join('、')
  else unitPart = `${names.slice(0, 2).join('、')}等${names.length}家`
  return `${safeFilePart(unitPart)}_${monthText}_工资及核算明细.xlsx`
}

export async function downloadPayrollWorkbook(ctx: PayrollExportContext): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'yejiguanli'
  workbook.created = new Date()

  addOverviewSheet(workbook, ctx)
  addPayrollMainSheet(workbook, ctx)
  addPayableBreakdownSheet(workbook, ctx)
  addCommissionDetailSheet(workbook, ctx)
  addTeamMgmtSheet(workbook, ctx)
  addTaxSheet(workbook, ctx)
  addAdjLinesSheet(workbook, ctx)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = buildDownloadFileName(ctx)
  a.click()
  URL.revokeObjectURL(url)
}