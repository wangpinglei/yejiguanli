import { Router, Request, Response } from 'express'
import {
  getDb,
  rowToPersonnel,
  rowToSalesRecord,
  rowToPerformanceTarget,
  rowToPositionGroupLabel,
  rowToSalesUnit,
} from '../db'
import { buildUnitBattleReport } from '../lib/battleReport'

const router = Router()

const API_KEY =
  process.env.BATTLE_REPORT_API_KEY ||
  process.env.SYNC_API_KEY ||
  'eco-sync-2026-secret'

function getCurrentYearMonth(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}`
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

  const personnel = db.prepare('SELECT * FROM personnel').all().map(rowToPersonnel)
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

  const reports = units.map((unit: { id: string; name: string }) =>
    buildUnitBattleReport({
      salesUnitId: unit.id,
      salesUnitName: unit.name,
      yearMonth,
      personnel,
      salesRecords,
      performanceTargets,
      positionGroupLabels,
    }),
  )

  res.json({
    success: true,
    month: yearMonth,
    units: reports,
  })
})

export default router
