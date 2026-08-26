// 与左侧导航对应的功能模块（权限分配用）
export type ModuleKey =
  | "dashboard"
  | "sales_units"
  | "personnel"
  | "hr_management"
  | "sales_records"
  | "cost_management"
  | "finance_notice"
  | "profit_analysis"
  | "sales_battle_report"
  | "product_settlement"
  | "users";

/** 机密模块：旧角色默认不开放，仅超管在权限分配中手动勾选 */
const CONFIDENTIAL_MODULE_KEYS = new Set<ModuleKey>(["hr_management"]);

export interface ModulePermission {
  view: boolean;
  edit: boolean;
}

export type UserPermissions = Record<ModuleKey, ModulePermission>;

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  path: string;
  /** 该模块是否支持编辑（看板等只读模块仅有查看） */
  canEdit: boolean;
}

export const MODULE_DEFS: ModuleDef[] = [
  { key: "dashboard", label: "数据看板", path: "/", canEdit: false },
  { key: "sales_units", label: "销售单位", path: "/sales-units", canEdit: true },
  { key: "personnel", label: "人员管理", path: "/personnel", canEdit: true },
  { key: "hr_management", label: "人事管理", path: "/hr-management", canEdit: true },
  { key: "sales_records", label: "销售记录", path: "/sales-records", canEdit: true },
  { key: "cost_management", label: "成本与收入录入", path: "/cost-management", canEdit: true },
  { key: "finance_notice", label: "财务通知", path: "/finance-notice", canEdit: true },
  { key: "profit_analysis", label: "盈亏分析", path: "/profit-analysis", canEdit: true },
  { key: "sales_battle_report", label: "单位战报", path: "/sales-battle-report", canEdit: true },
  { key: "product_settlement", label: "业务域产品结算和分类", path: "/product-settlement", canEdit: true },
  { key: "users", label: "权限分配", path: "/users", canEdit: true },
];

export const MODULE_KEYS = MODULE_DEFS.map((m) => m.key);

export function createEmptyPermissions(): UserPermissions {
  return MODULE_DEFS.reduce((acc, m) => {
    acc[m.key] = { view: false, edit: false };
    return acc;
  }, {} as UserPermissions);
}

export function createFullPermissions(): UserPermissions {
  return MODULE_DEFS.reduce((acc, m) => {
    acc[m.key] = { view: true, edit: m.canEdit };
    return acc;
  }, {} as UserPermissions);
}

/** 旧角色 → 默认模块权限（兼容存量账号） */
export function permissionsFromLegacyRole(role: string): UserPermissions {
  const empty = createEmptyPermissions();
  const viewAll = () => {
    MODULE_DEFS.forEach((m) => {
      if (m.key === "users" || CONFIDENTIAL_MODULE_KEYS.has(m.key)) {
        empty[m.key] = { view: false, edit: false };
      } else {
        empty[m.key] = { view: true, edit: false };
      }
    });
  };

  switch (role) {
    case "superadmin":
      return createFullPermissions();
    case "group_admin":
      MODULE_DEFS.forEach((m) => {
        if (m.key === "users" || CONFIDENTIAL_MODULE_KEYS.has(m.key)) {
          empty[m.key] = { view: false, edit: false };
        } else {
          empty[m.key] = { view: true, edit: m.canEdit };
        }
      });
      return empty;
    case "military_cadre":
      viewAll();
      return empty;
    case "org_department":
      viewAll();
      empty.personnel = { view: true, edit: true };
      empty.cost_management = { view: true, edit: true };
      empty.finance_notice = { view: true, edit: true };
      return empty;
    case "unit_leader":
    case "unit_manager":
      MODULE_DEFS.forEach((m) => {
        if (m.key === "users" || CONFIDENTIAL_MODULE_KEYS.has(m.key)) {
          empty[m.key] = { view: false, edit: false };
        } else if (m.key === "product_settlement") {
          empty[m.key] = { view: true, edit: false };
        } else {
          empty[m.key] = { view: true, edit: m.canEdit };
        }
      });
      return empty;
    default:
      viewAll();
      return empty;
  }
}

export function normalizePermissions(
  raw: Partial<UserPermissions> & { products?: ModulePermission } | null | undefined,
  role?: string
): UserPermissions {
  if (role === "superadmin") return createFullPermissions();
  const base = permissionsFromLegacyRole(role || "user");
  if (!raw || typeof raw !== "object") return base;
  const result = createEmptyPermissions();
  for (const def of MODULE_DEFS) {
    const item = raw[def.key];
    if (item) {
      const view = Boolean(item.view || item.edit);
      const edit = def.canEdit ? Boolean(item.edit) : false;
      result[def.key] = { view: view || edit, edit };
    } else {
      result[def.key] = base[def.key];
    }
  }
  // 兼容旧「产品管理」权限 → 合并进产品结算设置
  const legacyProducts = (raw as { products?: ModulePermission }).products;
  if (legacyProducts) {
    result.product_settlement = {
      view: Boolean(
        result.product_settlement.view || legacyProducts.view || legacyProducts.edit
      ),
      edit: Boolean(result.product_settlement.edit || legacyProducts.edit),
    };
  }
  return result;
}

export function hasModuleView(perms: UserPermissions, key: ModuleKey, isSuperadmin?: boolean): boolean {
  if (isSuperadmin) return true;
  return Boolean(perms[key]?.view || perms[key]?.edit);
}

export function hasModuleEdit(perms: UserPermissions, key: ModuleKey, isSuperadmin?: boolean): boolean {
  if (isSuperadmin) return true;
  return Boolean(perms[key]?.edit);
}

export function pathToModuleKey(pathname: string): ModuleKey | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/products") return "product_settlement";
  const found = MODULE_DEFS.find((m) => m.path === normalized);
  return found?.key ?? null;
}
