import type { Request, Response, NextFunction } from "express";
import type { JwtPayload, UserRole, SalesUnit } from "./types";
import { getDb, rowToSalesUnit } from "./db";

// ===================== 角色权限中间件 =====================

// 检查用户是否拥有指定角色之一
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

// ===================== 数据可见性辅助 =====================

// 获取用户可见的销售单位 ID 列表
export function getVisibleUnitIds(user: JwtPayload): string[] | null {
  // superadmin 可见所有单位
  if (user.role === "superadmin") {
    return null; // null 表示全部可见
  }

  const db = getDb();
  const units = db.prepare("SELECT * FROM sales_units").all().map(rowToSalesUnit);

  const visibleIds = new Set<string>();

  // managedUnitIds（unit_manager 用）
  user.managedUnitIds.forEach((id) => visibleIds.add(id));

  // 根据角色字段匹配
  units.forEach((unit: any) => {
    if (
      (user.role === "group_admin" && unit.groupAdminId === user.id) ||
      (user.role === "military_cadre" && unit.militaryCadreId === user.id) ||
      (user.role === "org_department" && unit.orgDeptId === user.id) ||
      (user.role === "unit_leader" && unit.unitLeaderId === user.id)
    ) {
      visibleIds.add(unit.id);
    }
  });

  return Array.from(visibleIds);
}

// 判断用户是否只读
export function isReadOnly(role: UserRole): boolean {
  return role === "military_cadre";
}

// 判断用户是否可编辑某销售单位的数据
export function canEditUnit(user: JwtPayload, unitId: string): boolean {
  if (user.role === "superadmin") return true;
  if (isReadOnly(user.role)) return false;

  const visibleIds = getVisibleUnitIds(user);
  if (visibleIds === null) return true;
  return visibleIds.includes(unitId);
}

// 组织部特殊权限：可编辑人员入离职和成本录入
export function isOrgDept(role: UserRole): boolean {
  return role === "org_department";
}

// 编辑权限检查中间件（非只读角色可放行，具体单位检查在路由内做）
export function requireEditPermission(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "未登录" });
  }
  if (isReadOnly(req.user.role)) {
    return res.status(403).json({ error: "军工干部为只读角色，无编辑权限" });
  }
  next();
}
