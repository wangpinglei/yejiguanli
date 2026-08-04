import { Router } from "express";
import { getDb, rowToSalesUnit, generateId } from "../db";
import { authMiddleware } from "../auth";
import { getVisibleUnitIds, isReadOnly, requireEditPermission } from "../middleware";

const router = Router();

router.use(authMiddleware);

// GET /api/sales-units - 获取销售单位列表（按权限过滤）
router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM sales_units ORDER BY created_at").all();

  // 按权限过滤
  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    rows = rows.filter((r: any) => idSet.has(r.id));
  }

  res.json(rows.map(rowToSalesUnit));
});

// POST /api/sales-units - 创建销售单位
router.post("/", requireEditPermission, (req, res) => {
  const { name, type, address, contact, contactPhone, description, groupAdminId, militaryCadreId, orgDeptId, unitLeaderId } = req.body;
  if (!name) {
    return res.status(400).json({ error: "单位名称不能为空" });
  }

  const id = generateId("unit");
  const db = getDb();
  db.prepare(`
    INSERT INTO sales_units (id, name, type, address, contact, contact_phone, description, group_admin_id, military_cadre_id, org_dept_id, unit_leader_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type || "company", address || "", contact || "", contactPhone || "", description || "", groupAdminId || null, militaryCadreId || null, orgDeptId || null, unitLeaderId || null);

  const row = db.prepare("SELECT * FROM sales_units WHERE id = ?").get(id);
  res.json(rowToSalesUnit(row));
});

// PUT /api/sales-units/:id - 更新销售单位
router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const { name, type, address, contact, contactPhone, description, groupAdminId, militaryCadreId, orgDeptId, unitLeaderId } = req.body;

  const db = getDb();
  const existing = db.prepare("SELECT * FROM sales_units WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "销售单位不存在" });
  }

  db.prepare(`
    UPDATE sales_units SET
      name = ?, type = ?, address = ?, contact = ?, contact_phone = ?, description = ?,
      group_admin_id = ?, military_cadre_id = ?, org_dept_id = ?, unit_leader_id = ?
    WHERE id = ?
  `).run(
    name ?? existing.name,
    type ?? existing.type,
    address ?? existing.address,
    contact ?? existing.contact,
    contactPhone ?? existing.contact_phone,
    description ?? existing.description,
    groupAdminId ?? existing.group_admin_id,
    militaryCadreId ?? existing.military_cadre_id,
    orgDeptId ?? existing.org_dept_id,
    unitLeaderId ?? existing.unit_leader_id,
    id
  );

  const row = db.prepare("SELECT * FROM sales_units WHERE id = ?").get(id);
  res.json(rowToSalesUnit(row));
});

// DELETE /api/sales-units/:id - 删除销售单位
router.delete("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const result = db.prepare("DELETE FROM sales_units WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "销售单位不存在" });
  }
  res.json({ message: "删除成功" });
});

export default router;
