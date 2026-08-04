import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import path from "path";
import type { SystemUser, UserRole } from "./types";

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

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      managed_unit_ids TEXT DEFAULT '[]',
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
      unit_price REAL DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sales_records (
      id TEXT PRIMARY KEY,
      sales_unit_id TEXT NOT NULL,
      personnel_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      sale_date TEXT NOT NULL,
      remark TEXT DEFAULT '',
      FOREIGN KEY (sales_unit_id) REFERENCES sales_units(id) ON DELETE CASCADE,
      FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
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
      FOREIGN KEY (sales_unit_id) REFERENCES sales_units(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_personnel_unit ON personnel(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_sales_unit ON sales_records(sales_unit_id);
    CREATE INDEX IF NOT EXISTS idx_sales_personnel ON sales_records(personnel_id);
    CREATE INDEX IF NOT EXISTS idx_cost_unit ON cost_records(sales_unit_id);
  `);
}

function seedDefaultAdmin() {
  const count = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (count.c === 0) {
    const hashedPassword = bcrypt.hashSync("0720", 10);
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, managed_unit_ids)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("admin", "18115335268", hashedPassword, "管理员", "superadmin", "[]");
    console.log("[DB] 默认管理员账号已创建: 18115335268 / 0720");
  }
}

// ===================== 辅助函数：行 → 对象 =====================

export function rowToUser(row: any): SystemUser {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    name: row.name,
    role: row.role as UserRole,
    managedUnitIds: JSON.parse(row.managed_unit_ids || "[]"),
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
    unitPrice: row.unit_price || 0,
    unitCost: row.unit_cost || 0,
    description: row.description || "",
  };
}

export function rowToSalesRecord(row: any) {
  return {
    id: row.id,
    salesUnitId: row.sales_unit_id,
    personnelId: row.personnel_id,
    productId: row.product_id,
    quantity: row.quantity || 1,
    unitPrice: row.unit_price || 0,
    totalAmount: row.total_amount || 0,
    saleDate: row.sale_date,
    remark: row.remark || "",
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
  };
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}
