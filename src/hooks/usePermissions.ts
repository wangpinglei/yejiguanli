import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import type { SalesUnit, Personnel, SalesRecord, CostRecord, IncomeRecord, RevenueSettlement, UnitProductSettlement, UserRole } from "@/types";

export function usePermissions() {
  const { user } = useAuth();
  const { salesUnits, personnel, allSalesRecords: salesRecords, costRecords, incomeRecords, revenueSettlements, unitProductSettlements } = useData();

  const role = user?.role;

  // ===================== 数据可见性 =====================
  // 当前用户可访问的销售单位 ID 列表
  const accessibleUnitIds = useMemo(() => {
    if (!user) return [];
    if (role === "superadmin") return salesUnits.map((u) => u.id);

    // 集团管理 / 军工干部 / 组织部 / 单位负责人 — 通过销售单位上的角色字段匹配
    if (role === "group_admin") {
      return salesUnits
        .filter((u) => u.groupAdminId === user.id || user.managedUnitIds.includes(u.id))
        .map((u) => u.id);
    }
    if (role === "military_cadre") {
      return salesUnits
        .filter((u) => u.militaryCadreId === user.id || user.managedUnitIds.includes(u.id))
        .map((u) => u.id);
    }
    if (role === "org_department") {
      return salesUnits
        .filter((u) => u.orgDeptId === user.id || user.managedUnitIds.includes(u.id))
        .map((u) => u.id);
    }
    if (role === "unit_leader") {
      return salesUnits
        .filter((u) => u.unitLeaderId === user.id || user.managedUnitIds.includes(u.id))
        .map((u) => u.id);
    }
    // unit_manager — 通过 managedUnitIds
    return user.managedUnitIds.filter((id) => salesUnits.some((u) => u.id === id));
  }, [user, role, salesUnits]);

  // 判断是否有权访问某个单位
  const canAccessUnit = (unitId: string): boolean => {
    if (!user) return false;
    if (role === "superadmin") return true;
    return accessibleUnitIds.includes(unitId);
  };

  // 过滤后的销售单位
  const visibleSalesUnits = useMemo<SalesUnit[]>(() => {
    return salesUnits.filter((u) => accessibleUnitIds.includes(u.id));
  }, [salesUnits, accessibleUnitIds]);

  // 过滤后的人员
  const visiblePersonnel = useMemo<Personnel[]>(() => {
    return personnel.filter((p) => accessibleUnitIds.includes(p.salesUnitId));
  }, [personnel, accessibleUnitIds]);

  // 过滤后的销售记录（含同步订单）
  const visibleSalesRecords = useMemo<SalesRecord[]>(() => {
    if (role === "superadmin") {
      // 超管可见全部（含未匹配单位的同步订单）
      return salesRecords;
    }
    return salesRecords.filter((s) => accessibleUnitIds.includes(s.salesUnitId));
  }, [salesRecords, accessibleUnitIds, role]);

  // 过滤后的成本记录
  const visibleCostRecords = useMemo<CostRecord[]>(() => {
    return costRecords.filter((c) => accessibleUnitIds.includes(c.salesUnitId));
  }, [costRecords, accessibleUnitIds]);

  // 过滤后的收入记录
  const visibleIncomeRecords = useMemo<IncomeRecord[]>(() => {
    return incomeRecords.filter((r) => accessibleUnitIds.includes(r.salesUnitId));
  }, [incomeRecords, accessibleUnitIds]);

  // 过滤后的收入结算记录
  const visibleRevenueSettlements = useMemo<RevenueSettlement[]>(() => {
    return revenueSettlements.filter((r) => accessibleUnitIds.includes(r.salesUnitId));
  }, [revenueSettlements, accessibleUnitIds]);

  // 过滤后的单位产品结算设置
  const visibleUnitProductSettlements = useMemo<UnitProductSettlement[]>(() => {
    return unitProductSettlements.filter((s) => accessibleUnitIds.includes(s.salesUnitId));
  }, [unitProductSettlements, accessibleUnitIds]);

  // ===================== 编辑权限 =====================
  const isSuperadmin = role === "superadmin";

  // 是否可以编辑销售单位（增删改）
  const canEditUnit = isSuperadmin || role === "group_admin";

  // 是否可以编辑人员（增删改全部信息）
  const canEditPersonnel = isSuperadmin || role === "group_admin" || role === "unit_leader" || role === "unit_manager";

  // 是否可以编辑人员入离职时间（组织部 + 上述角色）
  const canEditPersonnelDates = canEditPersonnel || role === "org_department";

  // 是否可以编辑销售记录
  const canEditSales = isSuperadmin || role === "group_admin" || role === "unit_leader" || role === "unit_manager";

  // 是否可以录入/编辑成本
  const canEditCost = isSuperadmin || role === "group_admin" || role === "unit_leader" || role === "unit_manager" || role === "org_department";

  // 是否可以编辑产品
  const canEditProduct = isSuperadmin || role === "group_admin";

  // 是否只读（军工干部）
  const isReadOnly = role === "military_cadre";

  // 是否可以管理用户
  const canManageUsers = isSuperadmin;

  // 角色是否需要单位分配
  const needsUnitAssignment = (r: UserRole): boolean => {
    return r !== "superadmin";
  };

  return {
    role,
    isSuperadmin,
    isReadOnly,
    accessibleUnitIds,
    canAccessUnit,
    visibleSalesUnits,
    visiblePersonnel,
    visibleSalesRecords,
    visibleCostRecords,
    visibleIncomeRecords,
    visibleRevenueSettlements,
    visibleUnitProductSettlements,
    // 编辑权限
    canEditUnit,
    canEditPersonnel,
    canEditPersonnelDates,
    canEditSales,
    canEditCost,
    canEditProduct,
    canManageUsers,
    needsUnitAssignment,
  };
}
