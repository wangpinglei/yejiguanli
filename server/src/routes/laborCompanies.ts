import { Router } from "express";
import { getDb, generateId } from "../db";
import { authMiddleware } from "../auth";
import { requireModuleView, requireModuleEdit } from "../middleware";

const router = Router();

router.use(authMiddleware);
router.use(requireModuleView("hr_management"));

function rowToLaborCompany(row: any) {
  return {
    id: row.id,
    name: row.name || "",
    remark: row.remark || "",
    createdAt: row.created_at || "",
  };
}

// GET /api/labor-companies
router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM labor_companies ORDER BY name COLLATE NOCASE")
    .all();
  res.json(rows.map(rowToLaborCompany));
});

// POST /api/labor-companies
router.post("/", requireModuleEdit("hr_management"), (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "签署公司名称不能为空" });

  const db = getDb();
  const existed = db
    .prepare("SELECT * FROM labor_companies WHERE name = ? COLLATE NOCASE")
    .get(name) as any;
  if (existed) return res.json(rowToLaborCompany(existed));

  const id = generateId("lc");
  db.prepare(
    "INSERT INTO labor_companies (id, name, remark) VALUES (?, ?, ?)",
  ).run(id, name, String(req.body?.remark || "").trim());

  const row = db.prepare("SELECT * FROM labor_companies WHERE id = ?").get(id);
  res.json(rowToLaborCompany(row));
});

// PUT /api/labor-companies/:id
router.put("/:id", requireModuleEdit("hr_management"), (req, res) => {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM labor_companies WHERE id = ?")
    .get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: "签署公司不存在" });

  const name = String(req.body?.name ?? existing.name).trim();
  if (!name) return res.status(400).json({ error: "签署公司名称不能为空" });

  const dup = db
    .prepare(
      "SELECT id FROM labor_companies WHERE name = ? COLLATE NOCASE AND id != ?",
    )
    .get(name, req.params.id) as { id: string } | undefined;
  if (dup) return res.status(400).json({ error: "已存在同名签署公司" });

  db.prepare(
    "UPDATE labor_companies SET name = ?, remark = ? WHERE id = ?",
  ).run(name, String(req.body?.remark ?? existing.remark ?? "").trim(), req.params.id);

  const row = db.prepare("SELECT * FROM labor_companies WHERE id = ?").get(req.params.id);
  res.json(rowToLaborCompany(row));
});

// DELETE /api/labor-companies/:id
router.delete("/:id", requireModuleEdit("hr_management"), (req, res) => {
  const db = getDb();
  const used = db
    .prepare(
      "SELECT COUNT(*) as c FROM hr_profiles WHERE labor_company_id = ?",
    )
    .get(req.params.id) as { c: number };
  if (used?.c > 0) {
    return res.status(400).json({
      error: `仍有 ${used.c} 份人事档案使用该公司，无法删除`,
    });
  }
  db.prepare("DELETE FROM labor_companies WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
