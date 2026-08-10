import { Router } from "express";
import {
  getDb,
  generateId,
  rowToHrProfile,
  calcAgeFromIdOrBirth,
  getContractAlert,
} from "../db";
import { authMiddleware } from "../auth";
import {
  getVisibleUnitIds,
  requireModuleView,
  requireModuleEdit,
} from "../middleware";

const router = Router();

router.use(authMiddleware);
router.use(requireModuleView("hr_management"));

const HR_SELECT = `
  SELECT h.*,
    p.name, p.sales_unit_id, p.position, p.phone, p.hire_date, p.resign_date,
    p.status, p.salary, p.social_insurance, p.housing_fund,
    lc.name AS labor_company_name
  FROM hr_profiles h
  INNER JOIN personnel p ON p.id = h.personnel_id
  LEFT JOIN labor_companies lc ON lc.id = h.labor_company_id
`;

function text(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  return String(v).trim();
}

/** 去掉表头空格/换行，便于匹配「姓 名」「合同终止日期 」等 */
function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k).replace(/\s+/g, "").replace(/\u00a0/g, "");
    if (!key) continue;
    out[key] = v;
  }
  return out;
}

/** Excel 长数字科学计数法还原（身份证/银行卡） */
function fixExcelLongNumber(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    // 超过 15 位会丢精度，尽量用整数字符串
    if (Math.abs(v) >= 1e14) return BigInt(Math.round(v)).toString();
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  let s = String(v).trim();
  const sci = s.match(/^(\d+(?:\.\d+)?)[eE]\+(\d+)$/);
  if (sci) {
    const [base, exp] = [sci[1], Number(sci[2])];
    const [intPart, dec = ""] = base.split(".");
    const digits = (intPart + dec).replace(/^0+/, "") || "0";
    const zeros = exp - dec.length;
    if (zeros >= 0) return digits + "0".repeat(zeros);
  }
  // 去掉身份证里误加的 .0
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  return s;
}

function normalizeDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Excel 序列日
    const utc = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    const dt = new Date(utc);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = text(v);
  if (!s) return "";
  const m = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  return s.slice(0, 10);
}

function parseOptionalNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function upsertHrFields(body: Record<string, unknown>, fallback?: {
  laborCompanyId?: string;
  salesCompanyId?: string;
}) {
  const idNumber = text(body.idNumber ?? body.id_number);
  const birthDate = normalizeDate(body.birthDate ?? body.birth_date);
  const ageFromBody = parseOptionalNumber(body.age);
  const age = ageFromBody ?? calcAgeFromIdOrBirth(idNumber, birthDate);
  return {
    gender: text(body.gender),
    contractStartDate: normalizeDate(body.contractStartDate ?? body.contract_start_date),
    contractEndDate: normalizeDate(body.contractEndDate ?? body.contract_end_date),
    idNumber,
    birthDate,
    age,
    ethnicity: text(body.ethnicity),
    politicalStatus: text(body.politicalStatus ?? body.political_status),
    education: text(body.education),
    school: text(body.school),
    major: text(body.major),
    bankAccount: text(body.bankAccount ?? body.bank_account),
    bankName: text(body.bankName ?? body.bank_name),
    address: text(body.address),
    emergencyContact: text(body.emergencyContact ?? body.emergency_contact),
    emergencyPhone: text(body.emergencyPhone ?? body.emergency_phone),
    laborCompanyId: text(
      body.laborCompanyId ?? body.labor_company_id ?? fallback?.laborCompanyId ?? "",
    ),
    salesCompanyId: text(
      body.salesCompanyId ?? body.sales_company_id ?? fallback?.salesCompanyId ?? "",
    ),
  };
}

function resolveUnitIdByName(
  db: ReturnType<typeof getDb>,
  name: string,
  visibleIds: string[] | null,
): string {
  const n = name.trim();
  if (!n) return "";
  const units = db.prepare("SELECT id, name FROM sales_units").all() as Array<{
    id: string;
    name: string;
  }>;
  let matched = units.filter((u) => u.name.trim() === n);
  if (visibleIds !== null) {
    const set = new Set(visibleIds);
    matched = matched.filter((u) => set.has(u.id));
  }
  if (matched.length === 1) return matched[0].id;
  // 模糊包含（表格简称）
  if (matched.length === 0) {
    matched = units.filter((u) => u.name.includes(n) || n.includes(u.name.trim()));
    if (visibleIds !== null) {
      const set = new Set(visibleIds);
      matched = matched.filter((u) => set.has(u.id));
    }
    if (matched.length === 1) return matched[0].id;
  }
  return "";
}

/** 劳动签署公司：按名称查找或自动创建字典项（labor_companies） */
function resolveOrCreateLaborCompanyId(
  db: ReturnType<typeof getDb>,
  name: string,
): string {
  const n = name.trim();
  if (!n) return "";
  const existing = db
    .prepare("SELECT id FROM labor_companies WHERE name = ? COLLATE NOCASE")
    .get(n) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = generateId("lc");
  db.prepare("INSERT INTO labor_companies (id, name, remark) VALUES (?, ?, ?)").run(
    id,
    n,
    "",
  );
  return id;
}

function filterByVisibleUnits(rows: any[], user: NonNullable<Express.Request["user"]>) {
  const visibleIds = getVisibleUnitIds(user!);
  if (visibleIds === null) return rows;
  const idSet = new Set(visibleIds);
  return rows.filter((r) => idSet.has(r.sales_unit_id));
}

// GET /api/hr-profiles
router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare(`${HR_SELECT} ORDER BY p.name`).all() as any[];
  rows = filterByVisibleUnits(rows, req.user!);
  res.json(rows.map(rowToHrProfile));
});

// GET /api/hr-profiles/reminders
router.get("/reminders", (req, res) => {
  const db = getDb();
  let rows = db.prepare(`${HR_SELECT}`).all() as any[];
  rows = filterByVisibleUnits(rows, req.user!);
  let expired = 0;
  let due30 = 0;
  let due60 = 0;
  for (const row of rows) {
    const { contractAlert } = getContractAlert(row.contract_end_date);
    if (contractAlert === "expired") expired += 1;
    else if (contractAlert === "due30") due30 += 1;
    else if (contractAlert === "due60") due60 += 1;
  }
  res.json({
    expired,
    due30,
    due60,
    total: expired + due30 + due60,
  });
});

// POST /api/hr-profiles/batch-create — 一键为未建档人员生成空档案
router.post("/batch-create", requireModuleEdit("hr_management"), (req, res) => {
  const db = getDb();
  const visibleIds = getVisibleUnitIds(req.user!);
  let people = db.prepare("SELECT * FROM personnel ORDER BY name").all() as any[];
  if (visibleIds !== null) {
    const set = new Set(visibleIds);
    people = people.filter((p) => set.has(p.sales_unit_id));
  }

  const existingIds = new Set(
    (db.prepare("SELECT personnel_id FROM hr_profiles").all() as Array<{ personnel_id: string }>)
      .map((r) => r.personnel_id),
  );

  const insertStmt = db.prepare(`
    INSERT INTO hr_profiles (
      id, personnel_id, gender, contract_start_date, contract_end_date,
      id_number, birth_date, age, ethnicity, political_status, education,
      school, major, bank_account, bank_name, address,
      emergency_contact, emergency_phone, labor_company_id, sales_company_id, updated_at
    ) VALUES (?, ?, '', '', '', '', '', NULL, '', '', '', '', '', '', '', '', '', '', '', ?, datetime('now'))
  `);

  let created = 0;
  let skipped = 0;
  for (const person of people) {
    if (existingIds.has(person.id)) {
      skipped += 1;
      continue;
    }
    insertStmt.run(
      generateId("hr"),
      person.id,
      person.sales_unit_id || "",
    );
    created += 1;
  }

  res.json({ created, skipped, totalPersonnel: people.length });
});

// POST /api/hr-profiles — 为已有人员建档
router.post("/", requireModuleEdit("hr_management"), (req, res) => {
  const personnelId = text(req.body.personnelId);
  if (!personnelId) {
    return res.status(400).json({ error: "personnelId 不能为空" });
  }
  const db = getDb();
  const person: any = db.prepare("SELECT * FROM personnel WHERE id = ?").get(personnelId);
  if (!person) return res.status(404).json({ error: "人员不存在" });

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null && !visibleIds.includes(person.sales_unit_id)) {
    return res.status(403).json({ error: "无权为该人员建档" });
  }

  const existing = db.prepare("SELECT id FROM hr_profiles WHERE personnel_id = ?").get(personnelId);
  if (existing) {
    return res.status(400).json({ error: "该人员已有人事档案" });
  }

  const fields = upsertHrFields(req.body, {
    salesCompanyId: person.sales_unit_id || "",
  });
  // 仅写入档案表，默认取人员当前销售单位；不回写 personnel
  if (!fields.salesCompanyId) fields.salesCompanyId = person.sales_unit_id || "";

  const id = generateId("hr");
  db.prepare(`
    INSERT INTO hr_profiles (
      id, personnel_id, gender, contract_start_date, contract_end_date,
      id_number, birth_date, age, ethnicity, political_status, education,
      school, major, bank_account, bank_name, address,
      emergency_contact, emergency_phone, labor_company_id, sales_company_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id,
    personnelId,
    fields.gender,
    fields.contractStartDate,
    fields.contractEndDate,
    fields.idNumber,
    fields.birthDate,
    fields.age,
    fields.ethnicity,
    fields.politicalStatus,
    fields.education,
    fields.school,
    fields.major,
    fields.bankAccount,
    fields.bankName,
    fields.address,
    fields.emergencyContact,
    fields.emergencyPhone,
    fields.laborCompanyId,
    fields.salesCompanyId,
  );

  const row = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(id);
  res.json(rowToHrProfile(row));
});

// PUT /api/hr-profiles/:id
router.put("/:id", requireModuleEdit("hr_management"), (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing: any = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "人事档案不存在" });

  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null && !visibleIds.includes(existing.sales_unit_id)) {
    return res.status(403).json({ error: "无权编辑该档案" });
  }

  const fields = upsertHrFields({
    gender: req.body.gender ?? existing.gender,
    contractStartDate: req.body.contractStartDate ?? existing.contract_start_date,
    contractEndDate: req.body.contractEndDate ?? existing.contract_end_date,
    idNumber: req.body.idNumber ?? existing.id_number,
    birthDate: req.body.birthDate ?? existing.birth_date,
    age: req.body.age ?? existing.age,
    ethnicity: req.body.ethnicity ?? existing.ethnicity,
    politicalStatus: req.body.politicalStatus ?? existing.political_status,
    education: req.body.education ?? existing.education,
    school: req.body.school ?? existing.school,
    major: req.body.major ?? existing.major,
    bankAccount: req.body.bankAccount ?? existing.bank_account,
    bankName: req.body.bankName ?? existing.bank_name,
    address: req.body.address ?? existing.address,
    emergencyContact: req.body.emergencyContact ?? existing.emergency_contact,
    emergencyPhone: req.body.emergencyPhone ?? existing.emergency_phone,
    laborCompanyId: req.body.laborCompanyId ?? existing.labor_company_id,
    salesCompanyId: req.body.salesCompanyId ?? existing.sales_company_id,
  });

  db.prepare(`
    UPDATE hr_profiles SET
      gender=?, contract_start_date=?, contract_end_date=?,
      id_number=?, birth_date=?, age=?, ethnicity=?, political_status=?,
      education=?, school=?, major=?, bank_account=?, bank_name=?, address=?,
      emergency_contact=?, emergency_phone=?,
      labor_company_id=?, sales_company_id=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    fields.gender,
    fields.contractStartDate,
    fields.contractEndDate,
    fields.idNumber,
    fields.birthDate,
    fields.age,
    fields.ethnicity,
    fields.politicalStatus,
    fields.education,
    fields.school,
    fields.major,
    fields.bankAccount,
    fields.bankName,
    fields.address,
    fields.emergencyContact,
    fields.emergencyPhone,
    fields.laborCompanyId,
    fields.salesCompanyId,
    id,
  );

  // 可选：同步入离职到人员（不改提成、不改 sales_unit_id）
  const hireDate = req.body.hireDate;
  const resignDate = req.body.resignDate;
  if (hireDate !== undefined || resignDate !== undefined) {
    const nextHire = hireDate !== undefined ? normalizeDate(hireDate) : existing.hire_date;
    const nextResign =
      resignDate === undefined
        ? existing.resign_date
        : (resignDate === null || resignDate === "" ? null : normalizeDate(resignDate));
    let status = existing.status;
    if (req.body.status) status = text(req.body.status, existing.status);
    else if (nextResign) status = "inactive";
    db.prepare(
      "UPDATE personnel SET hire_date=?, resign_date=?, status=? WHERE id=?",
    ).run(nextHire || "", nextResign, status, existing.personnel_id);
  }

  const row = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(id);
  res.json(rowToHrProfile(row));
});

// DELETE /api/hr-profiles/:id
router.delete("/:id", requireModuleEdit("hr_management"), (req, res) => {
  const db = getDb();
  const existing: any = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "人事档案不存在" });
  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null && !visibleIds.includes(existing.sales_unit_id)) {
    return res.status(403).json({ error: "无权删除该档案" });
  }
  db.prepare("DELETE FROM hr_profiles WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

type ImportRow = Record<string, unknown>;

function pick(row: ImportRow, keys: string[]): unknown {
  const normalized = normalizeRowKeys(row);
  for (const k of keys) {
    const key = k.replace(/\s+/g, "");
    if (
      normalized[key] !== undefined
      && normalized[key] !== null
      && String(normalized[key]).trim() !== ""
    ) {
      return normalized[key];
    }
  }
  return undefined;
}

function findPersonnel(
  db: ReturnType<typeof getDb>,
  name: string,
  unitName: string,
  visibleIds: string[] | null,
) {
  const all = db.prepare("SELECT * FROM personnel").all() as any[];
  const units = db.prepare("SELECT id, name FROM sales_units").all() as Array<{ id: string; name: string }>;
  const unitNameToId = new Map(units.map((u) => [u.name.trim(), u.id]));
  const nameTrim = name.trim();
  let candidates = all.filter((p) => String(p.name || "").trim() === nameTrim);
  if (visibleIds !== null) {
    const set = new Set(visibleIds);
    candidates = candidates.filter((p) => set.has(p.sales_unit_id));
  }
  if (unitName) {
    let unitId = unitNameToId.get(unitName.trim()) || "";
    if (!unitId) unitId = resolveUnitIdByName(db, unitName, visibleIds);
    if (unitId) {
      const matched = candidates.filter((p) => p.sales_unit_id === unitId);
      if (matched.length === 1) {
        return { person: matched[0], reason: null as string | null, unitId };
      }
      if (matched.length > 1) {
        return {
          person: null,
          reason: `姓名「${name}」在单位「${unitName}」下匹配到多人`,
          unitId,
        };
      }
      return {
        person: null,
        reason: `未找到姓名「${name}」且单位为「${unitName}」的人员`,
        unitId,
      };
    }
    return {
      person: null,
      reason: `未匹配到销售单位「${unitName}」，请先在销售单位中创建同名单位`,
      unitId: "",
    };
  }
  if (candidates.length === 1) {
    return { person: candidates[0], reason: null as string | null, unitId: "" };
  }
  if (candidates.length === 0) {
    return { person: null, reason: `未匹配到人员「${name}」`, unitId: "" };
  }
  return {
    person: null,
    reason: `姓名「${name}」匹配到多人，请补充「部门/销售单位公司」列`,
    unitId: "",
  };
}

function isImportRowEmpty(row: ImportRow): boolean {
  const normalized = normalizeRowKeys(row);
  return Object.values(normalized).every(
    (v) => v === undefined || v === null || String(v).trim() === "",
  );
}

// POST /api/hr-profiles/import
router.post("/import", requireModuleEdit("hr_management"), (req, res) => {
  try {
    const rawRows = Array.isArray(req.body?.rows) ? (req.body.rows as ImportRow[]) : [];
    const rows = rawRows
      .map((row) => normalizeRowKeys(row))
      .filter((row) => !isImportRowEmpty(row));
    if (rows.length === 0) {
      return res.status(400).json({
        error: "导入数据为空，请确认表格含表头且有数据行",
      });
    }

    const db = getDb();
    const visibleIds = getVisibleUnitIds(req.user!);
    const result = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ row: number; name: string; reason: string }>,
    };

    const insertStmt = db.prepare(`
      INSERT INTO hr_profiles (
        id, personnel_id, gender, contract_start_date, contract_end_date,
        id_number, birth_date, age, ethnicity, political_status, education,
        school, major, bank_account, bank_name, address,
        emergency_contact, emergency_phone, labor_company_id, sales_company_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const updateStmt = db.prepare(`
      UPDATE hr_profiles SET
        gender=?, contract_start_date=?, contract_end_date=?,
        id_number=?, birth_date=?, age=?, ethnicity=?, political_status=?,
        education=?, school=?, major=?, bank_account=?, bank_name=?, address=?,
        emergency_contact=?, emergency_phone=?,
        labor_company_id=?, sales_company_id=?, updated_at=datetime('now')
      WHERE personnel_id=?
    `);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const excelRow = i + 1;
      const name = text(pick(row, ["姓名", "员工姓名", "name", "Name"]));
      if (!name) {
        if (i === 0) continue;
        result.failed += 1;
        result.errors.push({ row: excelRow, name: "", reason: "缺少姓名" });
        continue;
      }

      const unitName = text(pick(row, [
        "销售单位公司",
        "销售单位",
        "部门",
        "单位",
        "所属单位",
        "salesUnit",
        "department",
      ]));

      const phone = text(
        fixExcelLongNumber(pick(row, ["手机号", "手机", "电话", "phone"])),
      );
      const position = text(pick(row, ["职位", "岗位", "position"]));
      const hireDate = normalizeDate(pick(row, ["入职日期", "hireDate"]));
      const resignDateRaw = pick(row, ["离职日期", "resignDate"]);
      const resignDate =
        resignDateRaw === undefined || resignDateRaw === null || text(resignDateRaw) === ""
          ? undefined
          : normalizeDate(resignDateRaw);
      const statusRaw = text(pick(row, ["状态", "status"]));
      let status = "active";
      if (statusRaw.includes("离")) status = "inactive";
      else if (statusRaw.includes("在") || statusRaw.includes("职")) status = "active";
      else if (resignDate) status = "inactive";

      let { person, reason, unitId } = findPersonnel(db, name, unitName, visibleIds);
      if (!person) {
        result.failed += 1;
        result.errors.push({
          row: excelRow,
          name,
          reason: reason || "匹配失败",
        });
        continue;
      }

      const laborName = text(
        pick(row, ["劳动签署公司", "劳动合同公司", "签署公司", "laborCompany"]),
      );
      // 销售单位列仅用于 findPersonnel；档案 sales_company_id 取匹配单位或人员现有单位
      const salesCompanyId = unitId || person.sales_unit_id || "";
      const laborCompanyId = laborName
        ? resolveOrCreateLaborCompanyId(db, laborName)
        : "";

      const fields = upsertHrFields({
        gender: pick(row, ["性别", "gender"]),
        contractStartDate: pick(row, [
          "合同起始日期",
          "合同开始日期",
          "合同起日",
          "contractStartDate",
        ]),
        contractEndDate: pick(row, [
          "合同终止日期",
          "合同结束日期",
          "合同止日",
          "contractEndDate",
        ]),
        idNumber: fixExcelLongNumber(pick(row, ["身份证号", "身份证", "idNumber"])),
        birthDate: pick(row, ["出生日期", "birthDate"]),
        age: pick(row, ["年龄", "age"]),
        ethnicity: pick(row, ["民族", "ethnicity"]),
        politicalStatus: pick(row, ["政治面貌", "politicalStatus"]),
        education: pick(row, ["学历", "education"]),
        school: pick(row, ["毕业院校", "院校", "school"]),
        major: pick(row, ["专业", "major"]),
        bankAccount: fixExcelLongNumber(pick(row, ["银行卡号", "银行卡", "bankAccount"])),
        bankName: pick(row, ["开户行", "bankName"]),
        address: pick(row, ["现住址", "住址", "地址", "address"]),
        emergencyContact: pick(row, ["紧急联系人", "emergencyContact"]),
        emergencyPhone: fixExcelLongNumber(
          pick(row, ["紧急联系电话", "紧急电话", "emergencyPhone"]),
        ),
        laborCompanyId,
        salesCompanyId,
      });

      try {
        const existed = db
          .prepare("SELECT id FROM hr_profiles WHERE personnel_id = ?")
          .get(person.id) as { id: string } | undefined;
        if (existed) {
          updateStmt.run(
            fields.gender,
            fields.contractStartDate,
            fields.contractEndDate,
            fields.idNumber,
            fields.birthDate,
            fields.age,
            fields.ethnicity,
            fields.politicalStatus,
            fields.education,
            fields.school,
            fields.major,
            fields.bankAccount,
            fields.bankName,
            fields.address,
            fields.emergencyContact,
            fields.emergencyPhone,
            fields.laborCompanyId,
            fields.salesCompanyId,
            person.id,
          );
        } else {
          insertStmt.run(
            generateId("hr"),
            person.id,
            fields.gender,
            fields.contractStartDate,
            fields.contractEndDate,
            fields.idNumber,
            fields.birthDate,
            fields.age,
            fields.ethnicity,
            fields.politicalStatus,
            fields.education,
            fields.school,
            fields.major,
            fields.bankAccount,
            fields.bankName,
            fields.address,
            fields.emergencyContact,
            fields.emergencyPhone,
            fields.laborCompanyId,
            fields.salesCompanyId,
          );
        }

        // 可选同步入离职/职位/手机；绝不改 sales_unit_id
        let personnelStatus = person.status || status;
        if (statusRaw.includes("离")) personnelStatus = "inactive";
        else if (statusRaw.includes("在") || statusRaw.includes("职")) personnelStatus = "active";
        else if (resignDate) personnelStatus = "inactive";
        else if (statusRaw) personnelStatus = status;

        db.prepare(`
          UPDATE personnel SET
            hire_date = COALESCE(NULLIF(?, ''), hire_date),
            resign_date = CASE WHEN ? = 1 THEN ? ELSE resign_date END,
            status = ?,
            position = CASE WHEN ? != '' THEN ? ELSE position END,
            phone = CASE WHEN ? != '' THEN ? ELSE phone END
          WHERE id = ?
        `).run(
          hireDate,
          resignDate !== undefined ? 1 : 0,
          resignDate ?? null,
          personnelStatus,
          position,
          position,
          phone,
          phone,
          person.id,
        );

        result.success += 1;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "写入失败";
        result.failed += 1;
        result.errors.push({
          row: excelRow,
          name,
          reason: message,
        });
      }
    }

    res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "导入失败";
    console.error("hr-profiles import error:", e);
    res.status(500).json({ error: message });
  }
});

export default router;
