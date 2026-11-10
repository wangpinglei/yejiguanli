import { Router } from "express";
import {
  generateId,
  getDb,
  rowToCommissionOrderAdjScope,
  runInTransaction,
} from "../db";
import { authMiddleware } from "../auth";
import { requireModuleEdit } from "../middleware";

const router = Router();
router.use(authMiddleware);

function isValidYearMonth(ym: unknown): ym is string {
  return typeof ym === "string" && /^\d{4}-\d{2}$/.test(ym);
}

function normalizeAdjustments(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [saleId, adj] of Object.entries(raw as Record<string, unknown>)) {
    const sid = String(saleId || "").trim();
    if (!sid) continue;
    if (!adj || typeof adj !== "object" || Array.isArray(adj)) continue;
    const a = adj as Record<string, unknown>;
    const salesAmountAdj = Number(a.salesAmountAdj) || 0;
    const rateAdjPct = Number(a.rateAdjPct) || 0;
    const commissionAmountAdj = Number(a.commissionAmountAdj) || 0;
    const note = String(a.note || "").trim();
    const has =
      Math.abs(salesAmountAdj) > 0.0005 ||
      Math.abs(rateAdjPct) > 0.0005 ||
      Math.abs(commissionAmountAdj) > 0.0005 ||
      Boolean(note);
    if (!has) continue;
    out[sid] = {
      salesAmountAdj,
      rateAdjPct,
      commissionAmountAdj,
      note,
    };
  }
  return out;
}

function toPayload(row: ReturnType<typeof rowToCommissionOrderAdjScope>) {
  return {
    yearMonth: row.yearMonth,
    personnelId: row.personnelId,
    unitId: row.unitId,
    adjustments:
      row.adjustments && typeof row.adjustments === "object"
        ? row.adjustments
        : {},
    audit: {
      updatedBy: row.updatedBy,
      updatedById: row.updatedById,
      updatedAt: row.updatedAt,
      uploadedAt: row.uploadedAt,
    },
  };
}

/**
 * GET /commission-order-adj?yearMonth=YYYY-MM&personnelId=&unitId=
 * 可只传 yearMonth，返回该月全部 scope
 */
router.get("/commission-order-adj", (req, res) => {
  const yearMonth = String(req.query.yearMonth || "").slice(0, 7);
  if (!isValidYearMonth(yearMonth)) {
    return res.status(400).json({ error: "yearMonth 格式须为 YYYY-MM" });
  }
  const personnelId = String(req.query.personnelId || "").trim();
  const unitId = String(req.query.unitId || "").trim();
  const db = getDb();

  if (personnelId && unitId) {
    const raw = db
      .prepare(
        `SELECT * FROM commission_order_adj_scopes
         WHERE year_month=? AND personnel_id=? AND unit_id=?`,
      )
      .get(yearMonth, personnelId, unitId);
    if (!raw) {
      return res.json({
        yearMonth,
        personnelId,
        unitId,
        adjustments: {},
        audit: null,
        scopes: [],
        summary: {
          scopeCount: 0,
          updatedBy: "",
          updatedAt: "",
          uploadedAt: "",
        },
      });
    }
    const row = rowToCommissionOrderAdjScope(raw);
    const item = toPayload(row);
    return res.json({
      ...item,
      scopes: [item],
      summary: {
        scopeCount: 1,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt,
        uploadedAt: row.uploadedAt,
      },
    });
  }

  const rows = (
    db
      .prepare(
        `SELECT * FROM commission_order_adj_scopes
         WHERE year_month=?
         ORDER BY personnel_id, unit_id`,
      )
      .all(yearMonth) as unknown[]
  ).map(rowToCommissionOrderAdjScope);

  let latestUpdatedAt = "";
  let latestUpdatedBy = "";
  let earliestUploadedAt = "";
  const scopes = rows.map((row: ReturnType<typeof rowToCommissionOrderAdjScope>) => {
    if (row.updatedAt && row.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = row.updatedAt;
      latestUpdatedBy = row.updatedBy;
    }
    if (row.uploadedAt) {
      if (!earliestUploadedAt || row.uploadedAt < earliestUploadedAt) {
        earliestUploadedAt = row.uploadedAt;
      }
    }
    return toPayload(row);
  });

  res.json({
    yearMonth,
    scopes,
    summary: {
      scopeCount: scopes.length,
      updatedBy: latestUpdatedBy,
      updatedAt: latestUpdatedAt,
      uploadedAt: earliestUploadedAt,
    },
  });
});

/**
 * PUT /commission-order-adj
 * body: { yearMonth, personnelId, unitId, adjustments }
 */
router.put(
  "/commission-order-adj",
  requireModuleEdit("payroll"),
  (req, res) => {
    const yearMonth = String(req.body?.yearMonth || "").slice(0, 7);
    const personnelId = String(req.body?.personnelId || "").trim();
    const unitId = String(req.body?.unitId || "").trim();
    if (!isValidYearMonth(yearMonth)) {
      return res.status(400).json({ error: "yearMonth 格式须为 YYYY-MM" });
    }
    if (!personnelId || !unitId) {
      return res.status(400).json({ error: "personnelId、unitId 必填" });
    }

    const adjustments = normalizeAdjustments(req.body?.adjustments);
    const operator = req.user!.name || req.user!.username || "未知";
    const operatorId = req.user!.id || "";
    const now = new Date().toISOString();
    const db = getDb();
    const json = JSON.stringify(adjustments);

    try {
      runInTransaction(() => {
        const existing: any = db
          .prepare(
            `SELECT id, uploaded_at FROM commission_order_adj_scopes
             WHERE year_month=? AND personnel_id=? AND unit_id=?`,
          )
          .get(yearMonth, personnelId, unitId);

        if (Object.keys(adjustments).length === 0) {
          if (existing) {
            db.prepare("DELETE FROM commission_order_adj_scopes WHERE id=?").run(
              existing.id,
            );
          }
          return;
        }

        if (existing) {
          db.prepare(
            `UPDATE commission_order_adj_scopes
             SET adj_json=?, updated_by=?, updated_by_id=?, updated_at=?
             WHERE id=?`,
          ).run(json, operator, operatorId, now, existing.id);
        } else {
          db.prepare(
            `INSERT INTO commission_order_adj_scopes (
              id, year_month, personnel_id, unit_id, adj_json,
              updated_by, updated_by_id, updated_at, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            generateId("coa"),
            yearMonth,
            personnelId,
            unitId,
            json,
            operator,
            operatorId,
            now,
            now,
          );
        }
      });
    } catch (e: unknown) {
      console.error("[commission-order-adj] save failed", e);
      return res.status(500).json({ error: "保存单笔提成调整失败" });
    }

    const raw = db
      .prepare(
        `SELECT * FROM commission_order_adj_scopes
         WHERE year_month=? AND personnel_id=? AND unit_id=?`,
      )
      .get(yearMonth, personnelId, unitId);

    if (!raw) {
      return res.json({
        yearMonth,
        personnelId,
        unitId,
        adjustments: {},
        audit: {
          updatedBy: operator,
          updatedById: operatorId,
          updatedAt: now,
          uploadedAt: now,
        },
        scopes: [],
        summary: {
          scopeCount: 0,
          updatedBy: operator,
          updatedAt: now,
          uploadedAt: now,
        },
      });
    }

    const row = rowToCommissionOrderAdjScope(raw);
    const item = toPayload(row);
    res.json({
      ...item,
      scopes: [item],
      summary: {
        scopeCount: 1,
        updatedBy: row.updatedBy || operator,
        updatedAt: row.updatedAt || now,
        uploadedAt: row.uploadedAt || now,
      },
    });
  },
);

export default router;
