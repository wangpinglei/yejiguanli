import { Router } from "express";
import { getDb, rowToSalesUnit, generateId } from "../db";
import { authMiddleware } from "../auth";
import { getVisibleUnitIds, requireEditPermission } from "../middleware";

const router = Router();

router.use(authMiddleware);

function normalizeStatus(value: unknown): "active" | "inactive" {
  return value === "inactive" ? "inactive" : "active";
}

function normalizeDate(value: unknown): string {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return "";
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/sales-units - 获取销售单位列表（按权限过滤；含停用，前端再筛日常可选）
router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM sales_units ORDER BY created_at").all();

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    rows = rows.filter((r: any) => idSet.has(r.id));
  }

  res.json(rows.map(rowToSalesUnit));
});

// POST /api/sales-units - 创建销售单位
router.post("/", requireEditPermission, (req, res) => {
  const {
    name, type, address, contact, contactPhone, description,
    groupAdminId, militaryCadreId, orgDeptId, unitLeaderId,
    groupAdminName, militaryCadreName, orgDeptName, unitLeaderName,
    status, openedAt, closedAt,
  } = req.body;
  if (!name) {
    return res.status(400).json({ error: "单位名称不能为空" });
  }

  const nextStatus = normalizeStatus(status);
  const nextOpened = normalizeDate(openedAt) || todayYmd();
  const nextClosed = nextStatus === "inactive"
    ? (normalizeDate(closedAt) || todayYmd())
    : "";

  const id = generateId("unit");
  const db = getDb();
  db.prepare(`
    INSERT INTO sales_units (
      id, name, type, address, contact, contact_phone, description,
      group_admin_id, military_cadre_id, org_dept_id, unit_leader_id,
      group_admin_name, military_cadre_name, org_dept_name, unit_leader_name,
      status, opened_at, closed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, type || "company", address || "", contact || "", contactPhone || "", description || "",
    groupAdminId || null, militaryCadreId || null, orgDeptId || null, unitLeaderId || null,
    groupAdminName || "", militaryCadreName || "", orgDeptName || "", unitLeaderName || "",
    nextStatus, nextOpened, nextClosed,
  );

  const row = db.prepare("SELECT * FROM sales_units WHERE id = ?").get(id);
  res.json(rowToSalesUnit(row));
});

// PUT /api/sales-units/:id - 更新销售单位
router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const {
    name, type, address, contact, contactPhone, description,
    groupAdminId, militaryCadreId, orgDeptId, unitLeaderId,
    groupAdminName, militaryCadreName, orgDeptName, unitLeaderName,
    status, openedAt, closedAt,
  } = req.body;

  const db = getDb();
  const existing = db.prepare("SELECT * FROM sales_units WHERE id = ?").get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: "销售单位不存在" });
  }

  const nextStatus = status !== undefined
    ? normalizeStatus(status)
    : normalizeStatus(existing.status);
  let nextOpened = openedAt !== undefined
    ? normalizeDate(openedAt)
    : normalizeDate(existing.opened_at);
  if (!nextOpened) {
    nextOpened = normalizeDate(existing.created_at) || todayYmd();
  }
  let nextClosed = closedAt !== undefined
    ? normalizeDate(closedAt)
    : normalizeDate(existing.closed_at);
  if (nextStatus === "inactive" && !nextClosed) {
    nextClosed = todayYmd();
  }
  if (nextStatus === "active") {
    nextClosed = closedAt !== undefined ? normalizeDate(closedAt) : "";
  }

  db.prepare(`
    UPDATE sales_units SET
      name = ?, type = ?, address = ?, contact = ?, contact_phone = ?, description = ?,
      group_admin_id = ?, military_cadre_id = ?, org_dept_id = ?, unit_leader_id = ?,
      group_admin_name = ?, military_cadre_name = ?, org_dept_name = ?, unit_leader_name = ?,
      status = ?, opened_at = ?, closed_at = ?
    WHERE id = ?
  `).run(
    name ?? existing.name,
    type ?? existing.type,
    address ?? existing.address,
    contact ?? existing.contact,
    contactPhone ?? existing.contact_phone,
    description ?? existing.description,
    groupAdminId !== undefined ? (groupAdminId || null) : existing.group_admin_id,
    militaryCadreId !== undefined ? (militaryCadreId || null) : existing.military_cadre_id,
    orgDeptId !== undefined ? (orgDeptId || null) : existing.org_dept_id,
    unitLeaderId !== undefined ? (unitLeaderId || null) : existing.unit_leader_id,
    groupAdminName ?? existing.group_admin_name ?? "",
    militaryCadreName ?? existing.military_cadre_name ?? "",
    orgDeptName ?? existing.org_dept_name ?? "",
    unitLeaderName ?? existing.unit_leader_name ?? "",
    nextStatus,
    nextOpened,
    nextClosed,
    id,
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
