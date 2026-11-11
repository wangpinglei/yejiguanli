import { Router } from "express";
import { getDb, rowToActivityCostRule } from "../db";
import { authMiddleware } from "../auth";
import { requireModuleEdit } from "../middleware";
import {
  normalizeActivityName,
  isBlankActivity,
  normalizeRuleDate,
} from "../lib/activityCost";

const router = Router();
router.use(authMiddleware);

function toPayload(row: ReturnType<typeof rowToActivityCostRule>) {
  return {
    activityName: row.activityName,
    costType: row.costType,
    costValue: row.costValue,
    startDate: row.startDate || "",
    endDate: row.endDate || "",
    audit: {
      updatedBy: row.updatedBy,
      updatedById: row.updatedById,
      updatedAt: row.updatedAt,
    },
  };
}

/** GET /activity-cost-rules */
router.get("/activity-cost-rules", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM activity_cost_rules ORDER BY activity_name COLLATE NOCASE")
    .all()
    .map((raw: unknown) => toPayload(rowToActivityCostRule(raw)));
  res.json({ rules: rows });
});

/**
 * PUT /activity-cost-rules
 * body: { activityName, costType, costValue, startDate, endDate }
 */
router.put("/activity-cost-rules", requireModuleEdit("activity_cost"), (req, res) => {
  const activityName = normalizeActivityName(req.body?.activityName);
  if (isBlankActivity(activityName)) {
    return res.status(400).json({ error: "活动名称不能为空" });
  }
  const costType = req.body?.costType === "percentage" ? "percentage" : "fixed";
  const costValue = Number(req.body?.costValue);
  if (!Number.isFinite(costValue) || costValue < 0) {
    return res.status(400).json({ error: "扣除值须为 ≥ 0 的数字" });
  }
  if (costType === "percentage" && costValue > 100) {
    return res.status(400).json({ error: "比例不能超过 100%" });
  }

  const startDate = normalizeRuleDate(req.body?.startDate);
  const endDate = normalizeRuleDate(req.body?.endDate);
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "请填写活动起止日期" });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: "开始日期不能晚于结束日期" });
  }

  const operator = req.user!.name || req.user!.username || "未知";
  const operatorId = req.user!.id || "";
  const now = new Date().toISOString();
  const db = getDb();

  const existing = db
    .prepare("SELECT activity_name FROM activity_cost_rules WHERE activity_name=?")
    .get(activityName) as { activity_name?: string } | undefined;

  if (existing?.activity_name) {
    db.prepare(`
      UPDATE activity_cost_rules
      SET cost_type=?, cost_value=?, start_date=?, end_date=?,
          updated_by=?, updated_by_id=?, updated_at=?
      WHERE activity_name=?
    `).run(
      costType,
      costValue,
      startDate,
      endDate,
      operator,
      operatorId,
      now,
      activityName,
    );
  } else {
    db.prepare(`
      INSERT INTO activity_cost_rules (
        activity_name, cost_type, cost_value, start_date, end_date,
        updated_by, updated_by_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      activityName,
      costType,
      costValue,
      startDate,
      endDate,
      operator,
      operatorId,
      now,
    );
  }

  const row = rowToActivityCostRule(
    db.prepare("SELECT * FROM activity_cost_rules WHERE activity_name=?").get(activityName),
  );
  res.json(toPayload(row));
});

/** DELETE /activity-cost-rules/:activityName */
router.delete(
  "/activity-cost-rules/:activityName",
  requireModuleEdit("activity_cost"),
  (req, res) => {
    const activityName = normalizeActivityName(req.params.activityName);
    if (isBlankActivity(activityName)) {
      return res.status(400).json({ error: "活动名称不能为空" });
    }
    const db = getDb();
    db.prepare("DELETE FROM activity_cost_rules WHERE activity_name=?").run(activityName);
    res.json({ ok: true, activityName });
  },
);

export default router;
