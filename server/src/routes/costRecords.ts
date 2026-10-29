import { Router } from "express";
import { getDb, rowToCostRecord, generateId } from "../db";
import { authMiddleware } from "../auth";
import { assertUnitAccess, getVisibleUnitIds, requireEditPermission } from "../middleware";

const router = Router();

const DEFAULT_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

router.use(authMiddleware);

// GET /api/cost-records - 获取成本记录（按权限过滤）
router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM cost_records ORDER BY date DESC, created_at DESC").all();

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    rows = rows.filter((r: any) => idSet.has(r.sales_unit_id));
  }

  const { salesUnitId } = req.query;
  if (salesUnitId) {
    rows = rows.filter((r: any) => r.sales_unit_id === salesUnitId);
  }

  res.json(rows.map(rowToCostRecord));
});

// POST /api/cost-records - 创建成本记录
router.post("/", requireEditPermission, (req, res) => {
  const {
    salesUnitId, date, items, remark, changeReason,
    isRecurring, recurringMonths, recurringStartDate, recurringEndDate,
  } = req.body;
  if (!salesUnitId || !date) {
    return res.status(400).json({ error: "销售单位和日期不能为空" });
  }
  if (!assertUnitAccess(req, res, salesUnitId)) return;
  const costItems = items || [];
  const totalCost = costItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
  const id = generateId("cr");
  const db = getDb();
  const monthsJson = JSON.stringify(
    isRecurring ? (recurringMonths || DEFAULT_MONTHS) : DEFAULT_MONTHS,
  );

  db.prepare(`
    INSERT INTO cost_records (
      id, sales_unit_id, date, items, total_cost, remark, created_by, change_reason,
      is_recurring, recurring_months, recurring_start_date, recurring_end_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    salesUnitId,
    date,
    JSON.stringify(costItems),
    totalCost,
    remark || "",
    req.user!.name,
    changeReason || "",
    isRecurring ? 1 : 0,
    monthsJson,
    recurringStartDate || (isRecurring ? date : ""),
    recurringEndDate || "",
  );

  const row = db.prepare("SELECT * FROM cost_records WHERE id = ?").get(id);
  res.json(rowToCostRecord(row));
});

// PUT /api/cost-records/:id - 更新成本记录
router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing: any = db.prepare("SELECT * FROM cost_records WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "成本记录不存在" });
  }
  if (!assertUnitAccess(req, res, existing.sales_unit_id)) return;

  const {
    salesUnitId, date, items, remark, changeReason,
    isRecurring, recurringMonths, recurringStartDate, recurringEndDate,
  } = req.body;
  if (salesUnitId != null && !assertUnitAccess(req, res, salesUnitId)) return;
  const costItems = items !== undefined ? items : JSON.parse(existing.items);
  const totalCost = costItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);

  const nextRecurring = isRecurring != null
    ? (isRecurring ? 1 : 0)
    : existing.is_recurring;
  // 关闭循环时清空起止与适用月，避免残留导致后续月份仍计入
  let nextMonths: string;
  let nextStart: string;
  let nextEnd: string;
  if (nextRecurring === 0) {
    nextMonths = JSON.stringify([]);
    nextStart = "";
    nextEnd = "";
  } else {
    nextMonths = recurringMonths != null
      ? JSON.stringify(recurringMonths)
      : (existing.recurring_months || JSON.stringify(DEFAULT_MONTHS));
    nextStart = recurringStartDate !== undefined
      ? (recurringStartDate || "")
      : (existing.recurring_start_date || "");
    nextEnd = recurringEndDate !== undefined
      ? (recurringEndDate || "")
      : (existing.recurring_end_date || "");
  }

  db.prepare(`
    UPDATE cost_records SET
      sales_unit_id = ?, date = ?, items = ?, total_cost = ?, remark = ?, change_reason = ?,
      is_recurring = ?, recurring_months = ?, recurring_start_date = ?, recurring_end_date = ?
    WHERE id = ?
  `).run(
    salesUnitId ?? existing.sales_unit_id,
    date ?? existing.date,
    JSON.stringify(costItems),
    totalCost,
    remark ?? existing.remark,
    changeReason ?? existing.change_reason,
    nextRecurring,
    nextMonths,
    nextStart,
    nextEnd,
    id,
  );

  const row = db.prepare("SELECT * FROM cost_records WHERE id = ?").get(id);
  res.json(rowToCostRecord(row));
});

// DELETE /api/cost-records/:id - 删除成本记录
router.delete("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const result = db.prepare("DELETE FROM cost_records WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "成本记录不存在" });
  }
  res.json({ message: "删除成功" });
});

export default router;
