// 与前端 src/config/modules.ts 保持一致的模块权限定义

export type ModuleKey =
  | "dashboard"
  | "sales_units"
  | "personnel"
  | "sales_records"
  | "cost_management"
  | "profit_analysis"
  | "sales_battle_report"
  | "product_settlement"
  | "users";

export interface ModulePermission {
  view: boolean;
  edit: boolean;
}

export type UserPermissions = Record<ModuleKey, ModulePermission>;

const MODULE_KEYS: ModuleKey[] = [
  "dashboard",
  "sales_units",
  "personnel",
  "sales_records",
  "cost_management",
  "profit_analysis",
  "sales_battle_report",
  "product_settlement",
  "users",
];

const EDITABLE = new Set<ModuleKey>([
  "sales_units",
  "personnel",
  "sales_records",
  "cost_management",
  "profit_analysis",
  "sales_battle_report",
  "product_settlement",
  "users",
]);

export function createEmptyPermissions(): UserPermissions {
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = { view: false, edit: false };
    return acc;
  }, {} as UserPermissions);
}

export function createFullPermissions(): UserPermissions {
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = { view: true, edit: EDITABLE.has(key) };
    return acc;
  }, {} as UserPermissions);
}

export function permissionsFromLegacyRole(role: string): UserPermissions {
  const empty = createEmptyPermissions();
  const viewAll = () => {
    MODULE_KEYS.forEach((key) => {
      if (key !== "users") empty[key] = { view: true, edit: false };
    });
  };

  switch (role) {
    case "superadmin":
      return createFullPermissions();
    case "group_admin":
      MODULE_KEYS.forEach((key) => {
        empty[key] = key === "users"
          ? { view: false, edit: false }
          : { view: true, edit: EDITABLE.has(key) };
      });
      return empty;
    case "military_cadre":
      viewAll();
      return empty;
    case "org_department":
      viewAll();
      empty.personnel = { view: true, edit: true };
      empty.cost_management = { view: true, edit: true };
      return empty;
    case "unit_leader":
    case "unit_manager":
      MODULE_KEYS.forEach((key) => {
        if (key === "users") empty[key] = { view: false, edit: false };
        else if (key === "product_settlement") {
          empty[key] = { view: true, edit: false };
        } else {
          empty[key] = { view: true, edit: EDITABLE.has(key) };
        }
      });
      return empty;
    default:
      viewAll();
      return empty;
  }
}

export function normalizePermissions(
  raw: (Partial<UserPermissions> & { products?: ModulePermission }) | null | undefined,
  role?: string
): UserPermissions {
  if (role === "superadmin") return createFullPermissions();
  const base = permissionsFromLegacyRole(role || "user");
  if (!raw || typeof raw !== "object") return base;
  const result = createEmptyPermissions();
  for (const key of MODULE_KEYS) {
    const item = raw[key];
    if (item) {
      const edit = EDITABLE.has(key) ? Boolean(item.edit) : false;
      const view = Boolean(item.view || edit);
      result[key] = { view, edit };
    } else {
      result[key] = base[key];
    }
  }
  // 兼容旧「产品管理」权限 → 合并进产品结算设置
  const legacyProducts = raw.products;
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

export function hasModuleEdit(
  perms: UserPermissions | undefined,
  key: ModuleKey,
  role?: string
): boolean {
  if (role === "superadmin") return true;
  return Boolean(perms?.[key]?.edit);
}

export function hasModuleView(
  perms: UserPermissions | undefined,
  key: ModuleKey,
  role?: string
): boolean {
  if (role === "superadmin") return true;
  return Boolean(perms?.[key]?.view || perms?.[key]?.edit);
}

/** 是否拥有任意模块的编辑权限 */
export function hasAnyEdit(perms: UserPermissions | undefined, role?: string): boolean {
  if (role === "superadmin") return true;
  if (!perms) return false;
  return MODULE_KEYS.some((key) => perms[key]?.edit);
}
