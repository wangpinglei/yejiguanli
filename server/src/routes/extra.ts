import { Router } from "express";
import {
  getDb, generateId,
  rowToIncomeRecord, rowToRevenueSettlement, rowToUnitProductSettlement,
  rowToProductPersonCommission, rowToCostChangeLog, rowToNotification,
  rowToMonthlyAdjustment, rowToPerformanceTarget, rowToPositionGroupLabel,
} from "../db";
import { authMiddleware } from "../auth";
import { getVisibleUnitIds, requireEditPermission } from "../middleware";

const router = Router();
router.use(authMiddleware);

function filterByUnit(rows: any[], user: Express.Request["user"], field = "sales_unit_id") {
  const visibleIds = getVisibleUnitIds(user!);
  if (visibleIds === null) return rows;
  const idSet = new Set(visibleIds);
  return rows.filter((r) => !r[field] || idSet.has(r[field]));
}

// ---------- income ----------
router.get("/income-records", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM income_records ORDER BY date DESC").all();
  rows = filterByUnit(rows, req.user);
  res.json(rows.map(rowToIncomeRecord));
});

router.post("/income-records", requireEditPermission, (req, res) => {
  const { salesUnitId, date, items, remark, isRecurring, recurringMonths, recurringStartDate, recurringEndDate, changeReason } = req.body;
  if (!salesUnitId || !date) return res.status(400).json({ error: "销售单位和日期不能为空" });
  const costItems = items || [];
  const totalAmount = costItems.reduce((s: number, i: any) => s + (i.amount || 0), 0);
  const id = generateId("ir");
  const db = getDb();
  db.prepare(`
    INSERT INTO income_records (
      id, sales_unit_id, date, items, total_amount, remark, created_by, change_reason,
      is_recurring, recurring_months, recurring_start_date, recurring_end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, salesUnitId, date, JSON.stringify(costItems), totalAmount, remark || "", req.user!.name, changeReason || "",
    isRecurring ? 1 : 0, JSON.stringify(recurringMonths || [1,2,3,4,5,6,7,8,9,10,11,12]),
    recurringStartDate || "", recurringEndDate || ""
  );
  res.json(rowToIncomeRecord(db.prepare("SELECT * FROM income_records WHERE id=?").get(id)));
});

router.put("/income-records/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM income_records WHERE id=?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "收入记录不存在" });
  const items = req.body.items !== undefined ? req.body.items : JSON.parse(existing.items);
  const totalAmount = items.reduce((s: number, i: any) => s + (i.amount || 0), 0);
  db.prepare(`
    UPDATE income_records SET sales_unit_id=?, date=?, items=?, total_amount=?, remark=?, change_reason=?,
      is_recurring=?, recurring_months=?, recurring_start_date=?, recurring_end_date=?
    WHERE id=?
  `).run(
    req.body.salesUnitId ?? existing.sales_unit_id,
    req.body.date ?? existing.date,
    JSON.stringify(items), totalAmount,
    req.body.remark ?? existing.remark,
    req.body.changeReason ?? existing.change_reason,
    req.body.isRecurring != null ? (req.body.isRecurring ? 1 : 0) : existing.is_recurring,
    JSON.stringify(req.body.recurringMonths ?? JSON.parse(existing.recurring_months || "[]")),
    req.body.recurringStartDate ?? existing.recurring_start_date,
    req.body.recurringEndDate ?? existing.recurring_end_date,
    req.params.id
  );
  res.json(rowToIncomeRecord(db.prepare("SELECT * FROM income_records WHERE id=?").get(req.params.id)));
});

router.delete("/income-records/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM income_records WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "收入记录不存在" });
  res.json({ message: "删除成功" });
});

// ---------- revenue settlements ----------
router.get("/revenue-settlements", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM revenue_settlements ORDER BY year_month DESC").all();
  rows = filterByUnit(rows, req.user);
  res.json(rows.map(rowToRevenueSettlement));
});

router.post("/revenue-settlements/upsert", requireEditPermission, (req, res) => {
  const { salesUnitId, yearMonth, estimatedAmount, actualAmount, isAdjusted, remark, adjustedBy, adjustedAt } = req.body;
  if (!salesUnitId || !yearMonth) return res.status(400).json({ error: "单位和月份不能为空" });
  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM revenue_settlements WHERE sales_unit_id=? AND year_month=?"
  ).get(salesUnitId, yearMonth);
  if (existing) {
    db.prepare(`
      UPDATE revenue_settlements SET estimated_amount=?, actual_amount=?, is_adjusted=?, remark=?, adjusted_by=?, adjusted_at=?
      WHERE id=?
    `).run(
      estimatedAmount ?? existing.estimated_amount,
      actualAmount !== undefined ? actualAmount : existing.actual_amount,
      isAdjusted != null ? (isAdjusted ? 1 : 0) : existing.is_adjusted,
      remark ?? existing.remark,
      adjustedBy ?? existing.adjusted_by,
      adjustedAt ?? existing.adjusted_at,
      existing.id
    );
    return res.json(rowToRevenueSettlement(db.prepare("SELECT * FROM revenue_settlements WHERE id=?").get(existing.id)));
  }
  const id = generateId("rs");
  db.prepare(`
    INSERT INTO revenue_settlements (
      id, sales_unit_id, year_month, estimated_amount, actual_amount, is_adjusted, remark, adjusted_by, adjusted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, salesUnitId, yearMonth, estimatedAmount || 0, actualAmount ?? null,
    isAdjusted ? 1 : 0, remark || "", adjustedBy || null, adjustedAt || null
  );
  res.json(rowToRevenueSettlement(db.prepare("SELECT * FROM revenue_settlements WHERE id=?").get(id)));
});

router.delete("/revenue-settlements/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM revenue_settlements WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ message: "删除成功" });
});

// ---------- unit product settlements ----------
router.get("/unit-product-settlements", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM unit_product_settlements").all();
  rows = filterByUnit(rows, req.user);
  res.json(rows.map(rowToUnitProductSettlement));
});

router.post("/unit-product-settlements/upsert", requireEditPermission, (req, res) => {
  const { salesUnitId, productId, settlementType, settlementRate, settlementAmount, note } = req.body;
  if (!salesUnitId || !productId) return res.status(400).json({ error: "单位和产品不能为空" });
  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM unit_product_settlements WHERE sales_unit_id=? AND product_id=?"
  ).get(salesUnitId, productId);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE unit_product_settlements SET settlement_type=?, settlement_rate=?, settlement_amount=?, note=?, updated_at=?
      WHERE id=?
    `).run(
      settlementType || existing.settlement_type,
      settlementRate ?? existing.settlement_rate,
      settlementAmount ?? existing.settlement_amount,
      note ?? existing.note, now, existing.id
    );
    return res.json(rowToUnitProductSettlement(db.prepare("SELECT * FROM unit_product_settlements WHERE id=?").get(existing.id)));
  }
  const id = generateId("ups");
  db.prepare(`
    INSERT INTO unit_product_settlements (
      id, sales_unit_id, product_id, settlement_type, settlement_rate, settlement_amount, note, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, salesUnitId, productId, settlementType || "percentage", settlementRate ?? 100, settlementAmount || 0, note || "", now);
  res.json(rowToUnitProductSettlement(db.prepare("SELECT * FROM unit_product_settlements WHERE id=?").get(id)));
});

router.post("/unit-product-settlements/batch", requireEditPermission, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body.items || []);
  const db = getDb();
  const results: any[] = [];
  const tx = db.transaction(() => {
    for (const item of items) {
      const { salesUnitId, productId, settlementType, settlementRate, settlementAmount, note } = item;
      if (!salesUnitId || !productId) continue;
      const existing = db.prepare(
        "SELECT * FROM unit_product_settlements WHERE sales_unit_id=? AND product_id=?"
      ).get(salesUnitId, productId);
      const now = new Date().toISOString();
      if (existing) {
        db.prepare(`
          UPDATE unit_product_settlements SET settlement_type=?, settlement_rate=?, settlement_amount=?, note=?, updated_at=?
          WHERE id=?
        `).run(settlementType || "percentage", settlementRate ?? 100, settlementAmount || 0, note || "", now, existing.id);
        results.push(rowToUnitProductSettlement(db.prepare("SELECT * FROM unit_product_settlements WHERE id=?").get(existing.id)));
      } else {
        const id = generateId("ups");
        db.prepare(`
          INSERT INTO unit_product_settlements (
            id, sales_unit_id, product_id, settlement_type, settlement_rate, settlement_amount, note, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, salesUnitId, productId, settlementType || "percentage", settlementRate ?? 100, settlementAmount || 0, note || "", now);
        results.push(rowToUnitProductSettlement(db.prepare("SELECT * FROM unit_product_settlements WHERE id=?").get(id)));
      }
    }
  });
  tx();
  res.json(results);
});

router.delete("/unit-product-settlements/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM unit_product_settlements WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ message: "删除成功" });
});

// ---------- product person commissions ----------
router.get("/product-person-commissions", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM product_person_commissions").all();
  rows = filterByUnit(rows, req.user);
  res.json(rows.map(rowToProductPersonCommission));
});

router.post("/product-person-commissions/upsert", requireEditPermission, (req, res) => {
  const b = req.body;
  if (!b.salesUnitId || !b.productId || !b.personnelId) {
    return res.status(400).json({ error: "单位、产品和人员不能为空" });
  }
  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM product_person_commissions WHERE sales_unit_id=? AND product_id=? AND personnel_id=?"
  ).get(b.salesUnitId, b.productId, b.personnelId);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE product_person_commissions SET
        management_commission_rate=?, management_commission_threshold=?, management_commission_condition=?,
        personal_commission_rate=?, personal_commission_threshold=?, personal_commission_condition=?, updated_at=?
      WHERE id=?
    `).run(
      b.managementCommissionRate ?? 0, b.managementCommissionThreshold ?? 0, b.managementCommissionCondition || "",
      b.personalCommissionRate ?? 0, b.personalCommissionThreshold ?? 0, b.personalCommissionCondition || "",
      now, existing.id
    );
    return res.json(rowToProductPersonCommission(db.prepare("SELECT * FROM product_person_commissions WHERE id=?").get(existing.id)));
  }
  const id = generateId("ppc");
  db.prepare(`
    INSERT INTO product_person_commissions (
      id, sales_unit_id, product_id, personnel_id,
      management_commission_rate, management_commission_threshold, management_commission_condition,
      personal_commission_rate, personal_commission_threshold, personal_commission_condition, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, b.salesUnitId, b.productId, b.personnelId,
    b.managementCommissionRate ?? 0, b.managementCommissionThreshold ?? 0, b.managementCommissionCondition || "",
    b.personalCommissionRate ?? 0, b.personalCommissionThreshold ?? 0, b.personalCommissionCondition || "", now
  );
  res.json(rowToProductPersonCommission(db.prepare("SELECT * FROM product_person_commissions WHERE id=?").get(id)));
});

router.delete("/product-person-commissions/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM product_person_commissions WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ message: "删除成功" });
});

// ---------- cost change logs ----------
router.get("/cost-change-logs", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM cost_change_logs ORDER BY timestamp DESC").all();
  res.json(rows.map(rowToCostChangeLog));
});

router.post("/cost-change-logs", requireEditPermission, (req, res) => {
  const b = req.body;
  const id = generateId("ccl");
  const db = getDb();
  db.prepare(`
    INSERT INTO cost_change_logs (
      id, cost_record_id, action, reason, operator, operator_id, timestamp, summary, cost_record_remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, b.costRecordId, b.action, b.reason || "", b.operator || "", b.operatorId || "",
    b.timestamp || new Date().toISOString(), b.summary || "", b.costRecordRemark || ""
  );
  res.json(rowToCostChangeLog(db.prepare("SELECT * FROM cost_change_logs WHERE id=?").get(id)));
});

// ---------- notifications ----------
router.get("/notifications", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM notifications ORDER BY timestamp DESC").all();
  res.json(rows.map(rowToNotification));
});

router.post("/notifications", requireEditPermission, (req, res) => {
  const b = req.body;
  const id = generateId("nt");
  const db = getDb();
  db.prepare(`
    INSERT INTO notifications (id, type, title, message, timestamp, read) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, b.type || "cost_change", b.title || "", b.message || "", b.timestamp || new Date().toISOString(), 0);
  res.json(rowToNotification(db.prepare("SELECT * FROM notifications WHERE id=?").get(id)));
});

router.put("/notifications/:id/read", (req, res) => {
  const db = getDb();
  db.prepare("UPDATE notifications SET read=1 WHERE id=?").run(req.params.id);
  const row = db.prepare("SELECT * FROM notifications WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "通知不存在" });
  res.json(rowToNotification(row));
});

router.put("/notifications/read-all", (_req, res) => {
  const db = getDb();
  db.prepare("UPDATE notifications SET read=1").run();
  res.json({ message: "ok" });
});

// ---------- monthly adjustments ----------
router.get("/monthly-adjustments", (_req, res) => {
  const db = getDb();
  res.json(db.prepare("SELECT * FROM monthly_adjustments").all().map(rowToMonthlyAdjustment));
});

router.post("/monthly-adjustments/upsert", requireEditPermission, (req, res) => {
  const b = req.body;
  if (!b.personnelId || !b.yearMonth) return res.status(400).json({ error: "人员和月份不能为空" });
  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM monthly_adjustments WHERE personnel_id=? AND year_month=?"
  ).get(b.personnelId, b.yearMonth);
  if (existing) {
    db.prepare(`
      UPDATE monthly_adjustments SET leave_days=?, other_bonus=?, other_deduction=?, note=?, created_by=?
      WHERE id=?
    `).run(b.leaveDays ?? 0, b.otherBonus ?? 0, b.otherDeduction ?? 0, b.note || "", b.createdBy || req.user!.name, existing.id);
    return res.json(rowToMonthlyAdjustment(db.prepare("SELECT * FROM monthly_adjustments WHERE id=?").get(existing.id)));
  }
  const id = generateId("ma");
  db.prepare(`
    INSERT INTO monthly_adjustments (
      id, personnel_id, year_month, leave_days, other_bonus, other_deduction, note, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.personnelId, b.yearMonth, b.leaveDays ?? 0, b.otherBonus ?? 0, b.otherDeduction ?? 0, b.note || "", b.createdBy || req.user!.name);
  res.json(rowToMonthlyAdjustment(db.prepare("SELECT * FROM monthly_adjustments WHERE id=?").get(id)));
});

router.delete("/monthly-adjustments/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM monthly_adjustments WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ message: "删除成功" });
});

// ---------- performance targets ----------
router.get("/performance-targets", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM performance_targets").all();
  rows = filterByUnit(rows, req.user);
  res.json(rows.map(rowToPerformanceTarget));
});

router.post("/performance-targets/upsert", requireEditPermission, (req, res) => {
  const b = req.body;
  if (!b.salesUnitId || !b.yearMonth) return res.status(400).json({ error: "单位和月份不能为空" });
  const db = getDb();
  const personnelId = b.personnelId || null;
  let existing;
  if (personnelId) {
    existing = db.prepare(
      "SELECT * FROM performance_targets WHERE sales_unit_id=? AND year_month=? AND personnel_id=?"
    ).get(b.salesUnitId, b.yearMonth, personnelId);
  } else {
    existing = db.prepare(
      "SELECT * FROM performance_targets WHERE sales_unit_id=? AND year_month=? AND personnel_id IS NULL"
    ).get(b.salesUnitId, b.yearMonth);
  }
  if (existing) {
    db.prepare(`UPDATE performance_targets SET target_amount=?, note=?, created_by=? WHERE id=?`)
      .run(b.targetAmount ?? 0, b.note || "", b.createdBy || req.user!.name, existing.id);
    return res.json(rowToPerformanceTarget(db.prepare("SELECT * FROM performance_targets WHERE id=?").get(existing.id)));
  }
  const id = generateId("pt");
  db.prepare(`
    INSERT INTO performance_targets (id, sales_unit_id, year_month, personnel_id, target_amount, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.salesUnitId, b.yearMonth, personnelId, b.targetAmount ?? 0, b.note || "", b.createdBy || req.user!.name);
  res.json(rowToPerformanceTarget(db.prepare("SELECT * FROM performance_targets WHERE id=?").get(id)));
});

router.post("/performance-targets/batch", requireEditPermission, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body.items || []);
  const results: any[] = [];
  const db = getDb();
  const tx = db.transaction(() => {
    for (const b of items) {
      if (!b.salesUnitId || !b.yearMonth) continue;
      const personnelId = b.personnelId || null;
      let existing;
      if (personnelId) {
        existing = db.prepare(
          "SELECT * FROM performance_targets WHERE sales_unit_id=? AND year_month=? AND personnel_id=?"
        ).get(b.salesUnitId, b.yearMonth, personnelId);
      } else {
        existing = db.prepare(
          "SELECT * FROM performance_targets WHERE sales_unit_id=? AND year_month=? AND personnel_id IS NULL"
        ).get(b.salesUnitId, b.yearMonth);
      }
      if (existing) {
        db.prepare(`UPDATE performance_targets SET target_amount=?, note=? WHERE id=?`)
          .run(b.targetAmount ?? 0, b.note || "", existing.id);
        results.push(rowToPerformanceTarget(db.prepare("SELECT * FROM performance_targets WHERE id=?").get(existing.id)));
      } else {
        const id = generateId("pt");
        db.prepare(`
          INSERT INTO performance_targets (id, sales_unit_id, year_month, personnel_id, target_amount, note, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, b.salesUnitId, b.yearMonth, personnelId, b.targetAmount ?? 0, b.note || "", req.user!.name);
        results.push(rowToPerformanceTarget(db.prepare("SELECT * FROM performance_targets WHERE id=?").get(id)));
      }
    }
  });
  tx();
  res.json(results);
});

router.delete("/performance-targets/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM performance_targets WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "记录不存在" });
  res.json({ message: "删除成功" });
});

// ---------- position group labels ----------
router.get("/position-group-labels", (_req, res) => {
  const db = getDb();
  res.json(db.prepare("SELECT * FROM position_group_labels ORDER BY created_at").all().map(rowToPositionGroupLabel));
});

router.post("/position-group-labels", requireEditPermission, (req, res) => {
  const { keyword, label, color, description } = req.body;
  if (!keyword || !label) return res.status(400).json({ error: "关键词和标签不能为空" });
  const id = generateId("pgl");
  const db = getDb();
  db.prepare(`
    INSERT INTO position_group_labels (id, keyword, label, color, description) VALUES (?, ?, ?, ?, ?)
  `).run(id, keyword, label, color || "gray", description || "");
  res.json(rowToPositionGroupLabel(db.prepare("SELECT * FROM position_group_labels WHERE id=?").get(id)));
});

router.put("/position-group-labels/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM position_group_labels WHERE id=?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "标签不存在" });
  db.prepare(`UPDATE position_group_labels SET keyword=?, label=?, color=?, description=? WHERE id=?`).run(
    req.body.keyword ?? existing.keyword,
    req.body.label ?? existing.label,
    req.body.color ?? existing.color,
    req.body.description ?? existing.description,
    req.params.id
  );
  res.json(rowToPositionGroupLabel(db.prepare("SELECT * FROM position_group_labels WHERE id=?").get(req.params.id)));
});

router.delete("/position-group-labels/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM position_group_labels WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "标签不存在" });
  res.json({ message: "删除成功" });
});

export default router;
