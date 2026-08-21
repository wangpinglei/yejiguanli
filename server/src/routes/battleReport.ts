import { Router, Request, Response } from 'express'
import {
  getDb,
  rowToPersonnel,
  rowToSalesRecord,
  rowToPerformanceTarget,
  rowToPositionGroupLabel,
  rowToSalesUnit,
  rowToUnitProductSettlement,
} from '../db'
import { buildUnitBattleReport } from '../lib/battleReport'

const router = Router()

const API_KEY =
  process.env.BATTLE_REPORT_API_KEY ||
  process.env.SYNC_API_KEY ||
  'eco-sync-2026-secret'

function getCurrentYearMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7)
}

function validateApiKey(req: Request, res: Response): boolean {
  const key = req.header('X-API-Key') || (req.query.apiKey as string) || ''
  if (key !== API_KEY) {
    res.status(401).json({ success: false, message: 'API Key 无效' })
    return false
  }
  return true
}

/**
 * @description 单位战报数据（供钉钉推送出图），口径对齐 SalesBattleReport
 * GET /api/battle-report?month=YYYY-MM&salesUnitId=可选
 * Header: X-API-Key
 */
router.get('/battle-report', (req, res) => {
  if (!validateApiKey(req, res)) return

  const yearMonth =
    typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : getCurrentYearMonth()
  const filterUnitId =
    typeof req.query.salesUnitId === 'string' && req.query.salesUnitId
      ? req.query.salesUnitId
      : ''

  const db = getDb()
  const units = db
    .prepare('SELECT * FROM sales_units ORDER BY name')
    .all()
    .map(rowToSalesUnit)
    .filter((u: { id: string }) => !filterUnitId || u.id === filterUnitId)

  // 人员 + 单位归属时间轴（与前端 personBelongsToUnitInMonth 一致）
  const personnelRows = db.prepare('SELECT * FROM personnel').all() as Array<{
    id: string
  }>
  const assignRows = db
    .prepare(
      `SELECT * FROM personnel_unit_assignments
       ORDER BY start_date ASC, created_at ASC`,
    )
    .all() as Array<{ personnel_id: string }>
  const assignMap = new Map<string, typeof assignRows>()
  for (const row of assignRows) {
    const list = assignMap.get(row.personnel_id) || []
    list.push(row)
    assignMap.set(row.personnel_id, list)
  }
  const personnel = personnelRows.map((r) =>
    rowToPersonnel(r, assignMap.get(r.id) || []),
  )
  const salesRecords = db
    .prepare('SELECT * FROM sales_records')
    .all()
    .map(rowToSalesRecord)
  const performanceTargets = db
    .prepare('SELECT * FROM performance_targets')
    .all()
    .map(rowToPerformanceTarget)
  const positionGroupLabels = db
    .prepare('SELECT * FROM position_group_labels ORDER BY created_at')
    .all()
    .map(rowToPositionGroupLabel)
  const upsList = db
    .prepare('SELECT * FROM unit_product_settlements')
    .all()
    .map(rowToUnitProductSettlement)

  const reports = units.map((unit: { id: string; name: string }) =>
    buildUnitBattleReport({
      salesUnitId: unit.id,
      salesUnitName: unit.name,
      yearMonth,
      personnel,
      salesRecords,
      performanceTargets,
      positionGroupLabels,
      upsList,
    }),
  )

  res.json({
    success: true,
    month: yearMonth,
    units: reports,
  })
})

export default router
