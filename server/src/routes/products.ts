import { Router } from "express";
import { getDb, rowToProduct, generateId } from "../db";
import { authMiddleware } from "../auth";
import { requireEditPermission } from "../middleware";

const router = Router();

router.use(authMiddleware);

// GET /api/products - 获取产品列表
router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM products ORDER BY name").all();
  res.json(rows.map(rowToProduct));
});

// POST /api/products - 创建产品
router.post("/", requireEditPermission, (req, res) => {
  const { name, category, unitPrice, unitCost, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: "产品名称不能为空" });
  }

  const id = generateId("prod");
  const db = getDb();
  db.prepare(`
    INSERT INTO products (id, name, category, unit_price, unit_cost, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, category || "", unitPrice || 0, unitCost || 0, description || "");

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.json(rowToProduct(row));
});

// PUT /api/products/:id - 更新产品
router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const { name, category, unitPrice, unitCost, description } = req.body;

  const db = getDb();
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "产品不存在" });
  }

  db.prepare(`
    UPDATE products SET name = ?, category = ?, unit_price = ?, unit_cost = ?, description = ?
    WHERE id = ?
  `).run(
    name ?? existing.name,
    category ?? existing.category,
    unitPrice ?? existing.unit_price,
    unitCost ?? existing.unit_cost,
    description ?? existing.description,
    id
  );

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.json(rowToProduct(row));
});

// DELETE /api/products/:id - 删除产品
router.delete("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "产品不存在" });
  }
  res.json({ message: "删除成功" });
});

export default router;
