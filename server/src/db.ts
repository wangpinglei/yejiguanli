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
    db = new DatabaseSync(DB_PATH);
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

    CREATE INDEX IF NOT EXISTS idx_personnel_unit ON personnel(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_sales_unit ON sales_records(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_sales_personnel ON sales_records(personnel_id);
    CREATE INDEX IF NOT EXISTS idx_cost_unit ON cost_records(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_income_unit ON income_records(sales_unit_id);
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

export function rowToPersonnel(row: any) {
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

export function rowToSalesRecord(row: any) {
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
    personnelId: row.personnel_id || undefined,
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
