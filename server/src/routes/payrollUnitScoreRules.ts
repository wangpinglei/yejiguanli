import { Router } from "express";
import { getDb, rowToPayrollUnitScoreRule } from "../db";
import { authMiddleware } from "../auth";
import { requireModuleEdit } from "../middleware";

const router = Router();
router.use(authMiddleware);

function normalizeItems(raw: unknown): Array<{ id: string; name: string; maxScore: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; name: string; maxScore: number }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || "").trim();
    const name = String(row.name || "").trim();
    const maxScore = Number(row.maxScore);
    if (!id || !name || seen.has(id)) continue;
    if (!Number.isFinite(maxScore) || maxScore <= 0) continue;
    seen.add(id);
    out.push({
      id,
      name: name.slice(0, 40),
      maxScore: Math.min(100, Math.round(maxScore * 100) / 100),
    });
  }
  return out.slice(0, 12);
}

function toPayload(row: ReturnType<typeof rowToPayrollUnitScoreRule>) {
  return {
    unitId: row.unitId,
    items: Array.isArray(row.items) ? row.items : [],
    audit: {
      updatedBy: row.updatedBy,
      updatedById: row.updatedById,
      updatedAt: row.updatedAt,
      uploadedAt: row.uploadedAt,
    },
  };
}

/** GET /payroll-unit-score-rules?unitId= 可省略，返回全部 */
router.get("/payroll-unit-score-rules", (req, res) => {
  const unitId = String(req.query.unitId || "").trim();
  const db = getDb();

  if (unitId) {
    const raw = db
      .prepare("SELECT * FROM payroll_unit_score_rules WHERE unit_id=?")
      .get(unitId);
    if (!raw) {
      return res.json({
        unitId,
        items: [],
        audit: null,
        rules: [],
      });
    }
    const row = rowToPayrollUnitScoreRule(raw);
    return res.json({
      ...toPayload(row),
      rules: [toPayload(row)],
    });
  }

  const rows = db
    .prepare("SELECT * FROM payroll_unit_score_rules ORDER BY unit_id")
    .all()
    .map((raw: unknown) => toPayload(rowToPayrollUnitScoreRule(raw)));

  res.json({
    unitId: "",
    items: [],
    audit: null,
    rules: rows,
  });
});

/**
 * PUT /payroll-unit-score-rules
 * body: { unitId, items: [{ id, name, maxScore }] }
 * items 为空数组表示清除该单位规则
 */
router.put("/payroll-unit-score-rules", requireModuleEdit("payroll"), (req, res) => {
  const unitId = String(req.body?.unitId || "").trim();
  if (!unitId) {
    return res.status(400).json({ error: "unitId 必填" });
  }
  const items = normalizeItems(req.body?.items);
  const operator = req.user!.name || req.user!.username || "未知";
  const operatorId = req.user!.id || "";
  const now = new Date().toISOString();
  const db = getDb();

  try {
    if (items.length === 0) {
      db.prepare("DELETE FROM payroll_unit_score_rules WHERE unit_id=?").run(unitId);
      return res.json({
        unitId,
        items: [],
        audit: null,
        rules: [],
      });
    }

    const existing: any = db
      .prepare("SELECT unit_id, uploaded_at FROM payroll_unit_score_rules WHERE unit_id=?")
      .get(unitId);
    const itemsJson = JSON.stringify(items);
    if (existing) {
      db.prepare(`
        UPDATE payroll_unit_score_rules
        SET items_json=?, updated_by=?, updated_by_id=?, updated_at=?
        WHERE unit_id=?
      `).run(itemsJson, operator, operatorId, now, unitId);
    } else {
      db.prepare(`
        INSERT INTO payroll_unit_score_rules (
          unit_id, items_json, updated_by, updated_by_id, updated_at, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(unitId, itemsJson, operator, operatorId, now, now);
    }
  } catch (e: unknown) {
    console.error("[payroll-unit-score-rules] save failed", e);
    return res.status(500).json({ error: "保存绩效评分规则失败" });
  }

  const raw = db
    .prepare("SELECT * FROM payroll_unit_score_rules WHERE unit_id=?")
    .get(unitId);
  const row = rowToPayrollUnitScoreRule(raw);
  res.json({
    ...toPayload(row),
    rules: [toPayload(row)],
  });
});

export default router;
