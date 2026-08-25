import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import path from "path";
import type { SystemUser, UserRole } from "./types";
import { createFullPermissions, normalizePermissions } from "./permissions";

const DB_PATH = path.join(__dirname, "..", "data", "database.db");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

export function getDb(): any {
  if (!db) {
    // 超大 INTEGER（身份证/银行卡误存）默认读成 Number 会直接抛错；改为 BigInt 再在接口层转字符串
    db = new DatabaseSync(DB_PATH, { readBigInts: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema();
    seedDefaultAdmin();
  }
  return db;
}

/** node:sqlite 无 better-sqlite3 的 db.transaction，用 BEGIN/COMMIT 模拟 */
export function runInTransaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

function ensureColumns(table: string, cols: Array<{ name: string; ddl: string }>) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const names = new Set(existing.map((c) => c.name));
  for (const col of cols) {
    if (!names.has(col.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.ddl}`);
    }
  }
}

/** 人事操作人字段：表重建后可能丢失，对外暴露以便路由侧再次兜底补齐 */
export function ensureHrProfileOperatorColumns() {
  ensureColumns("hr_profiles", [
    { name: "last_operator", ddl: "last_operator TEXT DEFAULT ''" },
    { name: "last_operator_id", ddl: "last_operator_id TEXT DEFAULT ''" },
    { name: "last_operated_at", ddl: "last_operated_at TEXT DEFAULT ''" },
  ]);
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      managed_unit_ids TEXT DEFAULT '[]',
      permissions TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales_units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'company',
      address TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      description TEXT DEFAULT '',
      group_admin_id TEXT,
      military_cadre_id TEXT,
      org_dept_id TEXT,
      unit_leader_id TEXT,
      group_admin_name TEXT DEFAULT '',
      military_cadre_name TEXT DEFAULT '',
      org_dept_name TEXT DEFAULT '',
      unit_leader_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS personnel (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sales_unit_id TEXT NOT NULL,
      position TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      salary TEXT NOT NULL DEFAULT '{}',
      social_insurance REAL DEFAULT 0,
      housing_fund REAL DEFAULT 0,
      hire_date TEXT DEFAULT '',
      resign_date TEXT,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (sales_unit_id) REFERENCES sales_units(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hr_profiles (
      id TEXT PRIMARY KEY,
      personnel_id TEXT UNIQUE,
      name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      position TEXT DEFAULT '',
      hire_date TEXT DEFAULT '',
      resign_date TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      gender TEXT DEFAULT '',
      contract_start_date TEXT DEFAULT '',
      contract_end_date TEXT DEFAULT '',
      id_number TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      age INTEGER,
      ethnicity TEXT DEFAULT '',
      political_status TEXT DEFAULT '',
      education TEXT DEFAULT '',
      school TEXT DEFAULT '',
      major TEXT DEFAULT '',
      bank_account TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      address TEXT DEFAULT '',
      emergency_contact TEXT DEFAULT '',
      emergency_phone TEXT DEFAULT '',
      labor_company_id TEXT DEFAULT '',
      sales_company_id TEXT DEFAULT '',
      company_tenure TEXT DEFAULT '',
      regularization_date TEXT DEFAULT '',
      employment_type TEXT DEFAULT '',
      marital_status TEXT DEFAULT '',
      native_place TEXT DEFAULT '',
      household_register TEXT DEFAULT '',
      id_address TEXT DEFAULT '',
      graduation_date TEXT DEFAULT '',
      emergency_relation TEXT DEFAULT '',
      internship_start_date TEXT DEFAULT '',
      internship_end_date TEXT DEFAULT '',
      contract1_start_date TEXT DEFAULT '',
      contract1_end_date TEXT DEFAULT '',
      contract2_start_date TEXT DEFAULT '',
      contract2_end_date TEXT DEFAULT '',
      contract3_start_date TEXT DEFAULT '',
      contract3_end_date TEXT DEFAULT '',
      is_indefinite_contract INTEGER DEFAULT 0,
      bank_belong TEXT DEFAULT '',
      company_email TEXT DEFAULT '',
      signed_documents TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS labor_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      sales_unit_id TEXT,
      unit_price REAL DEFAULT 0,
      cost_type TEXT DEFAULT 'fixed',
      unit_cost REAL DEFAULT 0,
      cost_rate REAL DEFAULT 0,
      description TEXT DEFAULT '',
      commission_type TEXT DEFAULT 'percentage',
      commission_rate REAL DEFAULT 0,
      commission_amount REAL DEFAULT 0,
      commission_note TEXT DEFAULT '',
      settlement_type TEXT DEFAULT 'percentage',
      settlement_rate REAL DEFAULT 100,
      settlement_amount REAL DEFAULT 0,
      settlement_note TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sales_records (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL DEFAULT '',
      personnel_id TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      sale_date TEXT NOT NULL,
      remark TEXT DEFAULT '',
      synced INTEGER DEFAULT 0,
      external_order_id TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      sales_unit_name TEXT DEFAULT '',
      sales_person_name TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      synced_at TEXT,
      order_number TEXT DEFAULT '',
      product_module TEXT DEFAULT '',
      order_amount REAL DEFAULT 0,
      order_type TEXT DEFAULT '',
      activity_name TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cost_records (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      items TEXT DEFAULT '[]',
      total_cost REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      change_reason TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS income_records (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      items TEXT DEFAULT '[]',
      total_amount REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      change_reason TEXT DEFAULT '',
      is_recurring INTEGER DEFAULT 0,
      recurring_months TEXT DEFAULT '[1,2,3,4,5,6,7,8,9,10,11,12]',
      recurring_start_date TEXT DEFAULT '',
      recurring_end_date TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS revenue_settlements (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      estimated_amount REAL DEFAULT 0,
      actual_amount REAL,
      is_adjusted INTEGER DEFAULT 0,
      remark TEXT DEFAULT '',
      adjusted_by TEXT,
      adjusted_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(sales_unit_id, year_month)
    );

    CREATE TABLE IF NOT EXISTS cost_settlements (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      estimated_amount REAL DEFAULT 0,
      actual_amount REAL,
      is_adjusted INTEGER DEFAULT 0,
      remark TEXT DEFAULT '',
      adjusted_by TEXT,
      adjusted_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(sales_unit_id, year_month)
    );

    CREATE TABLE IF NOT EXISTS unit_product_settlements (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      settlement_type TEXT DEFAULT 'percentage',
      settlement_rate REAL DEFAULT 100,
      settlement_amount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(sales_unit_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS product_person_commissions (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      personnel_id TEXT NOT NULL,
      management_commission_rate REAL DEFAULT 0,
      management_commission_threshold REAL DEFAULT 0,
      management_commission_condition TEXT DEFAULT '',
      personal_commission_rate REAL DEFAULT 0,
      personal_commission_threshold REAL DEFAULT 0,
      personal_commission_condition TEXT DEFAULT '',
      personal_commission_type TEXT DEFAULT 'percentage',
      personal_commission_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(sales_unit_id, product_id, personnel_id)
    );

    CREATE TABLE IF NOT EXISTS cost_change_logs (
      id TEXT PRIMARY KEY,
      cost_record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT DEFAULT '',
      operator TEXT DEFAULT '',
      operator_id TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now')),
      summary TEXT DEFAULT '',
      cost_record_remark TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS hr_profile_logs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL DEFAULT '',
      profile_name TEXT DEFAULT '',
      action TEXT NOT NULL,
      operator TEXT DEFAULT '',
      operator_id TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'cost_change',
      title TEXT DEFAULT '',
      message TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now')),
      read INTEGER DEFAULT 0,
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS monthly_adjustments (
      id TEXT PRIMARY KEY,
      personnel_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      leave_days REAL DEFAULT 0,
      other_bonus REAL DEFAULT 0,
      other_deduction REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      UNIQUE(personnel_id, year_month)
    );

    CREATE TABLE IF NOT EXISTS performance_targets (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      personnel_id TEXT,
      target_amount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS position_group_labels (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT DEFAULT 'gray',
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_mgmt_commission_rules (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL UNIQUE,
      managers_json TEXT DEFAULT '[]',
      tiers_json TEXT DEFAULT '[]',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS personnel_unit_assignments (
      id TEXT PRIMARY KEY,
      personnel_id TEXT NOT NULL,
      sales_unit_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE,
      FOREIGN KEY (sales_unit_id) REFERENCES sales_units(id)
    );

    CREATE INDEX IF NOT EXISTS idx_personnel_unit ON personnel(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_hr_profiles_personnel ON hr_profiles(personnel_id);
    CREATE INDEX IF NOT EXISTS idx_hr_profiles_contract_end ON hr_profiles(contract_end_date);
    CREATE INDEX IF NOT EXISTS idx_hr_profile_logs_profile ON hr_profile_logs(profile_id);
    CREATE INDEX IF NOT EXISTS idx_hr_profile_logs_created ON hr_profile_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_labor_companies_name ON labor_companies(name);
    CREATE INDEX IF NOT EXISTS idx_sales_unit ON sales_records(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_sales_personnel ON sales_records(personnel_id);
    CREATE INDEX IF NOT EXISTS idx_cost_unit ON cost_records(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_income_unit ON income_records(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_pua_personnel ON personnel_unit_assignments(personnel_id);
    CREATE INDEX IF NOT EXISTS idx_pua_unit ON personnel_unit_assignments(sales_unit_id);
  `);

  ensureColumns("sales_units", [
    { name: "group_admin_name", ddl: "group_admin_name TEXT DEFAULT ''" },
    { name: "military_cadre_name", ddl: "military_cadre_name TEXT DEFAULT ''" },
    { name: "org_dept_name", ddl: "org_dept_name TEXT DEFAULT ''" },
    { name: "unit_leader_name", ddl: "unit_leader_name TEXT DEFAULT ''" },
  ]);

  ensureColumns("users", [
    { name: "permissions", ddl: "permissions TEXT DEFAULT '{}'" },
  ]);

  ensureColumns("personnel", [
    { name: "high_commission_from", ddl: "high_commission_from TEXT DEFAULT ''" },
    { name: "regular_compensation", ddl: "regular_compensation TEXT DEFAULT ''" },
  ]);

  ensureColumns("products", [
    { name: "sales_unit_id", ddl: "sales_unit_id TEXT" },
    { name: "cost_type", ddl: "cost_type TEXT DEFAULT 'fixed'" },
    { name: "cost_rate", ddl: "cost_rate REAL DEFAULT 0" },
    { name: "commission_type", ddl: "commission_type TEXT DEFAULT 'percentage'" },
    { name: "commission_rate", ddl: "commission_rate REAL DEFAULT 0" },
    { name: "commission_amount", ddl: "commission_amount REAL DEFAULT 0" },
    { name: "commission_note", ddl: "commission_note TEXT DEFAULT ''" },
    { name: "settlement_type", ddl: "settlement_type TEXT DEFAULT 'percentage'" },
    { name: "settlement_rate", ddl: "settlement_rate REAL DEFAULT 100" },
    { name: "settlement_amount", ddl: "settlement_amount REAL DEFAULT 0" },
    { name: "settlement_note", ddl: "settlement_note TEXT DEFAULT ''" },
  ]);

  ensureColumns("product_person_commissions", [
    { name: "personal_commission_type", ddl: "personal_commission_type TEXT DEFAULT 'percentage'" },
    { name: "personal_commission_amount", ddl: "personal_commission_amount REAL DEFAULT 0" },
    { name: "reward_amount", ddl: "reward_amount REAL DEFAULT 0" },
    { name: "reward_from", ddl: "reward_from TEXT DEFAULT ''" },
    { name: "reward_to", ddl: "reward_to TEXT DEFAULT ''" },
  ]);

  ensureColumns("unit_product_settlements", [
    { name: "effective_from", ddl: "effective_from TEXT DEFAULT ''" },
    { name: "effective_to", ddl: "effective_to TEXT DEFAULT ''" },
    { name: "reward_amount", ddl: "reward_amount REAL DEFAULT 0" },
    { name: "reward_from", ddl: "reward_from TEXT DEFAULT ''" },
    { name: "reward_to", ddl: "reward_to TEXT DEFAULT ''" },
    { name: "exclude_from_team_mgmt", ddl: "exclude_from_team_mgmt INTEGER DEFAULT 0" },
    { name: "exclude_from_performance", ddl: "exclude_from_performance INTEGER DEFAULT 0" },
  ]);

  ensureColumns("sales_records", [
    { name: "synced", ddl: "synced INTEGER DEFAULT 0" },
    { name: "external_order_id", ddl: "external_order_id TEXT DEFAULT ''" },
    { name: "customer_name", ddl: "customer_name TEXT DEFAULT ''" },
    { name: "sales_unit_name", ddl: "sales_unit_name TEXT DEFAULT ''" },
    { name: "sales_person_name", ddl: "sales_person_name TEXT DEFAULT ''" },
    { name: "product_name", ddl: "product_name TEXT DEFAULT ''" },
    { name: "synced_at", ddl: "synced_at TEXT" },
    { name: "order_number", ddl: "order_number TEXT DEFAULT ''" },
    { name: "product_module", ddl: "product_module TEXT DEFAULT ''" },
    { name: "order_amount", ddl: "order_amount REAL DEFAULT 0" },
    { name: "order_type", ddl: "order_type TEXT DEFAULT ''" },
    { name: "activity_name", ddl: "activity_name TEXT DEFAULT ''" },
    { name: "collaborators", ddl: "collaborators TEXT DEFAULT ''" },
  ]);

  ensureColumns("cost_records", [
    { name: "change_reason", ddl: "change_reason TEXT DEFAULT ''" },
    { name: "is_recurring", ddl: "is_recurring INTEGER DEFAULT 0" },
    {
      name: "recurring_months",
      ddl: "recurring_months TEXT DEFAULT '[1,2,3,4,5,6,7,8,9,10,11,12]'",
    },
    { name: "recurring_start_date", ddl: "recurring_start_date TEXT DEFAULT ''" },
    { name: "recurring_end_date", ddl: "recurring_end_date TEXT DEFAULT ''" },
  ]);

  ensureColumns("hr_profiles", [
    { name: "labor_company_id", ddl: "labor_company_id TEXT DEFAULT ''" },
    { name: "sales_company_id", ddl: "sales_company_id TEXT DEFAULT ''" },
    { name: "company_tenure", ddl: "company_tenure TEXT DEFAULT ''" },
    { name: "regularization_date", ddl: "regularization_date TEXT DEFAULT ''" },
    { name: "employment_type", ddl: "employment_type TEXT DEFAULT ''" },
    { name: "marital_status", ddl: "marital_status TEXT DEFAULT ''" },
    { name: "native_place", ddl: "native_place TEXT DEFAULT ''" },
    { name: "household_register", ddl: "household_register TEXT DEFAULT ''" },
    { name: "id_address", ddl: "id_address TEXT DEFAULT ''" },
    { name: "graduation_date", ddl: "graduation_date TEXT DEFAULT ''" },
    { name: "emergency_relation", ddl: "emergency_relation TEXT DEFAULT ''" },
    { name: "internship_start_date", ddl: "internship_start_date TEXT DEFAULT ''" },
    { name: "internship_end_date", ddl: "internship_end_date TEXT DEFAULT ''" },
    { name: "contract1_start_date", ddl: "contract1_start_date TEXT DEFAULT ''" },
    { name: "contract1_end_date", ddl: "contract1_end_date TEXT DEFAULT ''" },
    { name: "contract2_start_date", ddl: "contract2_start_date TEXT DEFAULT ''" },
    { name: "contract2_end_date", ddl: "contract2_end_date TEXT DEFAULT ''" },
    { name: "contract3_start_date", ddl: "contract3_start_date TEXT DEFAULT ''" },
    { name: "contract3_end_date", ddl: "contract3_end_date TEXT DEFAULT ''" },
    {
      name: "is_indefinite_contract",
      ddl: "is_indefinite_contract INTEGER DEFAULT 0",
    },
    { name: "bank_belong", ddl: "bank_belong TEXT DEFAULT ''" },
    { name: "company_email", ddl: "company_email TEXT DEFAULT ''" },
    { name: "signed_documents", ddl: "signed_documents TEXT DEFAULT '[]'" },
    { name: "name", ddl: "name TEXT DEFAULT ''" },
    { name: "phone", ddl: "phone TEXT DEFAULT ''" },
    { name: "position", ddl: "position TEXT DEFAULT ''" },
    { name: "hire_date", ddl: "hire_date TEXT DEFAULT ''" },
    { name: "resign_date", ddl: "resign_date TEXT DEFAULT ''" },
    { name: "status", ddl: "status TEXT DEFAULT 'active'" },
    { name: "last_operator", ddl: "last_operator TEXT DEFAULT ''" },
    { name: "last_operator_id", ddl: "last_operator_id TEXT DEFAULT ''" },
    { name: "last_operated_at", ddl: "last_operated_at TEXT DEFAULT ''" },
  ]);

  // 已废弃按产品确认结算，启动时清理旧表
  db.exec("DROP TABLE IF EXISTS revenue_product_settlements");

  // 尽早把身份证/银行卡等超大整数改成 TEXT，避免后续任意 SELECT * 崩溃
  normalizeHrLongNumberColumnsAsText();

  // 允许人事档案不关联人员管理（personnel_id 可空）
  migrateHrProfilesNullablePersonnel();

  // 表重建后可能丢掉操作人列，这里再补一次
  ensureHrProfileOperatorColumns();

  // 人员单位归属时间轴：存量补一段当前单位
  ensurePersonnelUnitAssignments();

  // 已废弃「单位整体业绩目标」（personnel_id 为空），仅保留个人目标
  db.prepare("DELETE FROM performance_targets WHERE personnel_id IS NULL OR TRIM(personnel_id) = ''").run();

  // 将误挂在销售单位上的 labor_company_id 迁移为独立签署公司字典
  migrateLaborCompanyIdsFromSalesUnits();
  // 迁移产生的「同名销售单位」签署公司会误导展示，清空后由人事重新维护真实签署公司
  clearSalesUnitNamedLaborCompanies();
  // 清理误当签署公司写入的「保洁/停薪留职/外聘」等非公司名
  cleanupInvalidLaborCompanyNames();
  // 清理人事导入曾自动创建的「人事挂靠」人员（人事档案一并删）；手动录入的人员管理数据保留
  cleanupHrAffiliateAutoCreated();
}

/**
 * 将人事/人员表中误存为 INTEGER/REAL 的长数字字段改回 TEXT，
 * 避免 node:sqlite 读取超大整数时抛出
 * “Value is too large to be represented as a JavaScript number”。
 */
function normalizeHrLongNumberColumnsAsText() {
  const hrCols = [
    "id_number",
    "bank_account",
    "phone",
    "emergency_phone",
  ] as const;
  for (const col of hrCols) {
    // '' || col 强制转为 TEXT，避免 node:sqlite 读取超大 INTEGER 崩溃
    db.prepare(`
      UPDATE hr_profiles
      SET ${col} = '' || ${col}
      WHERE ${col} IS NOT NULL AND typeof(${col}) != 'text'
    `).run();
  }
  db.prepare(`
    UPDATE personnel
    SET phone = '' || phone
    WHERE phone IS NOT NULL AND typeof(phone) != 'text'
  `).run();
}

/** 明显不是劳动合同签署公司的脏名字（多为用工性质/状态误写入） */
const INVALID_LABOR_COMPANY_NAMES = [
  "保洁",
  "停薪留职",
  "外聘",
  "全职",
  "兼职",
  "实习",
  "在职",
  "离职",
  "试用",
] as const;

/** 是否像日期/年月（导入时误把合同日期写进签署公司） */
function looksLikeDateLaborCompanyName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/^\d{4}[\/\-年.]\d{1,2}([\/\-月.]\d{1,2})?日?$/.test(n)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(n)) return true;
  if (/^\d{8}$/.test(n)) return true;
  return false;
}

export function isInvalidLaborCompanyName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (looksLikeDateLaborCompanyName(n)) return true;
  return INVALID_LABOR_COMPANY_NAMES.some(
    (bad) => bad.toLowerCase() === n.toLowerCase(),
  );
}

/**
 * 清除误导入到「劳动合同签署公司」字典的非公司名。
 * 若档案用工性质为空，则把该脏名回填到用工性质（日期类脏名不回填）。
 */
export function cleanupInvalidLaborCompanyNames() {
  const companies = db
    .prepare("SELECT id, name FROM labor_companies")
    .all() as Array<{ id: string; name: string }>;
  const junk = companies.filter((c) => isInvalidLaborCompanyName(c.name));
  if (junk.length === 0) return;

  const profilesByLabor = db.prepare(`
    SELECT id, employment_type FROM hr_profiles WHERE labor_company_id = ?
  `);
  const clearOnly = db.prepare(`
    UPDATE hr_profiles SET
      labor_company_id = '',
      updated_at = datetime('now')
    WHERE id = ?
  `);
  const fixProfile = db.prepare(`
    UPDATE hr_profiles SET
      labor_company_id = '',
      employment_type = CASE
        WHEN IFNULL(TRIM(employment_type), '') = '' THEN ?
        ELSE employment_type
      END,
      updated_at = datetime('now')
    WHERE id = ?
  `);
  const deleteLabor = db.prepare("DELETE FROM labor_companies WHERE id = ?");

  for (const company of junk) {
    const isDate = looksLikeDateLaborCompanyName(company.name);
    const profiles = profilesByLabor.all(company.id) as Array<{
      id: string;
      employment_type: string;
    }>;
    for (const p of profiles) {
      if (isDate) clearOnly.run(p.id);
      else fixProfile.run(company.name, p.id);
    }
    deleteLabor.run(company.id);
  }
}

/**
 * 为尚无归属时间轴的人员补一段：start=入职日（或 1970-01-01），当前 sales_unit_id，end 为空
 */
function ensurePersonnelUnitAssignments() {
  const people = db.prepare("SELECT id, sales_unit_id, hire_date FROM personnel").all() as Array<{
    id: string;
    sales_unit_id: string;
    hire_date: string;
  }>;
  if (people.length === 0) return;

  const hasAny = db
    .prepare("SELECT 1 FROM personnel_unit_assignments LIMIT 1")
    .get();
  const countByPerson = db.prepare(`
    SELECT personnel_id, COUNT(*) AS c FROM personnel_unit_assignments GROUP BY personnel_id
  `).all() as Array<{ personnel_id: string; c: number }>;
  const hasMap = new Set(countByPerson.map((r) => r.personnel_id));

  const insert = db.prepare(`
    INSERT INTO personnel_unit_assignments (
      id, personnel_id, sales_unit_id, start_date, end_date, remark, created_at
    ) VALUES (?, ?, ?, ?, NULL, '', datetime('now'))
  `);

  for (const p of people) {
    if (hasMap.has(p.id)) continue;
    const start =
      (p.hire_date || "").trim().slice(0, 10) || "1970-01-01";
    insert.run(
      `pua_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      p.id,
      p.sales_unit_id,
      start,
    );
  }

  // 表刚创建时上面循环已覆盖；hasAny 仅用于避免无意义日志
  void hasAny;
}

/**
 * 将 hr_profiles.personnel_id 改为可空，并补齐档案侧姓名等镜像字段，
 * 以便导入时匹配不到人员管理仍可只建人事档。
 */
function migrateHrProfilesNullablePersonnel() {
  const cols = db.prepare("PRAGMA table_info(hr_profiles)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  if (cols.length === 0) return;
  const pid = cols.find((c) => c.name === "personnel_id");
  if (pid && pid.notnull === 0) return;

  db.exec(`
    CREATE TABLE hr_profiles_nullable (
      id TEXT PRIMARY KEY,
      personnel_id TEXT UNIQUE,
      name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      position TEXT DEFAULT '',
      hire_date TEXT DEFAULT '',
      resign_date TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      gender TEXT DEFAULT '',
      contract_start_date TEXT DEFAULT '',
      contract_end_date TEXT DEFAULT '',
      id_number TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      age INTEGER,
      ethnicity TEXT DEFAULT '',
      political_status TEXT DEFAULT '',
      education TEXT DEFAULT '',
      school TEXT DEFAULT '',
      major TEXT DEFAULT '',
      bank_account TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      address TEXT DEFAULT '',
      emergency_contact TEXT DEFAULT '',
      emergency_phone TEXT DEFAULT '',
      labor_company_id TEXT DEFAULT '',
      sales_company_id TEXT DEFAULT '',
      company_tenure TEXT DEFAULT '',
      regularization_date TEXT DEFAULT '',
      employment_type TEXT DEFAULT '',
      marital_status TEXT DEFAULT '',
      native_place TEXT DEFAULT '',
      household_register TEXT DEFAULT '',
      id_address TEXT DEFAULT '',
      graduation_date TEXT DEFAULT '',
      emergency_relation TEXT DEFAULT '',
      internship_start_date TEXT DEFAULT '',
      internship_end_date TEXT DEFAULT '',
      contract1_start_date TEXT DEFAULT '',
      contract1_end_date TEXT DEFAULT '',
      contract2_start_date TEXT DEFAULT '',
      contract2_end_date TEXT DEFAULT '',
      contract3_start_date TEXT DEFAULT '',
      contract3_end_date TEXT DEFAULT '',
      is_indefinite_contract INTEGER DEFAULT 0,
      bank_belong TEXT DEFAULT '',
      company_email TEXT DEFAULT '',
      signed_documents TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now')),
      last_operator TEXT DEFAULT '',
      last_operator_id TEXT DEFAULT '',
      last_operated_at TEXT DEFAULT '',
      FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE
    );
  `);

  const oldCols = new Set(cols.map((c) => c.name));
  const insertCols = [
    "id",
    "personnel_id",
    "name",
    "phone",
    "position",
    "hire_date",
    "resign_date",
    "status",
    "gender",
    "contract_start_date",
    "contract_end_date",
    "id_number",
    "birth_date",
    "age",
    "ethnicity",
    "political_status",
    "education",
    "school",
    "major",
    "bank_account",
    "bank_name",
    "address",
    "emergency_contact",
    "emergency_phone",
    "labor_company_id",
    "sales_company_id",
    "company_tenure",
    "regularization_date",
    "employment_type",
    "marital_status",
    "native_place",
    "household_register",
    "id_address",
    "graduation_date",
    "emergency_relation",
    "internship_start_date",
    "internship_end_date",
    "contract1_start_date",
    "contract1_end_date",
    "contract2_start_date",
    "contract2_end_date",
    "contract3_start_date",
    "contract3_end_date",
    "bank_belong",
    "company_email",
    "signed_documents",
    "updated_at",
    "last_operator",
    "last_operator_id",
    "last_operated_at",
  ];
  const selectExprs = insertCols.map((c) => {
    if (c === "personnel_id") {
      return "NULLIF(personnel_id, '')";
    }
    if (!oldCols.has(c)) {
      if (c === "status") return "'active'";
      if (c === "signed_documents") return "'[]'";
      if (c === "updated_at") return "datetime('now')";
      return "''";
    }
    return c;
  });

  db.exec(`
    INSERT INTO hr_profiles_nullable (${insertCols.join(", ")})
    SELECT ${selectExprs.join(", ")} FROM hr_profiles
  `);
  // 用人员管理姓名回填档案镜像（仅已关联）
  db.exec(`
    UPDATE hr_profiles_nullable
    SET
      name = COALESCE((SELECT name FROM personnel WHERE personnel.id = hr_profiles_nullable.personnel_id), name),
      phone = COALESCE((SELECT phone FROM personnel WHERE personnel.id = hr_profiles_nullable.personnel_id), phone),
      position = COALESCE((SELECT position FROM personnel WHERE personnel.id = hr_profiles_nullable.personnel_id), position),
      hire_date = COALESCE((SELECT hire_date FROM personnel WHERE personnel.id = hr_profiles_nullable.personnel_id), hire_date),
      resign_date = COALESCE((SELECT resign_date FROM personnel WHERE personnel.id = hr_profiles_nullable.personnel_id), resign_date),
      status = COALESCE((SELECT status FROM personnel WHERE personnel.id = hr_profiles_nullable.personnel_id), status)
    WHERE personnel_id IS NOT NULL
  `);
  db.exec("DROP TABLE hr_profiles");
  db.exec("ALTER TABLE hr_profiles_nullable RENAME TO hr_profiles");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hr_profiles_personnel ON hr_profiles(personnel_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hr_profiles_contract_end ON hr_profiles(contract_end_date)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hr_profiles_name ON hr_profiles(name)");
}

/**
 * 清理「人事挂靠」自动建人残留：
 * - 删除该单位下的人员（人事档案随 personnel_id 一并删）
 * - 不碰其他销售单位下手动录入的人员管理数据
 * - 最后删除空的「人事挂靠」销售单位
 */
function cleanupHrAffiliateAutoCreated() {
  const AFFILIATE_NAME = "人事挂靠";
  const unit = db
    .prepare("SELECT id FROM sales_units WHERE name = ? COLLATE NOCASE")
    .get(AFFILIATE_NAME) as { id: string } | undefined;
  if (!unit) return;

  const people = db
    .prepare("SELECT id FROM personnel WHERE sales_unit_id = ?")
    .all(unit.id) as Array<{ id: string }>;

  const delHr = db.prepare("DELETE FROM hr_profiles WHERE personnel_id = ?");
  const delPpc = db.prepare("DELETE FROM product_person_commissions WHERE personnel_id = ?");
  const delAdj = db.prepare("DELETE FROM monthly_adjustments WHERE personnel_id = ?");
  const delPerson = db.prepare("DELETE FROM personnel WHERE id = ?");

  for (const p of people) {
    delHr.run(p.id);
    try {
      delPpc.run(p.id);
    } catch {
      /* 表可能不存在于极旧库 */
    }
    try {
      delAdj.run(p.id);
    } catch {
      /* ignore */
    }
    // 销售记录保留金额，仅断开人员关联，避免误删业绩
    try {
      db.prepare(
        "UPDATE sales_records SET personnel_id = '' WHERE personnel_id = ?",
      ).run(p.id);
    } catch {
      /* ignore */
    }
    delPerson.run(p.id);
  }

  const remain = db
    .prepare("SELECT COUNT(*) AS c FROM personnel WHERE sales_unit_id = ?")
    .get(unit.id) as { c: number };
  if (!remain?.c) {
    db.prepare("DELETE FROM sales_units WHERE id = ?").run(unit.id);
  }
}

/**
 * 清除「由销售单位名称迁移」出来的签署公司，并断开档案关联。
 * 劳动合同签署公司 ≠ 销售单位，二者名称不应混用展示。
 */
function clearSalesUnitNamedLaborCompanies() {
  const migrated = db
    .prepare(
      "SELECT id FROM labor_companies WHERE remark = ? OR remark LIKE ?",
    )
    .all("由原销售单位名称迁移", "%销售单位%迁移%") as Array<{ id: string }>;

  // 仍指向 sales_units.id 的脏数据一并清空
  const dangling = db
    .prepare(`
      SELECT h.id AS profile_id, h.labor_company_id
      FROM hr_profiles h
      WHERE h.labor_company_id != ''
        AND NOT EXISTS (SELECT 1 FROM labor_companies lc WHERE lc.id = h.labor_company_id)
        AND EXISTS (SELECT 1 FROM sales_units su WHERE su.id = h.labor_company_id)
    `)
    .all() as Array<{ profile_id: string; labor_company_id: string }>;

  const clearProfile = db.prepare(
    "UPDATE hr_profiles SET labor_company_id = '' WHERE labor_company_id = ?",
  );
  const deleteLabor = db.prepare("DELETE FROM labor_companies WHERE id = ?");

  for (const row of migrated) {
    clearProfile.run(row.id);
    deleteLabor.run(row.id);
  }
  for (const row of dangling) {
    db.prepare("UPDATE hr_profiles SET labor_company_id = '' WHERE id = ?").run(
      row.profile_id,
    );
  }

  // 名称与销售单位完全一致、且无自定义备注的签署公司：视为误迁残留，清空关联并删除
  const sameName = db
    .prepare(`
      SELECT lc.id
      FROM labor_companies lc
      INNER JOIN sales_units su ON su.name = lc.name COLLATE NOCASE
      WHERE IFNULL(lc.remark, '') = '' OR lc.remark LIKE '%销售单位%'
    `)
    .all() as Array<{ id: string }>;
  for (const row of sameName) {
    clearProfile.run(row.id);
    deleteLabor.run(row.id);
  }
}

/**
 * 旧数据曾把 labor_company_id 填成销售单位 id。
 * 劳动合同签署公司 ≠ 销售单位：直接清空错误关联，不再按销售单位名生成签署公司。
 */
function migrateLaborCompanyIdsFromSalesUnits() {
  const profiles = db
    .prepare(
      "SELECT id, labor_company_id FROM hr_profiles WHERE labor_company_id IS NOT NULL AND labor_company_id != ''",
    )
    .all() as Array<{ id: string; labor_company_id: string }>;
  if (profiles.length === 0) return;

  const findUnit = db.prepare("SELECT id FROM sales_units WHERE id = ?");
  const findLaborById = db.prepare("SELECT id FROM labor_companies WHERE id = ?");
  const clearProfile = db.prepare(
    "UPDATE hr_profiles SET labor_company_id = '' WHERE id = ?",
  );

  for (const p of profiles) {
    if (findLaborById.get(p.labor_company_id)) continue;
    if (findUnit.get(p.labor_company_id)) {
      clearProfile.run(p.id);
    }
  }
}

function seedDefaultAdmin() {
  const count = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (count.c === 0) {
    const hashedPassword = bcrypt.hashSync("0720", 10);
    const perms = JSON.stringify(createFullPermissions());
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, managed_unit_ids, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("admin", "18115335268", hashedPassword, "管理员", "superadmin", "[]", perms);
    console.log("[DB] 默认管理员账号已创建: 18115335268 / 0720");
  }
}

export function rowToUser(row: any): SystemUser {
  let rawPerms: any = {};
  try {
    rawPerms = JSON.parse(row.permissions || "{}");
  } catch {
    rawPerms = {};
  }
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    name: row.name,
    role: row.role as UserRole,
    managedUnitIds: JSON.parse(row.managed_unit_ids || "[]"),
    permissions: normalizePermissions(rawPerms, row.role),
    createdAt: row.created_at,
  };
}

export function rowToSalesUnit(row: any) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address || "",
    contact: row.contact || "",
    contactPhone: row.contact_phone || "",
    description: row.description || "",
    createdAt: row.created_at,
    groupAdminId: row.group_admin_id || undefined,
    militaryCadreId: row.military_cadre_id || undefined,
    orgDeptId: row.org_dept_id || undefined,
    unitLeaderId: row.unit_leader_id || undefined,
    groupAdminName: row.group_admin_name || "",
    militaryCadreName: row.military_cadre_name || "",
    orgDeptName: row.org_dept_name || "",
    unitLeaderName: row.unit_leader_name || "",
  };
}

export function rowToPersonnelUnitAssignment(row: any) {
  return {
    id: row.id,
    personnelId: row.personnel_id,
    salesUnitId: row.sales_unit_id,
    startDate: row.start_date || "",
    endDate: row.end_date || undefined,
    remark: row.remark || "",
    createdAt: row.created_at || "",
  };
}

export function rowToPersonnel(row: any, assignments?: any[]) {
  let regularCompensation: any = undefined;
  const rawMeta = row.regular_compensation;
  if (rawMeta) {
    try {
      regularCompensation =
        typeof rawMeta === "string" ? JSON.parse(rawMeta || "null") : rawMeta;
    } catch {
      regularCompensation = undefined;
    }
  }
  return {
    id: row.id,
    name: row.name,
    salesUnitId: row.sales_unit_id,
    position: row.position || "",
    phone: row.phone || "",
    email: row.email || "",
    salary: JSON.parse(row.salary || "{}"),
    socialInsurance: row.social_insurance || 0,
    housingFund: row.housing_fund || 0,
    hireDate: row.hire_date || "",
    resignDate: row.resign_date || undefined,
    status: row.status || "active",
    highCommissionFrom: row.high_commission_from || undefined,
    regularCompensation: regularCompensation || undefined,
    unitAssignments: Array.isArray(assignments)
      ? assignments.map(rowToPersonnelUnitAssignment)
      : undefined,
  };
}

export type ContractAlert = "expired" | "due30" | "due60" | "ok" | "empty";

export interface SignedDocument {
  id: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export function parseSignedDocuments(raw: unknown): SignedDocument[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && item.id && item.fileName)
      .map((item) => ({
        id: String(item.id),
        fileName: String(item.fileName),
        storedName: String(item.storedName || item.fileName),
        mimeType: String(item.mimeType || "application/octet-stream"),
        size: Number(item.size) || 0,
        uploadedAt: String(item.uploadedAt || ""),
      }));
  } catch {
    return [];
  }
}

export function getContractAlert(endDate: string | null | undefined, today = new Date()): {
  contractAlert: ContractAlert;
  contractDaysLeft: number | null;
} {
  const raw = (endDate || "").trim();
  if (!raw) return { contractAlert: "empty", contractDaysLeft: null };
  const end = new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(end.getTime())) return { contractAlert: "empty", contractDaysLeft: null };
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysLeft = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (daysLeft < 0) return { contractAlert: "expired", contractDaysLeft: daysLeft };
  if (daysLeft <= 30) return { contractAlert: "due30", contractDaysLeft: daysLeft };
  if (daysLeft <= 60) return { contractAlert: "due60", contractDaysLeft: daysLeft };
  return { contractAlert: "ok", contractDaysLeft: daysLeft };
}

export function calcAgeFromIdOrBirth(idNumber?: string, birthDate?: string): number | null {
  let ymd = (birthDate || "").trim().slice(0, 10);
  const id = (idNumber || "").trim();
  if (!ymd && /^\d{17}[\dXx]$/.test(id)) {
    ymd = `${id.slice(6, 10)}-${id.slice(10, 12)}-${id.slice(12, 14)}`;
  }
  if (!ymd || ymd.length < 10) return null;
  const birth = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

export function rowToHrProfile(row: any) {
  const asText = (v: unknown): string => {
    if (v === undefined || v === null) return "";
    if (typeof v === "bigint") return v.toString();
    return String(v);
  };
  const idNumber = asText(row.id_number);
  const age =
    row.age != null && row.age !== ""
      ? Number(row.age)
      : calcAgeFromIdOrBirth(idNumber, row.birth_date);
  const linked = Boolean(row.personnel_id);
  const status = (row.status || "active") as "active" | "inactive";
  const isIndefiniteContract = Boolean(row.is_indefinite_contract);
  // 无固定期限 / 离职：不算合同到期提醒
  const alert =
    isIndefiniteContract || status === "inactive"
      ? { contractAlert: "ok" as ContractAlert, contractDaysLeft: null }
      : getContractAlert(row.contract_end_date);
  return {
    id: row.id,
    personnelId: row.personnel_id || "",
    gender: row.gender || "",
    contractStartDate: row.contract_start_date || "",
    contractEndDate: row.contract_end_date || "",
    idNumber,
    birthDate: row.birth_date || "",
    age: age == null || Number.isNaN(age) ? null : age,
    ethnicity: row.ethnicity || "",
    politicalStatus: row.political_status || "",
    education: row.education || "",
    school: row.school || "",
    major: row.major || "",
    bankAccount: asText(row.bank_account),
    bankName: row.bank_name || "",
    address: row.address || "",
    emergencyContact: row.emergency_contact || "",
    emergencyPhone: asText(row.emergency_phone),
    laborCompanyId: row.labor_company_id || "",
    laborCompanyName: row.labor_company_name || "",
    salesCompanyId: linked ? (row.sales_company_id || row.sales_unit_id || "") : "",
    companyTenure: row.company_tenure || "",
    regularizationDate: row.regularization_date || "",
    employmentType: row.employment_type || "",
    maritalStatus: row.marital_status || "",
    nativePlace: row.native_place || "",
    householdRegister: row.household_register || "",
    idAddress: row.id_address || "",
    graduationDate: row.graduation_date || "",
    emergencyRelation: row.emergency_relation || "",
    internshipStartDate: row.internship_start_date || "",
    internshipEndDate: row.internship_end_date || "",
    contract1StartDate: row.contract1_start_date || "",
    contract1EndDate: row.contract1_end_date || "",
    contract2StartDate: row.contract2_start_date || "",
    contract2EndDate: row.contract2_end_date || "",
    contract3StartDate: row.contract3_start_date || "",
    contract3EndDate: row.contract3_end_date || "",
    isIndefiniteContract,
    bankBelong: row.bank_belong || "",
    companyEmail: row.company_email || "",
    signedDocuments: parseSignedDocuments(row.signed_documents),
    updatedAt: row.updated_at || "",
    lastOperator: row.last_operator || "",
    lastOperatorId: row.last_operator_id || "",
    lastOperatedAt: row.last_operated_at || "",
    // 联动人员管理：未关联时用档案镜像；业绩归属单位仅在关联人员时显示
    name: row.name || "",
    salesUnitId: linked ? (row.sales_unit_id || "") : "",
    position: row.position || "",
    phone: asText(row.phone),
    hireDate: row.hire_date || "",
    resignDate: row.resign_date || undefined,
    status,
    salary: typeof row.salary === "string" ? JSON.parse(row.salary || "{}") : (row.salary || {}),
    socialInsurance: row.social_insurance || 0,
    housingFund: row.housing_fund || 0,
    ...alert,
  };
}

export function rowToProduct(row: any) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || "",
    salesUnitId: row.sales_unit_id || undefined,
    unitPrice: row.unit_price || 0,
    costType: (row.cost_type || "fixed") as "percentage" | "fixed",
    unitCost: row.unit_cost || 0,
    costRate: row.cost_rate || 0,
    description: row.description || "",
    commissionType: (row.commission_type || "percentage") as "percentage" | "fixed",
    commissionRate: row.commission_rate || 0,
    commissionAmount: row.commission_amount || 0,
    commissionNote: row.commission_note || "",
    settlementType: (row.settlement_type || "percentage") as "percentage" | "fixed",
    settlementRate: row.settlement_rate ?? 100,
    settlementAmount: row.settlement_amount || 0,
    settlementNote: row.settlement_note || "",
  };
}

function parseSalesCollaborators(row: any) {
  const raw = row.collaborators;
  if (raw == null || raw === "") {
    return { collaborators: undefined as any, shareMode: undefined as any };
  }
  let data: any = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { collaborators: undefined, shareMode: undefined };
    }
  }
  let mode: "percent" | "amount" = "percent";
  let arr: any = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.mode === "amount" || data.mode === "percent") mode = data.mode;
    arr = data.shares;
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return { collaborators: undefined, shareMode: undefined };
  }
  const collaborators = arr
    .map((item: any) => ({
      personnelId: String(item?.personnelId || "").trim(),
      salesUnitId: String(item?.salesUnitId || "").trim() || undefined,
      sharePercent: item?.sharePercent != null ? Number(item.sharePercent) : undefined,
      shareAmount: item?.shareAmount != null ? Number(item.shareAmount) : undefined,
    }))
    .filter((c: { personnelId: string }) => c.personnelId);
  return {
    collaborators: collaborators.length > 0 ? collaborators : undefined,
    shareMode: collaborators.length > 0 ? mode : undefined,
  };
}

export function rowToSalesRecord(row: any) {
  const { collaborators, shareMode } = parseSalesCollaborators(row);
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id || "",
    personnelId: row.personnel_id || "",
    productId: row.product_id || "",
    quantity: row.quantity || 1,
    unitPrice: row.unit_price || 0,
    totalAmount: row.total_amount || 0,
    saleDate: row.sale_date,
    remark: row.remark || "",
    collaborators,
    shareMode,
    synced: Boolean(row.synced),
    externalOrderId: row.external_order_id || undefined,
    customerName: row.customer_name || undefined,
    salesUnitName: row.sales_unit_name || undefined,
    salesPersonName: row.sales_person_name || undefined,
    productName: row.product_name || undefined,
    syncedAt: row.synced_at || undefined,
    orderNumber: row.order_number || undefined,
    productModule: row.product_module || undefined,
    orderAmount: row.order_amount || undefined,
    orderType: row.order_type || undefined,
    activityName: row.activity_name || undefined,
  };
}

export function rowToCostRecord(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    date: row.date,
    items: JSON.parse(row.items || "[]"),
    totalCost: row.total_cost || 0,
    remark: row.remark || "",
    createdAt: row.created_at,
    createdBy: row.created_by || undefined,
    changeReason: row.change_reason || undefined,
    isRecurring: Boolean(row.is_recurring),
    recurringMonths: JSON.parse(row.recurring_months || "[1,2,3,4,5,6,7,8,9,10,11,12]"),
    recurringStartDate: row.recurring_start_date || undefined,
    recurringEndDate: row.recurring_end_date || undefined,
  };
}

export function rowToIncomeRecord(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    date: row.date,
    items: JSON.parse(row.items || "[]"),
    totalAmount: row.total_amount || 0,
    remark: row.remark || "",
    createdAt: row.created_at,
    createdBy: row.created_by || undefined,
    changeReason: row.change_reason || undefined,
    isRecurring: Boolean(row.is_recurring),
    recurringMonths: JSON.parse(row.recurring_months || "[1,2,3,4,5,6,7,8,9,10,11,12]"),
    recurringStartDate: row.recurring_start_date || undefined,
    recurringEndDate: row.recurring_end_date || undefined,
  };
}

export function rowToRevenueSettlement(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    yearMonth: row.year_month,
    estimatedAmount: row.estimated_amount || 0,
    actualAmount: row.actual_amount ?? undefined,
    isAdjusted: Boolean(row.is_adjusted),
    remark: row.remark || undefined,
    adjustedBy: row.adjusted_by || undefined,
    adjustedAt: row.adjusted_at || undefined,
    createdAt: row.created_at,
  };
}

export function rowToCostSettlement(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    yearMonth: row.year_month,
    estimatedAmount: row.estimated_amount || 0,
    actualAmount: row.actual_amount ?? undefined,
    isAdjusted: Boolean(row.is_adjusted),
    remark: row.remark || undefined,
    adjustedBy: row.adjusted_by || undefined,
    adjustedAt: row.adjusted_at || undefined,
    createdAt: row.created_at,
  };
}

export function rowToUnitProductSettlement(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    productId: row.product_id,
    settlementType: (row.settlement_type || "percentage") as "percentage" | "fixed",
    settlementRate: row.settlement_rate ?? 100,
    settlementAmount: row.settlement_amount || 0,
    effectiveFrom: row.effective_from || "",
    effectiveTo: row.effective_to || "",
    rewardAmount: row.reward_amount || 0,
    rewardFrom: row.reward_from || "",
    rewardTo: row.reward_to || "",
    excludeFromTeamMgmt: Boolean(row.exclude_from_team_mgmt),
    excludeFromPerformance: Boolean(row.exclude_from_performance),
    note: row.note || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

function parseJsonArray(raw: any, fallback: any[] = []) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function rowToTeamMgmtCommissionRule(row: any) {
  const managers = parseJsonArray(row.managers_json).map((m: any) => ({
    personnelId: String(m.personnelId || m.personnel_id || ""),
    weight: Number(m.weight) || 0,
  })).filter((m: any) => m.personnelId);
  const tiers = parseJsonArray(row.tiers_json).map((t: any) => ({
    minCompletionPercent: Number(t.minCompletionPercent ?? t.min_completion_percent) || 0,
    commissionRatePercent: Number(t.commissionRatePercent ?? t.commission_rate_percent) || 0,
  }));
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    managers,
    tiers,
    note: row.note || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

export function rowToProductPersonCommission(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    productId: row.product_id,
    personnelId: row.personnel_id,
    managementCommissionRate: row.management_commission_rate || 0,
    managementCommissionThreshold: row.management_commission_threshold || 0,
    managementCommissionCondition: row.management_commission_condition || "",
    personalCommissionType: (row.personal_commission_type === "fixed" ? "fixed" : "percentage") as
      | "percentage"
      | "fixed",
    personalCommissionRate: row.personal_commission_rate || 0,
    personalCommissionAmount: row.personal_commission_amount || 0,
    personalCommissionThreshold: row.personal_commission_threshold || 0,
    personalCommissionCondition: row.personal_commission_condition || "",
    rewardAmount: row.reward_amount || 0,
    rewardFrom: row.reward_from || "",
    rewardTo: row.reward_to || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

export function rowToCostChangeLog(row: any) {
  return {
    id: row.id,
    costRecordId: row.cost_record_id,
    action: row.action,
    reason: row.reason || "",
    operator: row.operator || "",
    operatorId: row.operator_id || "",
    timestamp: row.timestamp,
    summary: row.summary || "",
    costRecordRemark: row.cost_record_remark || undefined,
  };
}

export function rowToNotification(row: any) {
  return {
    id: row.id,
    type: row.type || "cost_change",
    title: row.title || "",
    message: row.message || "",
    timestamp: row.timestamp,
    read: Boolean(row.read),
  };
}

export function rowToMonthlyAdjustment(row: any) {
  return {
    id: row.id,
    personnelId: row.personnel_id,
    yearMonth: row.year_month,
    leaveDays: row.leave_days || 0,
    otherBonus: row.other_bonus || 0,
    otherDeduction: row.other_deduction || 0,
    note: row.note || "",
    createdAt: row.created_at,
    createdBy: row.created_by || undefined,
  };
}

export function rowToPerformanceTarget(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    yearMonth: row.year_month,
    personnelId: row.personnel_id || "",
    targetAmount: row.target_amount || 0,
    note: row.note || "",
    createdAt: row.created_at,
    createdBy: row.created_by || undefined,
  };
}

export function rowToPositionGroupLabel(row: any) {
  return {
    id: row.id,
    keyword: row.keyword,
    label: row.label,
    color: row.color || "gray",
    description: row.description || undefined,
    createdAt: row.created_at,
  };
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export function parseJsonField(value: any, fallback: any) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
