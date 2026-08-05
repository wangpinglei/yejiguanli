import type { Request, Response, NextFunction } from "express";
import type { JwtPayload, UserRole } from "./types";
import { getDb, rowToSalesUnit } from "./db";
import { hasAnyEdit, hasModuleEdit } from "./permissions";

// ===================== 角色权限中间件 =====================

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "未登录" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "权限不足" });
    }
    next();
  };
}

/** 可管理账号与模块权限（超管或拥有「权限分配」编辑权） */
export function requireUsersManage(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "未登录" });
  }
  if (
    req.user.role === "superadmin" ||
    hasModuleEdit(req.user.permissions, "users", req.user.role)
  ) {
    return next();
  }
  return res.status(403).json({ error: "权限不足" });
}

// ===================== 数据可见性辅助 =====================

export function getVisibleUnitIds(user: JwtPayload): string[] | null {
  if (user.role === "superadmin") {
    return null;
  }

  const db = getDb();
  const units = db.prepare("SELECT * FROM sales_units").all().map(rowToSalesUnit);
  const visibleIds = new Set<string>();

  user.managedUnitIds.forEach((id) => visibleIds.add(id));

  // 不依赖旧角色：凡在销售单位中被指派为管理人员即可看见该单位
  units.forEach((unit: any) => {
    if (
      unit.groupAdminId === user.id ||
      unit.militaryCadreId === user.id ||
      unit.orgDeptId === user.id ||
      unit.unitLeaderId === user.id
    ) {
      visibleIds.add(unit.id);
    }
  });

  return Array.from(visibleIds);
}

export function isReadOnly(user: JwtPayload): boolean {
  if (user.role === "superadmin") return false;
  if (user.role === "military_cadre") return true;
  return !hasAnyEdit(user.permissions, user.role);
}

export function canEditUnit(user: JwtPayload, unitId: string): boolean {
  if (user.role === "superadmin") return true;
  if (isReadOnly(user)) return false;
  if (!hasModuleEdit(user.permissions, "sales_units", user.role) &&
      !hasModuleEdit(user.permissions, "personnel", user.role) &&
      !hasModuleEdit(user.permissions, "sales_records", user.role) &&
      !hasModuleEdit(user.permissions, "cost_management", user.role)) {
    // 兼容旧角色编辑权
    if (user.role === "military_cadre") return false;
  }

  const visibleIds = getVisibleUnitIds(user);
  if (visibleIds === null) return true;
  return visibleIds.includes(unitId);
}

export function isOrgDept(role: UserRole): boolean {
  return role === "org_department";
}

export function requireEditPermission(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "未登录" });
  }
  if (isReadOnly(req.user)) {
    return res.status(403).json({ error: "当前账号为只读权限，无法编辑" });
  }
  next();
}
