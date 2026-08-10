import { Router } from "express";
import { getDb, rowToPersonnel, rowToProductPersonCommission, generateId } from "../db";
import { authMiddleware } from "../auth";
import { getVisibleUnitIds, requireEditPermission, isOrgDept, isReadOnly } from "../middleware";

const router = Router();

/**
 * 入参可显式清空：null / "" → 写 null；undefined → 保留原值
 */
function resolveOptionalText(
  incoming: unknown,
  existing: string | null | undefined,
): string | null {
  if (incoming === undefined) return existing ?? null;
  if (incoming === null || incoming === "") return null;
  return String(incoming);
}

function parseSalary(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

router.use(authMiddleware);

// GET /api/personnel - 获取人员列表（按权限过滤）
router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM personnel ORDER BY name").all();

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    rows = rows.filter((r: any) => idSet.has(r.sales_unit_id));
  }

  res.json(rows.map(rowToPersonnel));
});

// POST /api/personnel - 创建人员
router.post("/", requireEditPermission, (req, res) => {
  const {
    name, salesUnitId, position, phone, email, salary,
    socialInsurance, housingFund, hireDate, resignDate, status,
    highCommissionFrom, regularCompensation,
  } = req.body;
  if (!name || !salesUnitId) {
    return res.status(400).json({ error: "姓名和销售单位不能为空" });
  }

  const id = generateId("p");
  const db = getDb();
  const salaryJson = JSON.stringify(salary || {});
  const regularJson = regularCompensation ? JSON.stringify(regularCompensation) : "";
  db.prepare(`
    INSERT INTO personnel (
      id, name, sales_unit_id, position, phone, email, salary,
      social_insurance, housing_fund, hire_date, resign_date, status,
      high_commission_from, regular_compensation
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    salesUnitId,
    position || "",
    phone || "",
    email || "",
    salaryJson,
    socialInsurance || 0,
    housingFund || 0,
    hireDate || "",
    resignDate || null,
    status || "active",
    highCommissionFrom || "",
    regularJson,
  );

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  res.json(rowToPersonnel(row));
});

/**
 * POST /api/personnel/:id/enable-distribution
 * 启用分销：快照常规薪酬+产品提成，清零固定成本，手填高提成生效日，可选统一改产品提成比例
 */
router.post("/:id/enable-distribution", requireEditPermission, (req, res) => {
  if (isOrgDept(req.user!.role) || isReadOnly(req.user!)) {
    return res.status(403).json({ error: "当前角色无权启用分销" });
  }

  const { id } = req.params;
  const highCommissionFrom = String(req.body.highCommissionFrom || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(highCommissionFrom)) {
    return res.status(400).json({ error: "请填写高提成/分销生效日（年-月-日）" });
  }

  const resignDateRaw = req.body.resignDate;
  const distributionRate =
    req.body.distributionPersonalRate === undefined || req.body.distributionPersonalRate === null
      ? null
      : Number(req.body.distributionPersonalRate);

  const db = getDb();
  const existing: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "人员不存在" });

  const person = rowToPersonnel(existing) as any;
  const ppcRows = db
    .prepare("SELECT * FROM product_person_commissions WHERE personnel_id = ?")
    .all(id)
    .map(rowToProductPersonCommission);

  // 已有快照则保留（避免二次启用覆盖历史）；否则新建快照
  let regularCompensation = person.regularCompensation;
  if (!regularCompensation?.salary) {
    regularCompensation = {
      salary: person.salary || {},
      socialInsurance: person.socialInsurance || 0,
      housingFund: person.housingFund || 0,
      productCommissions: ppcRows.map((x: any) => ({
        salesUnitId: x.salesUnitId,
        productId: x.productId,
        personnelId: x.personnelId,
        managementCommissionRate: x.managementCommissionRate || 0,
        managementCommissionThreshold: x.managementCommissionThreshold || 0,
        managementCommissionCondition: x.managementCommissionCondition || "",
        personalCommissionType: x.personalCommissionType || "percentage",
        personalCommissionRate: x.personalCommissionRate || 0,
        personalCommissionAmount: x.personalCommissionAmount || 0,
        personalCommissionThreshold: x.personalCommissionThreshold || 0,
        personalCommissionCondition: x.personalCommissionCondition || "",
        rewardAmount: x.rewardAmount || 0,
        rewardFrom: x.rewardFrom || "",
        rewardTo: x.rewardTo || "",
      })),
    };
  }

  const oldSalary = parseSalary(existing.salary);
  const newSalary = {
    ...oldSalary,
    baseSalary: 0,
    performance: 0,
    positionAllowance: 0,
    personalCommissionRate:
      distributionRate != null && Number.isFinite(distributionRate)
        ? distributionRate
        : (oldSalary.personalCommissionRate || 0),
    personalCommissionThreshold: 0,
    personalCommissionCondition: "分销高提成",
  };

  let nextResign = existing.resign_date;
  if (resignDateRaw !== undefined) {
    nextResign = resolveOptionalText(resignDateRaw, existing.resign_date);
  }
  const today = new Date().toISOString().slice(0, 10);
  const resignStr = (nextResign || "").slice(0, 10);
  const nextStatus = resignStr && resignStr < today ? "inactive" : (existing.status || "active");

  db.prepare(`
    UPDATE personnel SET
      salary = ?,
      social_insurance = 0,
      housing_fund = 0,
      resign_date = ?,
      status = ?,
      high_commission_from = ?,
      regular_compensation = ?
    WHERE id = ?
  `).run(
    JSON.stringify(newSalary),
    nextResign,
    nextStatus,
    highCommissionFrom,
    JSON.stringify(regularCompensation),
    id,
  );

  // 可选：把当前产品提成统一改成分销比例（历史已在快照中）
  if (distributionRate != null && Number.isFinite(distributionRate)) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE product_person_commissions SET
        personal_commission_type = 'percentage',
        personal_commission_rate = ?,
        personal_commission_amount = 0,
        personal_commission_threshold = 0,
        personal_commission_condition = ?,
        updated_at = ?
      WHERE personnel_id = ?
    `).run(distributionRate, `分销高提成（自 ${highCommissionFrom}）`, now, id);
  }

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  res.json({
    personnel: rowToPersonnel(row),
    productPersonCommissions: db
      .prepare("SELECT * FROM product_person_commissions WHERE personnel_id = ?")
      .all(id)
      .map(rowToProductPersonCommission),
  });
});

// PUT /api/personnel/:id - 更新人员
router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "人员不存在" });
  }

  const role = req.user!.role;

  if (isOrgDept(role)) {
    const { hireDate, resignDate, status } = req.body;
    db.prepare(
      "UPDATE personnel SET hire_date = ?, resign_date = ?, status = ? WHERE id = ?",
    ).run(
      resolveOptionalText(hireDate, existing.hire_date) ?? "",
      resolveOptionalText(resignDate, existing.resign_date),
      status ?? existing.status,
      id,
    );
    const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
    return res.json(rowToPersonnel(row));
  }

  if (isReadOnly(req.user!)) {
    return res.status(403).json({ error: "只读角色无编辑权限" });
  }

  const {
    name, salesUnitId, position, phone, email, salary,
    socialInsurance, housingFund, hireDate, resignDate, status,
    highCommissionFrom, regularCompensation,
  } = req.body;
  const salaryJson = salary ? JSON.stringify(salary) : existing.salary;
  const regularJson =
    regularCompensation !== undefined
      ? (regularCompensation ? JSON.stringify(regularCompensation) : "")
      : (existing.regular_compensation || "");
  const highFrom =
    highCommissionFrom !== undefined
      ? (highCommissionFrom || "")
      : (existing.high_commission_from || "");

  db.prepare(`
    UPDATE personnel SET
      name = ?, sales_unit_id = ?, position = ?, phone = ?, email = ?,
      salary = ?, social_insurance = ?, housing_fund = ?,
      hire_date = ?, resign_date = ?, status = ?,
      high_commission_from = ?, regular_compensation = ?
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
    resolveOptionalText(hireDate, existing.hire_date) ?? "",
    resolveOptionalText(resignDate, existing.resign_date),
    status ?? existing.status,
    highFrom,
    regularJson,
    id,
  );

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  res.json(rowToPersonnel(row));
});

// DELETE /api/personnel/:id - 删除人员（同步删除人事档案；人员管理手动数据由调用方确认）
router.delete("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare("SELECT id FROM personnel WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "人员不存在" });
  }

  // 显式删除人事档案（与 FK CASCADE 双保险），不保留孤立人事记录
  db.prepare("DELETE FROM hr_profiles WHERE personnel_id = ?").run(id);
  try {
    db.prepare("DELETE FROM product_person_commissions WHERE personnel_id = ?").run(id);
  } catch {
    /* ignore */
  }
  try {
    db.prepare("DELETE FROM monthly_adjustments WHERE personnel_id = ?").run(id);
  } catch {
    /* ignore */
  }
  try {
    db.prepare(
      "UPDATE sales_records SET personnel_id = '' WHERE personnel_id = ?",
    ).run(id);
  } catch {
    /* ignore */
  }

  db.prepare("DELETE FROM personnel WHERE id = ?").run(id);
  res.json({ message: "删除成功" });
});

export default router;
