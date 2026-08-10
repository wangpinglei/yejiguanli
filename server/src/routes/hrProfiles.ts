import { Router } from "express";
import fs from "fs";
import path from "path";
import {
  getDb,
  generateId,
  rowToHrProfile,
  calcAgeFromIdOrBirth,
  getContractAlert,
  parseSignedDocuments,
  type SignedDocument,
} from "../db";
import { authMiddleware } from "../auth";
import {
  requireModuleView,
  requireModuleEdit,
} from "../middleware";

const router = Router();
const HR_DOCS_DIR = path.join(__dirname, "..", "data", "hr-docs");
const MAX_DOC_BYTES = 12 * 1024 * 1024;

function ensureHrDocsDir() {
  if (!fs.existsSync(HR_DOCS_DIR)) {
    fs.mkdirSync(HR_DOCS_DIR, { recursive: true });
  }
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name || "document").replace(/[\\/:*?"<>|]+/g, "_");
  return base.slice(0, 120) || "document";
}

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 统一输出 YYYY-MM-DD；无法识别则返回空，避免截断乱码 */
function ymd(y: number, m: number, d: number): string {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function fromExcelSerial(n: number): string {
  if (!Number.isFinite(n) || n < 1 || n >= 80000) return "";
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const dt = new Date(utc);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * 导入/入库日期统一为 YYYY-MM-DD（年-月-日）
 * 兼容：Date、Excel 序列、ISO、中文年月日、美式 M/D/Y、年月
 */
function normalizeDate(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // 用本地年月日，避免 JSON ISO 时区把「当天 0 点」写成前一天
    return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 2000 && v < 80000) return fromExcelSerial(v);
    return "";
  }

  const s = text(v);
  if (!s || s === "-" || s === "—" || s === "/" || s === "无") return "";

  // ISO 带时间：按本地日历日（修正 UTC 偏移串日）
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
  }

  // 纯 YYYY-MM-DD
  const isoDay = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDay) return ymd(+isoDay[1], +isoDay[2], +isoDay[3]);

  // 2024年1月15日 / 2024年1月
  const cn = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/);
  if (cn) return ymd(+cn[1], +cn[2], cn[3] ? +cn[3] : 1);

  // 2024/1/15、2024.01.15、2024-1-5
  const ymdSlash = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (ymdSlash) return ymd(+ymdSlash[1], +ymdSlash[2], +ymdSlash[3]);

  // 2024/01、2024.1（出生年月）
  const ym = s.match(/^(\d{4})[\/\-.](\d{1,2})$/);
  if (ym) return ymd(+ym[1], +ym[2], 1);

  // 1/15/2024、01-15-2024（美式）
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mdy) return ymd(+mdy[3], +mdy[1], +mdy[2]);

  // 1/15/24
  const mdy2 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (mdy2) {
    const yy = Number(mdy2[3]);
    const y = yy >= 70 ? 1900 + yy : 2000 + yy;
    return ymd(y, +mdy2[1], +mdy2[2]);
  }

  // YYYYMMDD
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return ymd(+compact[1], +compact[2], +compact[3]);

  // Excel 序列数字符串
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 2000 && n < 80000) return fromExcelSerial(n);
  }

  // 英文日期串等
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  return "";
}

/** 解析「起止」合并单元格，如 2020.01.01-2023.12.31 / 2020年1月1日至2023年12月31日 */
function parseDateRange(v: unknown): { start: string; end: string } {
  const s = text(v);
  if (!s) return { start: "", end: "" };

  const byKeyword = s.split(/\s*(?:至|到|~|～|—|–)\s*/).map((p) => p.trim()).filter(Boolean);
  if (byKeyword.length >= 2) {
    return {
      start: normalizeDate(byKeyword[0]),
      end: normalizeDate(byKeyword[byKeyword.length - 1]),
    };
  }

  const tokens = [
    ...s.matchAll(
      /(\d{4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}[\/\-.]\d{1,2}|\d{8})/g,
    ),
  ].map((m) => m[1]);
  if (tokens.length >= 2) {
    return {
      start: normalizeDate(tokens[0]),
      end: normalizeDate(tokens[tokens.length - 1]),
    };
  }
  if (tokens.length === 1) {
    return { start: normalizeDate(tokens[0]), end: "" };
  }
  return { start: normalizeDate(s), end: "" };
}

function firstNormalizedDate(...vals: unknown[]): string {
  for (const v of vals) {
    if (v === undefined || v === null || text(v) === "") continue;
    const d = normalizeDate(v);
    if (d) return d;
  }
  return "";
}

/** 优先用独立开始/结束列；否则从「起止」合并列拆分 */
function resolveStartEndDates(
  startCandidates: unknown[],
  endCandidates: unknown[],
  rangeCandidates: unknown[],
): { start: string; end: string } {
  let start = firstNormalizedDate(...startCandidates);
  let end = firstNormalizedDate(...endCandidates);
  if (start && end) return { start, end };

  for (const rangeVal of rangeCandidates) {
    if (rangeVal === undefined || rangeVal === null || text(rangeVal) === "") continue;
    const range = parseDateRange(rangeVal);
    if (!start && range.start) start = range.start;
    if (!end && range.end) end = range.end;
    if (start && end) break;
  }
  return { start, end };
}

function parseOptionalNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 合同提醒用：取已填期次中到期日最晚的一期 */
function resolveCurrentContract(
  c1s: string,
  c1e: string,
  c2s: string,
  c2e: string,
  c3s: string,
  c3e: string,
  fallbackStart = "",
  fallbackEnd = "",
): { start: string; end: string } {
  const periods = [
    { start: c3s, end: c3e },
    { start: c2s, end: c2e },
    { start: c1s, end: c1e },
  ].filter((p) => p.start || p.end);
  if (periods.length === 0) {
    return { start: fallbackStart, end: fallbackEnd };
  }
  let best = periods[0];
  for (const p of periods) {
    if ((p.end || "") > (best.end || "")) best = p;
  }
  return { start: best.start || "", end: best.end || "" };
}

function mapPartyMember(v: unknown): string {
  const s = text(v);
  if (!s) return "";
  if (s === "是" || s.includes("党员")) return s.includes("预备") ? s : (s === "是" ? "党员" : s);
  if (s === "否" || s.includes("群众")) return s === "否" ? "群众" : s;
  return s;
}

function upsertHrFields(body: Record<string, unknown>, fallback?: {
  laborCompanyId?: string;
  salesCompanyId?: string;
}) {
  const idNumber = text(body.idNumber ?? body.id_number);
  const birthDate = normalizeDate(body.birthDate ?? body.birth_date);
  const ageFromBody = parseOptionalNumber(body.age);
  const age = ageFromBody ?? calcAgeFromIdOrBirth(idNumber, birthDate);

  const contract1StartDate = normalizeDate(
    body.contract1StartDate ?? body.contract1_start_date,
  );
  const contract1EndDate = normalizeDate(
    body.contract1EndDate ?? body.contract1_end_date,
  );
  const contract2StartDate = normalizeDate(
    body.contract2StartDate ?? body.contract2_start_date,
  );
  const contract2EndDate = normalizeDate(
    body.contract2EndDate ?? body.contract2_end_date,
  );
  const contract3StartDate = normalizeDate(
    body.contract3StartDate ?? body.contract3_start_date,
  );
  const contract3EndDate = normalizeDate(
    body.contract3EndDate ?? body.contract3_end_date,
  );
  const current = resolveCurrentContract(
    contract1StartDate,
    contract1EndDate,
    contract2StartDate,
    contract2EndDate,
    contract3StartDate,
    contract3EndDate,
    normalizeDate(body.contractStartDate ?? body.contract_start_date),
    normalizeDate(body.contractEndDate ?? body.contract_end_date),
  );

  return {
    gender: text(body.gender),
    contractStartDate: current.start,
    contractEndDate: current.end,
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
    companyTenure: text(body.companyTenure ?? body.company_tenure),
    regularizationDate: normalizeDate(
      body.regularizationDate ?? body.regularization_date,
    ),
    employmentType: text(body.employmentType ?? body.employment_type),
    maritalStatus: text(body.maritalStatus ?? body.marital_status),
    nativePlace: text(body.nativePlace ?? body.native_place),
    householdRegister: text(body.householdRegister ?? body.household_register),
    idAddress: text(body.idAddress ?? body.id_address),
    graduationDate: normalizeDate(body.graduationDate ?? body.graduation_date),
    emergencyRelation: text(body.emergencyRelation ?? body.emergency_relation),
    internshipStartDate: normalizeDate(
      body.internshipStartDate ?? body.internship_start_date,
    ),
    internshipEndDate: normalizeDate(
      body.internshipEndDate ?? body.internship_end_date,
    ),
    contract1StartDate,
    contract1EndDate,
    contract2StartDate,
    contract2EndDate,
    contract3StartDate,
    contract3EndDate,
    bankBelong: text(body.bankBelong ?? body.bank_belong),
    companyEmail: text(body.companyEmail ?? body.company_email),
  };
}

const HR_FIELD_COLUMNS = `
  gender, contract_start_date, contract_end_date,
  id_number, birth_date, age, ethnicity, political_status, education,
  school, major, bank_account, bank_name, address,
  emergency_contact, emergency_phone, labor_company_id, sales_company_id,
  company_tenure, regularization_date, employment_type, marital_status,
  native_place, household_register, id_address, graduation_date,
  emergency_relation, internship_start_date, internship_end_date,
  contract1_start_date, contract1_end_date,
  contract2_start_date, contract2_end_date,
  contract3_start_date, contract3_end_date,
  bank_belong, company_email
`.replace(/\s+/g, " ").trim();

function hrFieldValues(fields: ReturnType<typeof upsertHrFields>): unknown[] {
  return [
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
    fields.companyTenure,
    fields.regularizationDate,
    fields.employmentType,
    fields.maritalStatus,
    fields.nativePlace,
    fields.householdRegister,
    fields.idAddress,
    fields.graduationDate,
    fields.emergencyRelation,
    fields.internshipStartDate,
    fields.internshipEndDate,
    fields.contract1StartDate,
    fields.contract1EndDate,
    fields.contract2StartDate,
    fields.contract2EndDate,
    fields.contract3StartDate,
    fields.contract3EndDate,
    fields.bankBelong,
    fields.companyEmail,
  ];
}

function resolveUnitIdByName(db: ReturnType<typeof getDb>, name: string): string {
  const n = name.trim();
  if (!n) return "";
  const units = db.prepare("SELECT id, name FROM sales_units").all() as Array<{
    id: string;
    name: string;
  }>;
  let matched = units.filter((u) => u.name.trim() === n);
  if (matched.length === 1) return matched[0].id;
  // 模糊包含（表格简称）
  if (matched.length === 0) {
    matched = units.filter((u) => u.name.includes(n) || n.includes(u.name.trim()));
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

function findLaborCompanyId(
  db: ReturnType<typeof getDb>,
  name: string,
): string {
  const n = name.trim();
  if (!n) return "";
  const existing = db
    .prepare("SELECT id FROM labor_companies WHERE name = ? COLLATE NOCASE")
    .get(n) as { id: string } | undefined;
  return existing?.id || "";
}

function getProfileSignedDocs(
  db: ReturnType<typeof getDb>,
  profileId: string,
): { row: any; docs: SignedDocument[] } | null {
  const row = db.prepare("SELECT * FROM hr_profiles WHERE id = ?").get(profileId) as
    | any
    | undefined;
  if (!row) return null;
  return { row, docs: parseSignedDocuments(row.signed_documents) };
}

function saveProfileSignedDocs(
  db: ReturnType<typeof getDb>,
  profileId: string,
  docs: SignedDocument[],
) {
  db.prepare(
    "UPDATE hr_profiles SET signed_documents = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(docs), profileId);
}

// GET /api/hr-profiles（有人事权限即可看全量，不按销售单位过滤）
router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`${HR_SELECT} ORDER BY p.name`).all() as any[];
  res.json(rows.map(rowToHrProfile));
});

// GET /api/hr-profiles/reminders
router.get("/reminders", (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`${HR_SELECT}`).all() as any[];
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
router.post("/batch-create", requireModuleEdit("hr_management"), (_req, res) => {
  const db = getDb();
  const people = db.prepare("SELECT * FROM personnel ORDER BY name").all() as any[];

  const existingIds = new Set(
    (db.prepare("SELECT personnel_id FROM hr_profiles").all() as Array<{ personnel_id: string }>)
      .map((r) => r.personnel_id),
  );

  const insertStmt = db.prepare(`
    INSERT INTO hr_profiles (
      id, personnel_id, ${HR_FIELD_COLUMNS}, updated_at
    ) VALUES (?, ?, ${HR_FIELD_COLUMNS.split(",").map(() => "?").join(", ")}, datetime('now'))
  `);

  let created = 0;
  let skipped = 0;
  for (const person of people) {
    if (existingIds.has(person.id)) {
      skipped += 1;
      continue;
    }
    const empty = upsertHrFields({}, { salesCompanyId: person.sales_unit_id || "" });
    insertStmt.run(generateId("hr"), person.id, ...hrFieldValues(empty));
    created += 1;
  }

  res.json({ created, skipped, totalPersonnel: people.length });
});

// POST /api/hr-profiles/batch-delete — 批量删除所选人事档案（保留人员管理手动录入数据）
router.post("/batch-delete", requireModuleEdit("hr_management"), (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: "请选择要删除的人事档案" });
  }
  const db = getDb();
  const del = db.prepare("DELETE FROM hr_profiles WHERE id = ?");
  let deleted = 0;
  for (const id of ids) {
    const info = del.run(id);
    deleted += Number(info.changes || 0);
  }
  res.json({ deleted });
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
      id, personnel_id, ${HR_FIELD_COLUMNS}, updated_at
    ) VALUES (?, ?, ${HR_FIELD_COLUMNS.split(",").map(() => "?").join(", ")}, datetime('now'))
  `).run(id, personnelId, ...hrFieldValues(fields));

  const row = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(id);
  res.json(rowToHrProfile(row));
});

// PUT /api/hr-profiles/:id
router.put("/:id", requireModuleEdit("hr_management"), (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing: any = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "人事档案不存在" });

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
    companyTenure: req.body.companyTenure ?? existing.company_tenure,
    regularizationDate: req.body.regularizationDate ?? existing.regularization_date,
    employmentType: req.body.employmentType ?? existing.employment_type,
    maritalStatus: req.body.maritalStatus ?? existing.marital_status,
    nativePlace: req.body.nativePlace ?? existing.native_place,
    householdRegister: req.body.householdRegister ?? existing.household_register,
    idAddress: req.body.idAddress ?? existing.id_address,
    graduationDate: req.body.graduationDate ?? existing.graduation_date,
    emergencyRelation: req.body.emergencyRelation ?? existing.emergency_relation,
    internshipStartDate: req.body.internshipStartDate ?? existing.internship_start_date,
    internshipEndDate: req.body.internshipEndDate ?? existing.internship_end_date,
    contract1StartDate: req.body.contract1StartDate ?? existing.contract1_start_date,
    contract1EndDate: req.body.contract1EndDate ?? existing.contract1_end_date,
    contract2StartDate: req.body.contract2StartDate ?? existing.contract2_start_date,
    contract2EndDate: req.body.contract2EndDate ?? existing.contract2_end_date,
    contract3StartDate: req.body.contract3StartDate ?? existing.contract3_start_date,
    contract3EndDate: req.body.contract3EndDate ?? existing.contract3_end_date,
    bankBelong: req.body.bankBelong ?? existing.bank_belong,
    companyEmail: req.body.companyEmail ?? existing.company_email,
  });

  const setClause = HR_FIELD_COLUMNS.split(", ")
    .map((c) => `${c}=?`)
    .join(", ");
  db.prepare(`
    UPDATE hr_profiles SET ${setClause}, updated_at=datetime('now') WHERE id=?
  `).run(...hrFieldValues(fields), id);

  // 同步入离职到人员管理（盈亏/成本按此时间段实时计人力成本；不改提成、不改 sales_unit_id）
  if (req.body.hireDate !== undefined || req.body.resignDate !== undefined) {
    const nextHire =
      req.body.hireDate !== undefined
        ? normalizeDate(req.body.hireDate)
        : (existing.hire_date || "");
    const nextResign =
      req.body.resignDate === undefined
        ? existing.resign_date
        : (req.body.resignDate === null || req.body.resignDate === ""
          ? null
          : normalizeDate(req.body.resignDate));
    let status = existing.status || "active";
    if (req.body.status) {
      status = text(req.body.status, status);
    } else if (!nextResign) {
      status = "active";
    } else {
      const today = new Date().toISOString().slice(0, 10);
      status = nextResign < today ? "inactive" : "active";
    }
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

/**
 * 按姓名（+可选单位）匹配人员管理中的已有人员。
 * 不再自动新建人员：人事与人员管理关联但不互相造人。
 */
function findPersonnel(
  db: ReturnType<typeof getDb>,
  name: string,
  unitName: string,
) {
  const all = db.prepare("SELECT * FROM personnel").all() as any[];
  const nameTrim = name.trim();
  const candidates = all.filter((p) => String(p.name || "").trim() === nameTrim);
  const exactUnitId = unitName.trim() ? resolveUnitIdByName(db, unitName) : "";

  if (unitName.trim()) {
    const matched = exactUnitId
      ? candidates.filter((p) => p.sales_unit_id === exactUnitId)
      : candidates;
    if (matched.length === 1) {
      return {
        person: matched[0],
        reason: null as string | null,
        unitId: matched[0].sales_unit_id || exactUnitId,
      };
    }
    if (matched.length > 1) {
      return {
        person: null,
        reason: `姓名「${name}」在单位「${unitName}」下匹配到多人`,
        unitId: exactUnitId,
      };
    }
    if (candidates.length === 0) {
      return {
        person: null,
        reason: `人员管理中不存在「${name}」，请先在人员管理添加后再导入`,
        unitId: exactUnitId,
      };
    }
    return {
      person: null,
      reason: exactUnitId
        ? `人员管理中「${name}」不在单位「${unitName}」下`
        : `未找到销售单位「${unitName}」，且姓名「${name}」无法唯一匹配`,
      unitId: "",
    };
  }

  if (candidates.length === 1) {
    return {
      person: candidates[0],
      reason: null as string | null,
      unitId: candidates[0].sales_unit_id || "",
    };
  }
  if (candidates.length === 0) {
    return {
      person: null,
      reason: `人员管理中不存在「${name}」，请先在人员管理添加后再导入`,
      unitId: "",
    };
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

// POST /api/hr-profiles/:id/documents — 上传签署文档（base64）
router.post("/:id/documents", requireModuleEdit("hr_management"), (req, res) => {
  const { id } = req.params;
  const fileName = sanitizeFileName(text(req.body?.fileName));
  const mimeType = text(req.body?.mimeType, "application/octet-stream");
  const contentBase64 = text(req.body?.contentBase64);
  if (!contentBase64) {
    return res.status(400).json({ error: "缺少文件内容" });
  }

  const db = getDb();
  const profile = getProfileSignedDocs(db, id);
  if (!profile) return res.status(404).json({ error: "人事档案不存在" });

  let buffer: Buffer;
  try {
    const raw = contentBase64.includes(",")
      ? contentBase64.split(",").pop() || ""
      : contentBase64;
    buffer = Buffer.from(raw, "base64");
  } catch {
    return res.status(400).json({ error: "文件内容无效" });
  }
  if (!buffer.length) return res.status(400).json({ error: "文件为空" });
  if (buffer.length > MAX_DOC_BYTES) {
    return res.status(400).json({ error: "单个文件不能超过 12MB" });
  }

  ensureHrDocsDir();
  const docId = generateId("hrdoc");
  const ext = path.extname(fileName) || "";
  const storedName = `${id}_${docId}${ext}`;
  fs.writeFileSync(path.join(HR_DOCS_DIR, storedName), buffer);

  const doc: SignedDocument = {
    id: docId,
    fileName,
    storedName,
    mimeType,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
  };
  const next = [...profile.docs, doc];
  saveProfileSignedDocs(db, id, next);

  const row = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(id);
  res.json(rowToHrProfile(row));
});

// GET /api/hr-profiles/:id/documents/:docId — 下载签署文档（需登录）
router.get("/:id/documents/:docId", (req, res) => {
  const { id, docId } = req.params;
  const db = getDb();
  const profile = getProfileSignedDocs(db, id);
  if (!profile) return res.status(404).json({ error: "人事档案不存在" });
  const doc = profile.docs.find((d) => d.id === docId);
  if (!doc) return res.status(404).json({ error: "文档不存在" });

  const filePath = path.join(HR_DOCS_DIR, doc.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "文件已丢失，请重新上传" });
  }
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
  );
  fs.createReadStream(filePath).pipe(res);
});

// DELETE /api/hr-profiles/:id/documents/:docId
router.delete("/:id/documents/:docId", requireModuleEdit("hr_management"), (req, res) => {
  const { id, docId } = req.params;
  const db = getDb();
  const profile = getProfileSignedDocs(db, id);
  if (!profile) return res.status(404).json({ error: "人事档案不存在" });
  const doc = profile.docs.find((d) => d.id === docId);
  if (!doc) return res.status(404).json({ error: "文档不存在" });

  const next = profile.docs.filter((d) => d.id !== docId);
  saveProfileSignedDocs(db, id, next);
  const filePath = path.join(HR_DOCS_DIR, doc.storedName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // 忽略磁盘删除失败，元数据已更新
  }

  const row = db.prepare(`${HR_SELECT} WHERE h.id = ?`).get(id);
  res.json(rowToHrProfile(row));
});

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

    const options = (req.body?.options && typeof req.body.options === "object"
      ? req.body.options
      : {}) as {
      laborCompanyId?: string;
      laborCompanyName?: string;
      preferSelectedLaborCompany?: boolean;
      autoCreateLaborCompany?: boolean;
      forceStatus?: "active" | "inactive" | "";
    };
    const preferSelected = Boolean(options.preferSelectedLaborCompany);
    const autoCreateLabor =
      options.autoCreateLaborCompany === undefined
        ? true
        : Boolean(options.autoCreateLaborCompany);
    const forceStatus =
      options.forceStatus === "active" || options.forceStatus === "inactive"
        ? options.forceStatus
        : "";

    const db = getDb();
    let defaultLaborCompanyId = text(options.laborCompanyId);
    const selectedLaborName = text(options.laborCompanyName);
    if (!defaultLaborCompanyId && selectedLaborName) {
      defaultLaborCompanyId = autoCreateLabor
        ? resolveOrCreateLaborCompanyId(db, selectedLaborName)
        : findLaborCompanyId(db, selectedLaborName);
      if (!defaultLaborCompanyId && selectedLaborName) {
        return res.status(400).json({
          error: autoCreateLabor
            ? "无法创建签署公司"
            : `签署公司「${selectedLaborName}」不存在，请先创建或勾选自动创建`,
        });
      }
    }
    if (defaultLaborCompanyId) {
      const exists = db
        .prepare("SELECT id FROM labor_companies WHERE id = ?")
        .get(defaultLaborCompanyId);
      if (!exists) {
        return res.status(400).json({ error: "所选签署公司不存在" });
      }
    }

    const result = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ row: number; name: string; reason: string }>,
    };

    const insertStmt = db.prepare(`
      INSERT INTO hr_profiles (
        id, personnel_id, ${HR_FIELD_COLUMNS}, updated_at
      ) VALUES (?, ?, ${HR_FIELD_COLUMNS.split(",").map(() => "?").join(", ")}, datetime('now'))
    `);
    const updateStmt = db.prepare(`
      UPDATE hr_profiles SET
        ${HR_FIELD_COLUMNS.split(", ").map((c) => `${c}=?`).join(", ")},
        updated_at=datetime('now')
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
        fixExcelLongNumber(pick(row, ["手机号码", "手机号", "手机", "电话", "phone"])),
      );
      const position = text(pick(row, ["职位", "岗位", "用工性质", "position"]));
      const hireDate = normalizeDate(pick(row, ["入职时间", "入职日期", "hireDate"]));
      const resignDateRaw = pick(row, ["离职日期", "resignDate"]);
      const resignDate =
        resignDateRaw === undefined || resignDateRaw === null || text(resignDateRaw) === ""
          ? undefined
          : normalizeDate(resignDateRaw);
      const statusRaw = text(pick(row, ["状态", "status"]));
      let status = "active";
      if (forceStatus) {
        status = forceStatus;
      } else if (statusRaw.includes("离")) {
        status = "inactive";
      } else if (statusRaw.includes("在") || statusRaw.includes("职")) {
        status = "active";
      } else if (resignDate) {
        status = "inactive";
      }

      const { person, reason, unitId } = findPersonnel(db, name, unitName);
      if (!person) {
        result.failed += 1;
        result.errors.push({
          row: excelRow,
          name,
          reason: reason || "人员管理中不存在，请先在人员管理添加后再导入",
        });
        continue;
      }

      const laborName = text(pick(row, [
        "合同主体",
        "劳动合同签署公司",
        "劳动签署公司",
        "劳动合同公司",
        "签署公司",
        "laborCompany",
      ]));
      const salesCompanyId = unitId || person.sales_unit_id || "";
      let laborCompanyId = "";
      if (preferSelected && defaultLaborCompanyId) {
        laborCompanyId = defaultLaborCompanyId;
      } else if (laborName) {
        laborCompanyId = autoCreateLabor
          ? resolveOrCreateLaborCompanyId(db, laborName)
          : findLaborCompanyId(db, laborName);
        if (!laborCompanyId && laborName && !autoCreateLabor) {
          result.failed += 1;
          result.errors.push({
            row: excelRow,
            name,
            reason: `签署公司「${laborName}」不在字典中`,
          });
          continue;
        }
      } else if (defaultLaborCompanyId) {
        laborCompanyId = defaultLaborCompanyId;
      }

      const bankBelong = text(pick(row, ["所属银行", "bankBelong"]));
      const bankBranch = text(pick(row, ["开户行信息", "开户行", "bankName"]));
      const bankName = [bankBelong, bankBranch].filter(Boolean).join(" ").trim() || bankBranch;

      const party = mapPartyMember(pick(row, ["是否党员", "政治面貌", "politicalStatus"]));

      const internship = resolveStartEndDates(
        [pick(row, ["实习协议开始时间", "实习协议起始", "internshipStartDate"])],
        [pick(row, ["实习协议到期时间", "实习协议终止", "internshipEndDate"])],
        [pick(row, ["实习协议起止", "实习协议起止时间", "实习期"])],
      );
      const contract1 = resolveStartEndDates(
        [pick(row, ["劳动合同1开始时间", "劳动合同1起始", "合同1开始"])],
        [pick(row, ["劳动合同1到期时间", "劳动合同1终止", "合同1到期"])],
        [pick(row, ["劳动合同1起止", "劳动合同1起止时间", "合同1起止"])],
      );
      const contract2 = resolveStartEndDates(
        [pick(row, ["劳动合同2开始时间", "劳动合同2起始", "合同2开始"])],
        [pick(row, ["劳动合同2到期时间", "劳动合同2终止", "合同2到期"])],
        [pick(row, ["劳动合同2起止", "劳动合同2起止时间", "合同2起止"])],
      );
      const contract3 = resolveStartEndDates(
        [pick(row, ["劳动合同3开始时间", "劳动合同3起始", "合同3开始"])],
        [pick(row, ["劳动合同3到期时间", "劳动合同3终止", "合同3到期"])],
        [pick(row, ["劳动合同3起止", "劳动合同3起止时间", "合同3起止"])],
      );

      const fields = upsertHrFields({
        gender: pick(row, ["性别", "gender"]),
        contract1StartDate: contract1.start,
        contract1EndDate: contract1.end,
        contract2StartDate: contract2.start,
        contract2EndDate: contract2.end,
        contract3StartDate: contract3.start,
        contract3EndDate: contract3.end,
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
        idNumber: fixExcelLongNumber(pick(row, ["身份证", "身份证号", "idNumber"])),
        birthDate: pick(row, ["出生年月", "出生日期", "birthDate"]),
        age: pick(row, ["年龄", "age"]),
        ethnicity: pick(row, ["民族", "ethnicity"]),
        politicalStatus: party,
        education: pick(row, ["学历", "education"]),
        school: pick(row, ["毕业院校", "院校", "school"]),
        major: pick(row, ["专业", "major"]),
        bankAccount: fixExcelLongNumber(pick(row, ["银行卡号", "银行卡", "bankAccount"])),
        bankName,
        bankBelong,
        address: pick(row, ["联系地址", "现住址", "住址", "地址", "address"]),
        emergencyContact: pick(row, ["紧急联系人姓名", "紧急联系人", "emergencyContact"]),
        emergencyPhone: fixExcelLongNumber(
          pick(row, ["联系电话", "紧急联系电话", "紧急电话", "emergencyPhone"]),
        ),
        laborCompanyId,
        salesCompanyId,
        companyTenure: pick(row, ["司龄", "companyTenure"]),
        regularizationDate: pick(row, ["转正日期", "regularizationDate"]),
        employmentType: pick(row, ["用工性质", "employmentType"]),
        maritalStatus: pick(row, ["婚姻状况", "maritalStatus"]),
        nativePlace: pick(row, ["籍贯", "nativePlace"]),
        householdRegister: pick(row, ["户籍", "householdRegister"]),
        idAddress: pick(row, ["身份证地址", "idAddress"]),
        graduationDate: pick(row, ["毕业时间", "graduationDate"]),
        emergencyRelation: pick(row, ["与本人关系", "关系", "emergencyRelation"]),
        internshipStartDate: internship.start,
        internshipEndDate: internship.end,
        companyEmail: pick(row, ["企业邮箱", "邮箱", "email", "companyEmail"]),
      });

      try {
        const existed = db
          .prepare("SELECT id FROM hr_profiles WHERE personnel_id = ?")
          .get(person.id) as { id: string } | undefined;
        if (existed) {
          updateStmt.run(...hrFieldValues(fields), person.id);
        } else {
          insertStmt.run(generateId("hr"), person.id, ...hrFieldValues(fields));
        }

        let personnelStatus = person.status || status;
        let nextResign: string | null | undefined = resignDate;
        let touchResign = resignDate !== undefined ? 1 : 0;

        if (forceStatus === "active") {
          personnelStatus = "active";
          nextResign = "";
          touchResign = 1;
        } else if (forceStatus === "inactive") {
          personnelStatus = "inactive";
          if (resignDate !== undefined) {
            nextResign = resignDate;
            touchResign = 1;
          }
        } else if (statusRaw.includes("离")) {
          personnelStatus = "inactive";
        } else if (statusRaw.includes("在") || statusRaw.includes("职")) {
          personnelStatus = "active";
        } else if (resignDate) {
          personnelStatus = "inactive";
        } else if (statusRaw) {
          personnelStatus = status;
        }

        const personPosition = text(pick(row, ["职位", "岗位", "position"]));
        db.prepare(`
          UPDATE personnel SET
            hire_date = COALESCE(NULLIF(?, ''), hire_date),
            resign_date = CASE WHEN ? = 1 THEN ? ELSE resign_date END,
            status = ?,
            position = CASE WHEN ? != '' THEN ? ELSE position END,
            phone = CASE WHEN ? != '' THEN ? ELSE phone END,
            email = CASE WHEN ? != '' THEN ? ELSE email END
          WHERE id = ?
        `).run(
          hireDate,
          touchResign,
          nextResign ?? null,
          personnelStatus,
          personPosition,
          personPosition,
          phone,
          phone,
          fields.companyEmail,
          fields.companyEmail,
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
