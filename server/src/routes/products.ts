import { Router } from "express";
import { getDb, rowToProduct, generateId } from "../db";
import { authMiddleware } from "../auth";
import { requireEditPermission } from "../middleware";

const router = Router();
router.use(authMiddleware);

function productFields(body: any, existing?: any) {
  return {
    name: body.name ?? existing?.name,
    category: body.category ?? existing?.category ?? "",
    salesUnitId: body.salesUnitId !== undefined ? body.salesUnitId : existing?.sales_unit_id,
    unitPrice: body.unitPrice ?? existing?.unit_price ?? 0,
    costType: body.costType ?? existing?.cost_type ?? "fixed",
    unitCost: body.unitCost ?? existing?.unit_cost ?? 0,
    costRate: body.costRate ?? existing?.cost_rate ?? 0,
    description: body.description ?? existing?.description ?? "",
    commissionType: body.commissionType ?? existing?.commission_type ?? "percentage",
    commissionRate: body.commissionRate ?? existing?.commission_rate ?? 0,
    commissionAmount: body.commissionAmount ?? existing?.commission_amount ?? 0,
    commissionNote: body.commissionNote ?? existing?.commission_note ?? "",
    settlementType: body.settlementType ?? existing?.settlement_type ?? "percentage",
    settlementRate: body.settlementRate ?? existing?.settlement_rate ?? 100,
    settlementAmount: body.settlementAmount ?? existing?.settlement_amount ?? 0,
    settlementNote: body.settlementNote ?? existing?.settlement_note ?? "",
  };
}

router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM products ORDER BY name").all();
  res.json(rows.map(rowToProduct));
});

router.post("/ensure", requireEditPermission, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "产品名称不能为空" });
  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM products WHERE lower(trim(name)) = lower(?) LIMIT 1"
  ).get(name);
  if (existing) return res.json(rowToProduct(existing));

  const id = generateId("prod");
  const f = productFields({ ...req.body, name });
  db.prepare(`
    INSERT INTO products (
      id, name, category, sales_unit_id, unit_price, cost_type, unit_cost, cost_rate,
      description, commission_type, commission_rate, commission_amount, commission_note,
      settlement_type, settlement_rate, settlement_amount, settlement_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, f.name, f.category, f.salesUnitId || null, f.unitPrice, f.costType, f.unitCost, f.costRate,
    f.description, f.commissionType, f.commissionRate, f.commissionAmount, f.commissionNote,
    f.settlementType, f.settlementRate, f.settlementAmount, f.settlementNote
  );
  res.json(rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});

router.post("/", requireEditPermission, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "产品名称不能为空" });
  const id = generateId("prod");
  const f = productFields(req.body);
  const db = getDb();
  db.prepare(`
    INSERT INTO products (
      id, name, category, sales_unit_id, unit_price, cost_type, unit_cost, cost_rate,
      description, commission_type, commission_rate, commission_amount, commission_note,
      settlement_type, settlement_rate, settlement_amount, settlement_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, f.name, f.category, f.salesUnitId || null, f.unitPrice, f.costType, f.unitCost, f.costRate,
    f.description, f.commissionType, f.commissionRate, f.commissionAmount, f.commissionNote,
    f.settlementType, f.settlementRate, f.settlementAmount, f.settlementNote
  );
  res.json(rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});

router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "产品不存在" });
  const f = productFields(req.body, existing);
  db.prepare(`
    UPDATE products SET
      name=?, category=?, sales_unit_id=?, unit_price=?, cost_type=?, unit_cost=?, cost_rate=?,
      description=?, commission_type=?, commission_rate=?, commission_amount=?, commission_note=?,
      settlement_type=?, settlement_rate=?, settlement_amount=?, settlement_note=?
    WHERE id=?
  `).run(
    f.name, f.category, f.salesUnitId || null, f.unitPrice, f.costType, f.unitCost, f.costRate,
    f.description, f.commissionType, f.commissionRate, f.commissionAmount, f.commissionNote,
    f.settlementType, f.settlementRate, f.settlementAmount, f.settlementNote, id
  );
  res.json(rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});

router.delete("/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "产品不存在" });
  res.json({ message: "删除成功" });
});

export default router;
