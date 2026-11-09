import { Router } from "express";
import {
  generateId,
  getDb,
  rowToPayrollMonthEntry,
  rowToPayrollMonthScope,
  runInTransaction,
} from "../db";
import { authMiddleware } from "../auth";
import { requireModuleEdit } from "../middleware";

const router = Router();
router.use(authMiddleware);

function isValidYearMonth(ym: unknown): ym is string {
  return typeof ym === "string" && /^\d{4}-\d{2}$/.test(ym);
}

/** GET /payroll-entries?yearMonth=YYYY-MM */
router.get("/payroll-entries", (req, res) => {
  const yearMonth = String(req.query.yearMonth || "").slice(0, 7);
  if (!isValidYearMonth(yearMonth)) {
    return res.status(400).json({ error: "yearMonth 格式须为 YYYY-MM" });
  }
  const db = getDb();
  const entryRows = db
    .prepare(
      "SELECT * FROM payroll_month_entries WHERE year_month=? ORDER BY personnel_id",
    )
    .all(yearMonth);
  const scopeRow = db
    .prepare("SELECT * FROM payroll_month_scopes WHERE year_month=?")
    .get(yearMonth);

  const entries: Record<string, unknown> = {};
  const audits: Record<
    string,
    { updatedBy: string; updatedById: string; updatedAt: string; uploadedAt: string }
  > = {};
  let latestUpdatedAt = "";
  let latestUpdatedBy = "";
  let earliestUploadedAt = "";

  for (const raw of entryRows) {
    const row = rowToPayrollMonthEntry(raw);
    const pid = String(row.personnelId || "").trim();
    if (!pid) continue;
    entries[pid] = {
      ...(row.entry && typeof row.entry === "object" ? row.entry : {}),
      personnelId: pid,
    };
    audits[pid] = {
      updatedBy: row.updatedBy,
      updatedById: row.updatedById,
      updatedAt: row.updatedAt,
      uploadedAt: row.uploadedAt,
    };
    if (row.updatedAt && row.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = row.updatedAt;
      latestUpdatedBy = row.updatedBy;
    }
    if (row.uploadedAt) {
      if (!earliestUploadedAt || row.uploadedAt < earliestUploadedAt) {
        earliestUploadedAt = row.uploadedAt;
      }
    }
  }

  const scope = scopeRow ? rowToPayrollMonthScope(scopeRow) : null;
  if (scope?.updatedAt && scope.updatedAt > latestUpdatedAt) {
    latestUpdatedAt = scope.updatedAt;
    latestUpdatedBy = scope.updatedBy;
  }
  if (scope?.uploadedAt) {
    if (!earliestUploadedAt || scope.uploadedAt < earliestUploadedAt) {
      earliestUploadedAt = scope.uploadedAt;
    }
  }

  res.json({
    yearMonth,
    scopeUnitIds: Array.isArray(scope?.unitIds)
      ? scope!.unitIds.map(String).filter(Boolean)
      : [],
    entries,
    audits,
    scopeAudit: scope
      ? {
          updatedBy: scope.updatedBy,
          updatedById: scope.updatedById,
          updatedAt: scope.updatedAt,
          uploadedAt: scope.uploadedAt,
        }
      : null,
    summary: {
      entryCount: Object.keys(entries).length,
      updatedBy: latestUpdatedBy,
      updatedAt: latestUpdatedAt,
      uploadedAt: earliestUploadedAt,
    },
  });
});

/**
 * PUT /payroll-entries
 * body: { yearMonth, entries: Record<personnelId, entry>, scopeUnitIds?: string[] }
 */
router.put("/payroll-entries", requireModuleEdit("payroll"), (req, res) => {
  const yearMonth = String(req.body?.yearMonth || "").slice(0, 7);
  if (!isValidYearMonth(yearMonth)) {
    return res.status(400).json({ error: "yearMonth 格式须为 YYYY-MM" });
  }
  const rawEntries = req.body?.entries;
  if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) {
    return res.status(400).json({ error: "entries 须为对象" });
  }

  const operator = req.user!.name || req.user!.username || "未知";
  const operatorId = req.user!.id || "";
  const now = new Date().toISOString();
  const db = getDb();

  try {
    runInTransaction(() => {
      const selectStmt = db.prepare(
        "SELECT id, uploaded_at FROM payroll_month_entries WHERE year_month=? AND personnel_id=?",
      );
      const updateStmt = db.prepare(`
        UPDATE payroll_month_entries
        SET entry_json=?, updated_by=?, updated_by_id=?, updated_at=?
        WHERE id=?
      `);
      const insertStmt = db.prepare(`
        INSERT INTO payroll_month_entries (
          id, year_month, personnel_id, entry_json,
          updated_by, updated_by_id, updated_at, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [personnelId, entry] of Object.entries(rawEntries as Record<string, unknown>)) {
        const pid = String(personnelId || "").trim();
        if (!pid) continue;
        const payload = {
          ...(entry && typeof entry === "object" ? (entry as object) : {}),
          personnelId: pid,
        };
        const json = JSON.stringify(payload);
        const existing: any = selectStmt.get(yearMonth, pid);
        if (existing) {
          updateStmt.run(json, operator, operatorId, now, existing.id);
        } else {
          insertStmt.run(
            generateId("pe"),
            yearMonth,
            pid,
            json,
            operator,
            operatorId,
            now,
            now,
          );
        }
      }

      if (Array.isArray(req.body?.scopeUnitIds)) {
        const unitIds = (req.body.scopeUnitIds as unknown[])
          .map((id) => String(id || "").trim())
          .filter(Boolean);
        const scopeExisting: any = db
          .prepare("SELECT year_month, uploaded_at FROM payroll_month_scopes WHERE year_month=?")
          .get(yearMonth);
        const unitJson = JSON.stringify(unitIds);
        if (scopeExisting) {
          db.prepare(`
            UPDATE payroll_month_scopes
            SET unit_ids_json=?, updated_by=?, updated_by_id=?, updated_at=?
            WHERE year_month=?
          `).run(unitJson, operator, operatorId, now, yearMonth);
        } else {
          db.prepare(`
            INSERT INTO payroll_month_scopes (
              year_month, unit_ids_json, updated_by, updated_by_id, updated_at, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(yearMonth, unitJson, operator, operatorId, now, now);
        }
      }
    });
  } catch (e: unknown) {
    console.error("[payroll-entries] save failed", e);
    return res.status(500).json({ error: "保存工资录入失败" });
  }

  const entryRows = db
    .prepare("SELECT * FROM payroll_month_entries WHERE year_month=?")
    .all(yearMonth);
  const scopeRow = db
    .prepare("SELECT * FROM payroll_month_scopes WHERE year_month=?")
    .get(yearMonth);

  const entries: Record<string, unknown> = {};
  const audits: Record<string, unknown> = {};
  for (const raw of entryRows) {
    const row = rowToPayrollMonthEntry(raw);
    const pid = String(row.personnelId || "").trim();
    if (!pid) continue;
    entries[pid] = {
      ...(row.entry && typeof row.entry === "object" ? row.entry : {}),
      personnelId: pid,
    };
    audits[pid] = {
      updatedBy: row.updatedBy,
      updatedById: row.updatedById,
      updatedAt: row.updatedAt,
      uploadedAt: row.uploadedAt,
    };
  }
  const scope = scopeRow ? rowToPayrollMonthScope(scopeRow) : null;

  res.json({
    yearMonth,
    scopeUnitIds: Array.isArray(scope?.unitIds)
      ? scope!.unitIds.map(String).filter(Boolean)
      : [],
    entries,
    audits,
    scopeAudit: scope
      ? {
          updatedBy: scope.updatedBy,
          updatedById: scope.updatedById,
          updatedAt: scope.updatedAt,
          uploadedAt: scope.uploadedAt,
        }
      : null,
    summary: {
      entryCount: Object.keys(entries).length,
      updatedBy: operator,
      updatedAt: now,
      uploadedAt: scope?.uploadedAt || now,
    },
  });
});

export default router;
