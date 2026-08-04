import { Router } from "express";
import { getDb, rowToSalesRecord, generateId } from "../db";
import { authMiddleware } from "../auth";
import { getVisibleUnitIds, requireEditPermission } from "../middleware";

const router = Router();

router.use(authMiddleware);

// GET /api/sales-records - 获取销售记录（按权限过滤）
router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM sales_records ORDER BY sale_date DESC").all();

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    rows = rows.filter((r: any) => idSet.has(r.sales_unit_id));
  }

  // 支持按单位/人员筛选
  const { salesUnitId, personnelId } = req.query;
  if (salesUnitId) {
    rows = rows.filter((r: any) => r.sales_unit_id === salesUnitId);
  }
  if (personnelId) {
    rows = rows.filter((r: any) => r.personnel_id === personnelId);
  }

  res.json(rows.map(rowToSalesRecord));
});

// POST /api/sales-records - 创建销售记录
router.post("/", requireEditPermission, (req, res) => {
  const { salesUnitId, personnelId, productId, quantity, unitPrice, saleDate, remark } = req.body;
  if (!salesUnitId || !personnelId || !productId || !saleDate) {
    return res.status(400).json({ error: "销售单位、人员、产品和销售日期不能为空" });
  }

  const qty = quantity || 1;
  const price = unitPrice || 0;
  const totalAmount = qty * price;

  const id = generateId("sr");
  const db = getDb();
  db.prepare(`
    INSERT INTO sales_records (id, sales_unit_id, personnel_id, product_id, quantity, unit_price, total_amount, sale_date, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, salesUnitId, personnelId, productId, qty, price, totalAmount, saleDate, remark || "");

  const row = db.prepare("SELECT * FROM sales_records WHERE id = ?").get(id);
  res.json(rowToSalesRecord(row));
});

// PUT /api/sales-records/:id - 更新销售记录
router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM sales_records WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "销售记录不存在" });
  }

  const { salesUnitId, personnelId, productId, quantity, unitPrice, saleDate, remark } = req.body;
  const qty = quantity ?? existing.quantity;
  const price = unitPrice ?? existing.unit_price;
  const totalAmount = qty * price;

  db.prepare(`
    UPDATE sales_records SET
      sales_unit_id = ?, personnel_id = ?, product_id = ?, quantity = ?,
      unit_price = ?, total_amount = ?, sale_date = ?, remark = ?
    WHERE id = ?
  `).run(
    salesUnitId ?? existing.sales_unit_id,
    personnelId ?? existing.personnel_id,
    productId ?? existing.product_id,
    qty,
    price,
    totalAmount,
    saleDate ?? existing.sale_date,
    remark ?? existing.remark,
    id
  );

  const row = db.prepare("SELECT * FROM sales_records WHERE id = ?").get(id);
  res.json(rowToSalesRecord(row));
});

// DELETE /api/sales-records/:id - 删除销售记录
router.delete("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const result = db.prepare("DELETE FROM sales_records WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "销售记录不存在" });
  }
  res.json({ message: "删除成功" });
});

export default router;
