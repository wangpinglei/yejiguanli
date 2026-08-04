import { Router } from "express";
import { getDb, rowToPersonnel, generateId } from "../db";
import { authMiddleware } from "../auth";
import { getVisibleUnitIds, requireEditPermission, isOrgDept, isReadOnly } from "../middleware";
import type { SalaryStructure } from "../types";

const router = Router();

router.use(authMiddleware);

// GET /api/personnel - 获取人员列表（按权限过滤）
router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM personnel ORDER BY name").all();

  // 按权限过滤
  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    rows = rows.filter((r: any) => idSet.has(r.sales_unit_id));
  }

  res.json(rows.map(rowToPersonnel));
});

// POST /api/personnel - 创建人员
router.post("/", requireEditPermission, (req, res) => {
  const { name, salesUnitId, position, phone, email, salary, socialInsurance, housingFund, hireDate, resignDate, status } = req.body;
  if (!name || !salesUnitId) {
    return res.status(400).json({ error: "姓名和销售单位不能为空" });
  }

  // 组织部只能创建人员（实际上组织部主要编辑入离职，但允许创建）
  const id = generateId("p");
  const db = getDb();
  const salaryJson = JSON.stringify(salary || {});
  db.prepare(`
    INSERT INTO personnel (id, name, sales_unit_id, position, phone, email, salary, social_insurance, housing_fund, hire_date, resign_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, salesUnitId, position || "", phone || "", email || "", salaryJson, socialInsurance || 0, housingFund || 0, hireDate || "", resignDate || null, status || "active");

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  res.json(rowToPersonnel(row));
});

// PUT /api/personnel/:id - 更新人员
router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "人员不存在" });
  }

  const role = req.user!.role;

  // 组织部只能编辑入离职时间
  if (isOrgDept(role)) {
    const { hireDate, resignDate, status } = req.body;
    db.prepare("UPDATE personnel SET hire_date = ?, resign_date = ?, status = ? WHERE id = ?")
      .run(hireDate ?? existing.hire_date, resignDate ?? existing.resign_date, status ?? existing.status, id);
    const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
    return res.json(rowToPersonnel(row));
  }

  // 军工干部只读（已被 requireEditPermission 拦截，这里做双重保险）
  if (isReadOnly(role)) {
    return res.status(403).json({ error: "只读角色无编辑权限" });
  }

  // 其他有权限角色可编辑全部
  const { name, salesUnitId, position, phone, email, salary, socialInsurance, housingFund, hireDate, resignDate, status } = req.body;
  const salaryJson = salary ? JSON.stringify(salary) : existing.salary;

  db.prepare(`
    UPDATE personnel SET
      name = ?, sales_unit_id = ?, position = ?, phone = ?, email = ?,
      salary = ?, social_insurance = ?, housing_fund = ?,
      hire_date = ?, resign_date = ?, status = ?
    WHERE id = ?
  `).run(
    name ?? existing.name,
    salesUnitId ?? existing.sales_unit_id,
    position ?? existing.position,
    phone ?? existing.phone,
    email ?? existing.email,
    salaryJson,
    socialInsurance ?? existing.social_insurance,
    housingFund ?? existing.housing_fund,
    hireDate ?? existing.hire_date,
    resignDate ?? existing.resign_date,
    status ?? existing.status,
    id
  );

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  res.json(rowToPersonnel(row));
});

// DELETE /api/personnel/:id - 删除人员
router.delete("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const result = db.prepare("DELETE FROM personnel WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "人员不存在" });
  }
  res.json({ message: "删除成功" });
});

export default router;
