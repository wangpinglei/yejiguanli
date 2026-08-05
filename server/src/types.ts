// ===================== 共享类型定义 =====================

import type { UserPermissions } from "./permissions";

export type UserRole =
  | "superadmin"
  | "user" // 按模块权限分配
  | "group_admin"
  | "military_cadre"
  | "org_department"
  | "unit_leader"
  | "unit_manager";

export interface SystemUser {
  id: string;
  username: string;
  password: string; // bcrypt hashed
  name: string;
  role: UserRole;
  managedUnitIds: string[];
  permissions: UserPermissions;
  createdAt: string;
}

// 登录后返回的用户信息（不含密码）
export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  managedUnitIds: string[];
  permissions: UserPermissions;
}

export interface SalesUnit {
  id: string;
  name: string;
  type: "company" | "department" | "team";
  address: string;
  contact: string;
  contactPhone: string;
  description: string;
  createdAt: string;
  groupAdminId?: string;
  militaryCadreId?: string;
  orgDeptId?: string;
  unitLeaderId?: string;
  groupAdminName?: string;
  militaryCadreName?: string;
  orgDeptName?: string;
  unitLeaderName?: string;
}

export interface SalaryStructure {
  baseSalary: number;
  performance: number;
  performanceCondition: string;
  positionAllowance: number;
  positionAllowanceCondition: string;
  managementCommissionRate: number;
  managementCommissionThreshold: number;
  managementCommissionCondition: string;
  personalCommissionRate: number;
  personalCommissionThreshold: number;
  personalCommissionCondition: string;
}

export interface Personnel {
  id: string;
  name: string;
  salesUnitId: string;
  position: string;
  phone: string;
  email: string;
  salary: SalaryStructure;
  socialInsurance: number;
  housingFund: number;
  hireDate: string;
  resignDate?: string;
  status: "active" | "inactive";
}

export interface Product {
  id: string;
  name: string;
  category: string;
  unitPrice: number;
  unitCost: number;
  description: string;
}

export interface SalesRecord {
  id: string;
  salesUnitId: string;
  personnelId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  saleDate: string;
  remark: string;
}

export interface CostItem {
  id: string;
  category: string;
  amount: number;
  description: string;
}

export interface CostRecord {
  id: string;
  salesUnitId: string;
  date: string;
  items: CostItem[];
  totalCost: number;
  remark: string;
  createdAt: string;
  createdBy?: string;
}

// JWT payload
export interface JwtPayload {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  managedUnitIds: string[];
  permissions: UserPermissions;
}
