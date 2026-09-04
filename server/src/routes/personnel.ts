import { Router } from "express";
import {
  getDb,
  rowToPersonnel,
  rowToProductPersonCommission,
  generateId,
  runInTransaction,
  runUnitDataReconcile,
  getPersonnelUnitDiagnosis,
  afterManualAssignmentChange,
  loadPayPlansByPersonnelIds,
} from "../db";
import { authMiddleware } from "../auth";
import { getVisibleUnitIds, requireEditPermission, isOrgDept, isReadOnly, requireRole } from "../middleware";

const router = Router();

function getOperator(req: { user?: { id?: string; name?: string; username?: string } }) {
  const name = (req.user?.name || req.user?.username || "").trim() || "未知用户";
  const id = (req.user?.id || "").trim();
  return { name, id };
}

function loadAssignmentsByPersonnelIds(
  db: ReturnType<typeof getDb>,
  ids: string[],
): Map<string, any[]> {
  const map = new Map<string, any[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`
      SELECT * FROM personnel_unit_assignments
      WHERE personnel_id IN (${placeholders})
      ORDER BY start_date ASC, created_at ASC
    `)
    .all(...ids) as any[];
  for (const row of rows) {
    const list = map.get(row.personnel_id) || [];
    list.push(row);
    map.set(row.personnel_id, list);
  }
  return map;
}

function insertOpenAssignment(
  db: ReturnType<typeof getDb>,
  personnelId: string,
  salesUnitId: string,
  startDate: string,
  remark = "",
  operator?: { name: string; id: string },
) {
  db.prepare(`
    INSERT INTO personnel_unit_assignments (
      id, personnel_id, sales_unit_id, start_date, end_date, remark, created_at,
      operator, operator_id
    ) VALUES (?, ?, ?, ?, NULL, ?, datetime('now'), ?, ?)
  `).run(
    generateId("pua"),
    personnelId,
    salesUnitId,
    startDate,
    remark,
    operator?.name || "",
    operator?.id || "",
  );
}

function listOpenAssignments(
  db: ReturnType<typeof getDb>,
  personnelId: string,
): Array<{ id: string; start_date: string; sales_unit_id: string }> {
  return db
    .prepare(`
      SELECT id, start_date, sales_unit_id
      FROM personnel_unit_assignments
      WHERE personnel_id = ?
        AND (end_date IS NULL OR TRIM(end_date) = '')
      ORDER BY start_date ASC, created_at ASC
    `)
    .all(personnelId) as Array<{ id: string; start_date: string; sales_unit_id: string }>;
}

/** 转岗/改单位时关闭全部「至今」段，避免只关一条导致海南+云拆单同时 open */
function closeAllOpenAssignments(
  db: ReturnType<typeof getDb>,
  personnelId: string,
  endDate: string,
): number {
  const openRows = listOpenAssignments(db, personnelId);
  const updateEnd = db.prepare(
    "UPDATE personnel_unit_assignments SET end_date = ? WHERE id = ?",
  );
  let closed = 0;
  for (const row of openRows) {
    const openStart = String(row.start_date || "").slice(0, 10);
    const end = openStart && endDate < openStart ? openStart : endDate;
    updateEnd.run(end, row.id);
    closed += 1;
  }
  return closed;
}

function listOpenPayPlans(
  db: ReturnType<typeof getDb>,
  personnelId: string,
): Array<{ id: string; start_date: string }> {
  return db
    .prepare(`
      SELECT id, start_date
      FROM personnel_pay_plans
      WHERE personnel_id = ?
        AND (end_date IS NULL OR TRIM(end_date) = '')
      ORDER BY start_date ASC, created_at ASC
    `)
    .all(personnelId) as Array<{ id: string; start_date: string }>;
}

function closeAllOpenPayPlans(
  db: ReturnType<typeof getDb>,
  personnelId: string,
  endDate: string,
): number {
  const openRows = listOpenPayPlans(db, personnelId);
  const updateEnd = db.prepare(
    "UPDATE personnel_pay_plans SET end_date = ? WHERE id = ?",
  );
  let closed = 0;
  for (const row of openRows) {
    const openStart = String(row.start_date || "").slice(0, 10);
    const end = openStart && endDate < openStart ? openStart : endDate;
    updateEnd.run(end, row.id);
    closed += 1;
  }
  return closed;
}

function insertOpenPayPlan(
  db: ReturnType<typeof getDb>,
  personnelId: string,
  startDate: string,
  salaryJson: string,
  socialInsurance: number,
  housingFund: number,
  remark = "",
  operator?: { name: string; id: string },
) {
  db.prepare(`
    INSERT INTO personnel_pay_plans (
      id, personnel_id, start_date, end_date, salary,
      social_insurance, housing_fund, remark, created_at,
      operator, operator_id
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, datetime('now'), ?, ?)
  `).run(
    generateId("ppp"),
    personnelId,
    startDate,
    salaryJson,
    socialInsurance || 0,
    housingFund || 0,
    remark,
    operator?.name || "",
    operator?.id || "",
  );
}

function loadPayPlanRows(
  db: ReturnType<typeof getDb>,
  personnelId: string,
) {
  return db
    .prepare(
      "SELECT * FROM personnel_pay_plans WHERE personnel_id = ? ORDER BY start_date ASC, created_at ASC",
    )
    .all(personnelId);
}

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
  let rows = db.prepare("SELECT * FROM personnel ORDER BY name").all() as any[];

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    rows = rows.filter((r: any) => idSet.has(r.sales_unit_id));
  }

  const assignMap = loadAssignmentsByPersonnelIds(
    db,
    rows.map((r) => r.id),
  );
  const payMap = loadPayPlansByPersonnelIds(
    db,
    rows.map((r) => r.id),
  );
  res.json(rows.map((r) => rowToPersonnel(
    r,
    assignMap.get(r.id) || [],
    payMap.get(r.id) || [],
  )));
});

function loadPersonnelWithAssignments(db: ReturnType<typeof getDb>, personnelId: string) {
  const existing: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(personnelId);
  if (!existing) return null;
  const assigns = db
    .prepare(
      "SELECT * FROM personnel_unit_assignments WHERE personnel_id = ? ORDER BY start_date",
    )
    .all(personnelId);
  return rowToPersonnel(existing, assigns, loadPayPlanRows(db, personnelId));
}

/**
 * PUT /api/personnel/:id/assignments/:assignmentId
 * 直接修改单条调岗/归属记录（归属单位、起止日）
 */
router.put(
  "/:id/assignments/:assignmentId",
  requireRole("superadmin"),
  (req, res) => {
    const { id, assignmentId } = req.params;
    const salesUnitId = String(req.body?.salesUnitId || "").trim();
    const startDate = String(req.body?.startDate || "").trim().slice(0, 10);
    const endDateRaw = req.body?.endDate;
    const endDate =
      endDateRaw === null || endDateRaw === undefined || endDateRaw === ""
        ? null
        : String(endDateRaw).trim().slice(0, 10);
    const remark = String(req.body?.remark ?? "").trim();

    if (!salesUnitId) {
      return res.status(400).json({ error: "请选择归属单位" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return res.status(400).json({ error: "请填写有效的开始日" });
    }
    if (endDate && endDate <= startDate) {
      return res.status(400).json({ error: "结束日须晚于开始日" });
    }

    const db = getDb();
    const existing: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "人员不存在" });

    const row: any = db
      .prepare(
        "SELECT * FROM personnel_unit_assignments WHERE id = ? AND personnel_id = ?",
      )
      .get(assignmentId, id);
    if (!row) return res.status(404).json({ error: "归属记录不存在" });

    const unit = db.prepare("SELECT id FROM sales_units WHERE id = ?").get(salesUnitId);
    if (!unit) return res.status(400).json({ error: "归属单位不存在" });

    const operator = getOperator(req);

    db.prepare(`
      UPDATE personnel_unit_assignments
      SET sales_unit_id = ?, start_date = ?, end_date = ?, remark = ?,
          operator = ?, operator_id = ?
      WHERE id = ?
    `).run(
      salesUnitId,
      startDate,
      endDate,
      remark,
      operator.name,
      operator.id,
      assignmentId,
    );

    const isOpen = !endDate;
    if (isOpen) {
      db.prepare("UPDATE personnel SET sales_unit_id = ? WHERE id = ?").run(
        salesUnitId,
        id,
      );
    }

    afterManualAssignmentChange(id);

    const personnel = loadPersonnelWithAssignments(db, id);
    if (!personnel) return res.status(404).json({ error: "人员不存在" });
    res.json(personnel);
  },
);

/**
 * DELETE /api/personnel/:id/assignments/:assignmentId
 * 删除单条调岗/归属记录（至少保留一条）
 */
router.delete(
  "/:id/assignments/:assignmentId",
  requireRole("superadmin"),
  (req, res) => {
    const { id, assignmentId } = req.params;
    const db = getDb();
    const existing: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "人员不存在" });

    const row: any = db
      .prepare(
        "SELECT * FROM personnel_unit_assignments WHERE id = ? AND personnel_id = ?",
      )
      .get(assignmentId, id);
    if (!row) return res.status(404).json({ error: "归属记录不存在" });

    const countRow = db
      .prepare(
        "SELECT COUNT(*) AS c FROM personnel_unit_assignments WHERE personnel_id = ?",
      )
      .get(id) as { c: number };
    if (Number(countRow?.c || 0) <= 1) {
      return res.status(400).json({
        error: "至少保留一条归属记录；若单位不对，请转岗或清洗调岗记录",
      });
    }

    db.prepare("DELETE FROM personnel_unit_assignments WHERE id = ?").run(assignmentId);
    afterManualAssignmentChange(id);

    const personnel = loadPersonnelWithAssignments(db, id);
    if (!personnel) return res.status(404).json({ error: "人员不存在" });
    res.json(personnel);
  },
);

/**
 * POST /api/personnel/reconcile-unit-data
 * 清洗调岗/归属时间轴（删除错误段、截断重叠、补全与人事一致的当前段）
 */
router.post(
  "/reconcile-unit-data",
  requireRole("superadmin"),
  (req, res) => {
    const report = runUnitDataReconcile();
    res.json({
      message: report.totalFixed > 0
        ? `已清洗 ${report.totalFixed} 条调岗/归属记录`
        : report.remainingIssues.length > 0
          ? "未发现可自动清洗项，但仍有归属异常，请查看 remainingIssues"
          : "调岗记录正常，无需清洗",
      ...report,
    });
  },
);

/**
 * GET /api/personnel/unit-diagnosis?name=李燚&yearMonth=2026-08&onlyIssues=1
 * 查看人员人事单位、归属时间轴、当月成交挂账（排查成本错挂）
 */
router.get("/unit-diagnosis", requireRole("superadmin"), (req, res) => {
  const name = String(req.query.name || "").trim();
  const yearMonth = String(req.query.yearMonth || "").trim();
  const onlyIssues = String(req.query.onlyIssues ?? "1") !== "0";
  const result = getPersonnelUnitDiagnosis({
    name: name || undefined,
    yearMonth: yearMonth || undefined,
    onlyIssues,
  });
  res.json(result);
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
  const startDate =
    (hireDate || "").trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
  runInTransaction(() => {
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
    insertOpenAssignment(db, id, salesUnitId, startDate, "入职建档", getOperator(req));
    insertOpenPayPlan(
      db,
      id,
      startDate,
      salaryJson,
      socialInsurance || 0,
      housingFund || 0,
      "入职建档",
      getOperator(req),
    );
  });

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  const assigns = db
    .prepare(
      "SELECT * FROM personnel_unit_assignments WHERE personnel_id = ? ORDER BY start_date",
    )
    .all(id);
  res.json(rowToPersonnel(row, assigns, loadPayPlanRows(db, id)));
});

/**
 * POST /api/personnel/merge
 * 合并重复人员：保留 keepId，迁移 removeId 的销售/提成/调整/目标/人事关联后删除 removeId。
 * 冲突时保留 keep 侧数据（提成同产品、同月调整、人事档案等）。
 * 空白字段可用 remove 侧补全 keep。
 */
router.post("/merge", requireEditPermission, (req, res) => {
  if (isOrgDept(req.user!.role) || isReadOnly(req.user!)) {
    return res.status(403).json({ error: "当前角色无权合并人员" });
  }

  const keepId = String(req.body?.keepId || "").trim();
  const removeId = String(req.body?.removeId || "").trim();
  if (!keepId || !removeId) {
    return res.status(400).json({ error: "请指定保留人员与被合并人员" });
  }
  if (keepId === removeId) {
    return res.status(400).json({ error: "保留人员与被合并人员不能相同" });
  }

  const db = getDb();
  const keep: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(keepId);
  const remove: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(removeId);
  if (!keep || !remove) {
    return res.status(404).json({ error: "人员不存在" });
  }

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    if (!idSet.has(keep.sales_unit_id) || !idSet.has(remove.sales_unit_id)) {
      return res.status(403).json({ error: "无权合并所选单位人员" });
    }
  }

  const stats = runInTransaction(() => {
    const moved = {
      sales: 0,
      commissionsMoved: 0,
      commissionsDropped: 0,
      adjustmentsMoved: 0,
      adjustmentsDropped: 0,
      targetsMoved: 0,
      targetsDropped: 0,
      hrRelinked: 0,
      hrDropped: 0,
      fieldsFilled: [] as string[],
      teamRulesUpdated: 0,
    };

    // ---- 销售记录 ----
    const salesInfo = db
      .prepare("UPDATE sales_records SET personnel_id = ? WHERE personnel_id = ?")
      .run(keepId, removeId);
    moved.sales = Number(salesInfo.changes || 0);
    // 按姓名兜底的销售：若姓名一致且未关联人员，也绑到保留人（同单位）
    const keepName = String(keep.name || "").trim();
    const removeName = String(remove.name || "").trim();
    if (keepName && keepName === removeName) {
      db.prepare(`
        UPDATE sales_records SET personnel_id = ?
        WHERE (personnel_id IS NULL OR TRIM(personnel_id) = '')
          AND TRIM(sales_person_name) = ?
          AND sales_unit_id = ?
      `).run(keepId, keepName, keep.sales_unit_id);
    }

    // ---- 个人产品提成 UNIQUE(unit, product, personnel) ----
    const removePpc = db
      .prepare("SELECT * FROM product_person_commissions WHERE personnel_id = ?")
      .all(removeId) as any[];
    const findKeepPpc = db.prepare(`
      SELECT id FROM product_person_commissions
      WHERE sales_unit_id = ? AND product_id = ? AND personnel_id = ?
    `);
    const delPpc = db.prepare("DELETE FROM product_person_commissions WHERE id = ?");
    const movePpc = db.prepare(
      "UPDATE product_person_commissions SET personnel_id = ? WHERE id = ?",
    );
    for (const row of removePpc) {
      const clash = findKeepPpc.get(row.sales_unit_id, row.product_id, keepId);
      if (clash) {
        delPpc.run(row.id);
        moved.commissionsDropped += 1;
      } else {
        movePpc.run(keepId, row.id);
        moved.commissionsMoved += 1;
      }
    }

    // ---- 月度调整 UNIQUE(personnel, year_month) ----
    const removeAdj = db
      .prepare("SELECT * FROM monthly_adjustments WHERE personnel_id = ?")
      .all(removeId) as any[];
    const findKeepAdj = db.prepare(
      "SELECT id FROM monthly_adjustments WHERE personnel_id = ? AND year_month = ?",
    );
    const delAdj = db.prepare("DELETE FROM monthly_adjustments WHERE id = ?");
    const moveAdj = db.prepare(
      "UPDATE monthly_adjustments SET personnel_id = ? WHERE id = ?",
    );
    for (const row of removeAdj) {
      const clash = findKeepAdj.get(keepId, row.year_month);
      if (clash) {
        delAdj.run(row.id);
        moved.adjustmentsDropped += 1;
      } else {
        moveAdj.run(keepId, row.id);
        moved.adjustmentsMoved += 1;
      }
    }

    // ---- 业绩目标 ----
    const removeTargets = db
      .prepare("SELECT * FROM performance_targets WHERE personnel_id = ?")
      .all(removeId) as any[];
    const findKeepTarget = db.prepare(`
      SELECT id FROM performance_targets
      WHERE sales_unit_id = ? AND year_month = ? AND personnel_id = ?
    `);
    const delTarget = db.prepare("DELETE FROM performance_targets WHERE id = ?");
    const moveTarget = db.prepare(
      "UPDATE performance_targets SET personnel_id = ? WHERE id = ?",
    );
    for (const row of removeTargets) {
      const clash = findKeepTarget.get(row.sales_unit_id, row.year_month, keepId);
      if (clash) {
        delTarget.run(row.id);
        moved.targetsDropped += 1;
      } else {
        moveTarget.run(keepId, row.id);
        moved.targetsMoved += 1;
      }
    }

    // ---- 人事档案（personnel_id UNIQUE）----
    const keepHr: any = db
      .prepare("SELECT id FROM hr_profiles WHERE personnel_id = ?")
      .get(keepId);
    const removeHr: any = db
      .prepare("SELECT id FROM hr_profiles WHERE personnel_id = ?")
      .get(removeId);
    if (removeHr) {
      if (keepHr) {
        db.prepare("DELETE FROM hr_profiles WHERE id = ?").run(removeHr.id);
        moved.hrDropped = 1;
      } else {
        db.prepare("UPDATE hr_profiles SET personnel_id = ? WHERE id = ?").run(
          keepId,
          removeHr.id,
        );
        moved.hrRelinked = 1;
      }
    }

    // ---- 团队管理提成规则里的 managers_json ----
    const teamRules = db
      .prepare("SELECT id, managers_json FROM team_mgmt_commission_rules")
      .all() as Array<{ id: string; managers_json: string }>;
    for (const rule of teamRules) {
      let managers: Array<{ personnelId?: string; weight?: number }> = [];
      try {
        managers = JSON.parse(rule.managers_json || "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(managers) || managers.length === 0) continue;
      let changed = false;
      const next: Array<{ personnelId: string; weight: number }> = [];
      const weightById = new Map<string, number>();
      for (const m of managers) {
        let pid = String(m.personnelId || "").trim();
        if (pid === removeId) {
          pid = keepId;
          changed = true;
        }
        if (!pid) continue;
        const w = Number(m.weight) || 0;
        weightById.set(pid, (weightById.get(pid) || 0) + w);
      }
      for (const [pid, weight] of weightById) {
        if (weight > 0) next.push({ personnelId: pid, weight });
      }
      if (changed) {
        db.prepare(`
          UPDATE team_mgmt_commission_rules
          SET managers_json = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(next), rule.id);
        moved.teamRulesUpdated += 1;
      }
    }

    // ---- 用 remove 补全 keep 空白字段 ----
    const fillText = (keepVal: unknown, removeVal: unknown) => {
      const k = String(keepVal ?? "").trim();
      const r = String(removeVal ?? "").trim();
      return k ? k : r;
    };
    const nextName = fillText(keep.name, remove.name);
    const nextPosition = fillText(keep.position, remove.position);
    const nextPhone = fillText(keep.phone, remove.phone);
    const nextEmail = fillText(keep.email, remove.email);
    const nextHire = fillText(keep.hire_date, remove.hire_date);
    let nextResign = keep.resign_date;
    if ((nextResign == null || String(nextResign).trim() === "") && remove.resign_date) {
      nextResign = remove.resign_date;
    }
    let nextSalary = keep.salary;
    try {
      const keepSal = parseSalary(keep.salary);
      const removeSal = parseSalary(remove.salary);
      const keepFixed =
        Number(keepSal.baseSalary || 0)
        + Number(keepSal.performance || 0)
        + Number(keepSal.positionAllowance || 0);
      const removeFixed =
        Number(removeSal.baseSalary || 0)
        + Number(removeSal.performance || 0)
        + Number(removeSal.positionAllowance || 0);
      if (keepFixed <= 0 && removeFixed > 0) {
        nextSalary = JSON.stringify(removeSal);
        moved.fieldsFilled.push("薪资");
      }
    } catch {
      /* keep */
    }
    const nextSocial =
      Number(keep.social_insurance || 0) > 0
        ? keep.social_insurance
        : (remove.social_insurance || 0);
    const nextHousing =
      Number(keep.housing_fund || 0) > 0
        ? keep.housing_fund
        : (remove.housing_fund || 0);
    const nextHigh = fillText(keep.high_commission_from, remove.high_commission_from);
    let nextRegular = keep.regular_compensation || "";
    if (!String(nextRegular).trim() && remove.regular_compensation) {
      nextRegular = remove.regular_compensation;
      moved.fieldsFilled.push("常规薪酬快照");
    }
    if (nextName !== (keep.name || "")) moved.fieldsFilled.push("姓名");
    if (nextPosition !== (keep.position || "")) moved.fieldsFilled.push("职位");
    if (nextPhone !== (keep.phone || "")) moved.fieldsFilled.push("手机");
    if (nextEmail !== (keep.email || "")) moved.fieldsFilled.push("邮箱");
    if (nextHire !== (keep.hire_date || "")) moved.fieldsFilled.push("入职日期");
    if (String(nextResign || "") !== String(keep.resign_date || "")) {
      moved.fieldsFilled.push("离职日期");
    }

    // 状态：有人在职则偏在职；否则取 keep
    let nextStatus = keep.status || "active";
    if (keep.status === "inactive" && remove.status === "active") {
      nextStatus = "active";
      moved.fieldsFilled.push("状态");
    }

    db.prepare(`
      UPDATE personnel SET
        name = ?, position = ?, phone = ?, email = ?,
        salary = ?, social_insurance = ?, housing_fund = ?,
        hire_date = ?, resign_date = ?, status = ?,
        high_commission_from = ?, regular_compensation = ?
      WHERE id = ?
    `).run(
      nextName || keep.name,
      nextPosition,
      nextPhone,
      nextEmail,
      nextSalary,
      nextSocial || 0,
      nextHousing || 0,
      nextHire,
      nextResign || null,
      nextStatus,
      nextHigh,
      nextRegular,
      keepId,
    );

    // 清理 remove 残留后删除
    db.prepare("DELETE FROM product_person_commissions WHERE personnel_id = ?").run(removeId);
    db.prepare("DELETE FROM monthly_adjustments WHERE personnel_id = ?").run(removeId);
    db.prepare("DELETE FROM performance_targets WHERE personnel_id = ?").run(removeId);
    db.prepare("DELETE FROM hr_profiles WHERE personnel_id = ?").run(removeId);
    db.prepare("DELETE FROM personnel_unit_assignments WHERE personnel_id = ?").run(removeId);
    db.prepare("DELETE FROM personnel_pay_plans WHERE personnel_id = ?").run(removeId);
    db.prepare("UPDATE sales_records SET personnel_id = '' WHERE personnel_id = ?").run(removeId);
    db.prepare("DELETE FROM personnel WHERE id = ?").run(removeId);

    return moved;
  });

  const keepAssigns = db
    .prepare(
      "SELECT * FROM personnel_unit_assignments WHERE personnel_id = ? ORDER BY start_date",
    )
    .all(keepId);
  const personnel = rowToPersonnel(
    db.prepare("SELECT * FROM personnel WHERE id = ?").get(keepId),
    keepAssigns,
    loadPayPlanRows(db, keepId),
  );
  const productPersonCommissions = (
    db.prepare("SELECT * FROM product_person_commissions WHERE personnel_id = ?").all(keepId) as any[]
  ).map(rowToProductPersonCommission);

  res.json({
    personnel,
    productPersonCommissions,
    stats,
    message: `已合并「${remove.name}」到「${keep.name}」`,
  });
});

/**
 * POST /api/personnel/:id/adjust-pay
 * 调薪/转正：关闭当前薪酬段，从生效日起用新底薪/绩效/补贴/社保公积金；此前月份仍用旧标准。
 */
router.post("/:id/adjust-pay", requireEditPermission, (req, res) => {
  if (isOrgDept(req.user!.role) || isReadOnly(req.user!)) {
    return res.status(403).json({ error: "当前角色无权调整薪酬" });
  }

  const { id } = req.params;
  const effectiveDate = String(req.body?.effectiveDate || "").trim().slice(0, 10);
  const remark = String(req.body?.remark || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return res.status(400).json({ error: "请填写薪酬生效日（年-月-日）" });
  }

  const db = getDb();
  const existing: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "人员不存在" });

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null && !visibleIds.includes(existing.sales_unit_id)) {
    return res.status(403).json({ error: "无权操作所选单位人员" });
  }

  const nextSalary = req.body?.salary
    ? { ...parseSalary(existing.salary), ...req.body.salary }
    : parseSalary(existing.salary);
  const salaryJson = JSON.stringify(nextSalary);
  const nextSocial = req.body?.socialInsurance !== undefined
    ? Number(req.body.socialInsurance) || 0
    : (existing.social_insurance || 0);
  const nextHousing = req.body?.housingFund !== undefined
    ? Number(req.body.housingFund) || 0
    : (existing.housing_fund || 0);

  const openRows = listOpenPayPlans(db, id);
  if (openRows.length > 0) {
    const latestStart = openRows
      .map((r) => String(r.start_date || "").slice(0, 10))
      .sort()
      .pop();
    if (latestStart && effectiveDate < latestStart) {
      return res.status(400).json({
        error: `生效日不能早于当前薪酬段开始日 ${latestStart}`,
      });
    }
  }

  runInTransaction(() => {
    if (openRows.length > 0) {
      closeAllOpenPayPlans(db, id, effectiveDate);
    } else {
      const hire = String(existing.hire_date || "").slice(0, 10) || "1970-01-01";
      const oldStart = hire <= effectiveDate ? hire : effectiveDate;
      db.prepare(`
        INSERT INTO personnel_pay_plans (
          id, personnel_id, start_date, end_date, salary,
          social_insurance, housing_fund, remark, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '调薪前补录', datetime('now'))
      `).run(
        generateId("ppp"),
        id,
        oldStart,
        effectiveDate,
        existing.salary || "{}",
        existing.social_insurance || 0,
        existing.housing_fund || 0,
      );
    }

    insertOpenPayPlan(
      db,
      id,
      effectiveDate,
      salaryJson,
      nextSocial,
      nextHousing,
      remark || "调薪",
      getOperator(req),
    );
    db.prepare(`
      UPDATE personnel SET salary = ?, social_insurance = ?, housing_fund = ?
      WHERE id = ?
    `).run(salaryJson, nextSocial, nextHousing, id);
  });

  const personnel = loadPersonnelWithAssignments(db, id);
  if (!personnel) return res.status(404).json({ error: "人员不存在" });
  res.json(personnel);
});

/**
 * POST /api/personnel/:id/transfer
 * 转岗：关闭当前归属段，从生效日起归新单位；历史销售/手工成本不回溯。
 */
router.post("/:id/transfer", requireEditPermission, (req, res) => {
  if (isOrgDept(req.user!.role) || isReadOnly(req.user!)) {
    return res.status(403).json({ error: "当前角色无权办理转岗" });
  }

  const { id } = req.params;
  const toUnitId = String(req.body?.salesUnitId || req.body?.toUnitId || "").trim();
  const effectiveDate = String(req.body?.effectiveDate || "").trim().slice(0, 10);
  const remark = String(req.body?.remark || "").trim();

  if (!toUnitId) {
    return res.status(400).json({ error: "请选择目标部门" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return res.status(400).json({ error: "请填写调动生效日（年-月-日）" });
  }

  const db = getDb();
  const existing: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "人员不存在" });

  const unit = db.prepare("SELECT id FROM sales_units WHERE id = ?").get(toUnitId);
  if (!unit) return res.status(400).json({ error: "目标部门不存在" });

  if (existing.sales_unit_id === toUnitId) {
    return res.status(400).json({ error: "目标部门与当前所属单位相同" });
  }

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    const idSet = new Set(visibleIds);
    if (!idSet.has(existing.sales_unit_id) || !idSet.has(toUnitId)) {
      return res.status(403).json({ error: "无权操作所选单位人员" });
    }
  }

  const openRows = listOpenAssignments(db, id);

  if (openRows.length > 0) {
    const latestStart = openRows
      .map((r) => String(r.start_date || "").slice(0, 10))
      .sort()
      .pop();
    if (latestStart && effectiveDate < latestStart) {
      return res.status(400).json({
        error: `调动日不能早于当前归属段开始日 ${latestStart}`,
      });
    }
  }

  runInTransaction(() => {
    if (openRows.length > 0) {
      closeAllOpenAssignments(db, id, effectiveDate);
    } else {
      // 无时间轴时补旧段再关闭
      const hire = String(existing.hire_date || "").slice(0, 10) || "1970-01-01";
      const oldStart = hire <= effectiveDate ? hire : effectiveDate;
      const oldId = generateId("pua");
      db.prepare(`
        INSERT INTO personnel_unit_assignments (
          id, personnel_id, sales_unit_id, start_date, end_date, remark, created_at
        ) VALUES (?, ?, ?, ?, ?, '转岗前补录', datetime('now'))
      `).run(oldId, id, existing.sales_unit_id, oldStart, effectiveDate);
    }

    insertOpenAssignment(
      db,
      id,
      toUnitId,
      effectiveDate,
      remark || "转岗",
      getOperator(req),
    );
    db.prepare("UPDATE personnel SET sales_unit_id = ? WHERE id = ?").run(toUnitId, id);
  });

  afterManualAssignmentChange(id);

  const personnel = loadPersonnelWithAssignments(db, id);
  if (!personnel) return res.status(404).json({ error: "人员不存在" });
  res.json(personnel);
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
  const distributionInternalRate =
    req.body.distributionInternalSalesRate === undefined ||
    req.body.distributionInternalSalesRate === null
      ? null
      : Number(req.body.distributionInternalSalesRate);

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
        internalSalesCommissionType: x.internalSalesCommissionType || "percentage",
        internalSalesCommissionRate: x.internalSalesCommissionRate || 0,
        internalSalesCommissionAmount: x.internalSalesCommissionAmount || 0,
        internalSalesCommissionThreshold: x.internalSalesCommissionThreshold || 0,
        internalSalesCommissionCondition: x.internalSalesCommissionCondition || "",
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
    internalSalesCommissionType: "percentage",
    internalSalesCommissionRate:
      distributionInternalRate != null && Number.isFinite(distributionInternalRate)
        ? distributionInternalRate
        : (oldSalary.internalSalesCommissionRate || 0),
    internalSalesCommissionThreshold: 0,
    internalSalesCommissionCondition: "关联内部销售，不计业绩",
    internalSalesCommissionRecipientId: oldSalary.internalSalesCommissionRecipientId || "",
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

  const distSalaryJson = JSON.stringify(newSalary);
  const openPayRows = listOpenPayPlans(db, id);
  if (openPayRows.length > 0) {
    closeAllOpenPayPlans(db, id, highCommissionFrom);
  } else {
    const hire = String(existing.hire_date || "").slice(0, 10) || "1970-01-01";
    const oldStart = hire <= highCommissionFrom ? hire : highCommissionFrom;
    db.prepare(`
      INSERT INTO personnel_pay_plans (
        id, personnel_id, start_date, end_date, salary,
        social_insurance, housing_fund, remark, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '分销前补录', datetime('now'))
    `).run(
      generateId("ppp"),
      id,
      oldStart,
      highCommissionFrom,
      existing.salary || "{}",
      existing.social_insurance || 0,
      existing.housing_fund || 0,
    );
  }
  insertOpenPayPlan(
    db,
    id,
    highCommissionFrom,
    distSalaryJson,
    0,
    0,
    "启用分销",
    getOperator(req),
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
        internal_sales_commission_type = 'percentage',
        internal_sales_commission_rate = ?,
        internal_sales_commission_amount = 0,
        internal_sales_commission_threshold = 0,
        internal_sales_commission_condition = ?,
        updated_at = ?
      WHERE personnel_id = ?
    `).run(
      distributionRate,
      `分销高提成（自 ${highCommissionFrom}）`,
      distributionInternalRate != null && Number.isFinite(distributionInternalRate)
        ? distributionInternalRate
        : 0,
      `关联内部销售（自 ${highCommissionFrom}，不计业绩）`,
      now,
      id,
    );
  }

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  const assigns = db
    .prepare(
      "SELECT * FROM personnel_unit_assignments WHERE personnel_id = ? ORDER BY start_date",
    )
    .all(id);
  res.json({
    personnel: rowToPersonnel(row, assigns, loadPayPlanRows(db, id)),
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
    const assigns = db
      .prepare(
        "SELECT * FROM personnel_unit_assignments WHERE personnel_id = ? ORDER BY start_date",
      )
      .all(id);
    return res.json(rowToPersonnel(row, assigns, loadPayPlanRows(db, id)));
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

  const nextUnitId = salesUnitId ?? existing.sales_unit_id;
  const unitChanged =
    salesUnitId !== undefined
    && String(salesUnitId) !== String(existing.sales_unit_id);

  runInTransaction(() => {
    db.prepare(`
      UPDATE personnel SET
        name = ?, sales_unit_id = ?, position = ?, phone = ?, email = ?,
        salary = ?, social_insurance = ?, housing_fund = ?,
        hire_date = ?, resign_date = ?, status = ?,
        high_commission_from = ?, regular_compensation = ?
      WHERE id = ?
    `).run(
      name ?? existing.name,
      nextUnitId,
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

    if (salary || socialInsurance !== undefined || housingFund !== undefined) {
      const openPay = listOpenPayPlans(db, id);
      const latest = openPay[openPay.length - 1];
      if (latest) {
        db.prepare(`
          UPDATE personnel_pay_plans
          SET salary = ?, social_insurance = ?, housing_fund = ?
          WHERE id = ?
        `).run(
          salaryJson,
          socialInsurance ?? existing.social_insurance,
          housingFund ?? existing.housing_fund,
          latest.id,
        );
      }
    }

    // 编辑里改单位：按今天生效写入时间轴（精确日期请用「转岗」）
    if (unitChanged) {
      const today = new Date().toISOString().slice(0, 10);
      const openRows = listOpenAssignments(db, id);
      if (openRows.length > 0) {
        closeAllOpenAssignments(db, id, today);
      } else {
        const hire = String(existing.hire_date || "").slice(0, 10) || "1970-01-01";
        db.prepare(`
          INSERT INTO personnel_unit_assignments (
            id, personnel_id, sales_unit_id, start_date, end_date, remark, created_at
          ) VALUES (?, ?, ?, ?, ?, '编辑前补录', datetime('now'))
        `).run(
          generateId("pua"),
          id,
          existing.sales_unit_id,
          hire <= today ? hire : today,
          today,
        );
      }
      insertOpenAssignment(
        db,
        id,
        String(nextUnitId),
        today,
        "编辑改单位",
        getOperator(req),
      );
    }
  });

  if (unitChanged) {
    afterManualAssignmentChange(id);
  }

  const row = db.prepare("SELECT * FROM personnel WHERE id = ?").get(id);
  const assigns = db
    .prepare(
      "SELECT * FROM personnel_unit_assignments WHERE personnel_id = ? ORDER BY start_date",
    )
    .all(id);
  res.json(rowToPersonnel(row, assigns, loadPayPlanRows(db, id)));
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
