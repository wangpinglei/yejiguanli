import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import type {
  SalesUnit, Personnel, SalesRecord, CostRecord, IncomeRecord,
  RevenueSettlement, UnitProductSettlement,
} from "@/types";
import {
  hasModuleEdit,
  hasModuleView,
  normalizePermissions,
  type ModuleKey,
} from "@/config/modules";

export function usePermissions() {
  const { user } = useAuth();
  const {
    salesUnits, personnel, allSalesRecords: salesRecords, costRecords,
    incomeRecords, revenueSettlements, unitProductSettlements,
  } = useData();

  const role = user?.role;
  const isSuperadmin = role === "superadmin";
  const permissions = useMemo(
    () => normalizePermissions(user?.permissions, role),
    [user?.permissions, role]
  );

  function canView(key: ModuleKey): boolean {
    return hasModuleView(permissions, key, isSuperadmin);
  }

  function canEdit(key: ModuleKey): boolean {
    return hasModuleEdit(permissions, key, isSuperadmin);
  }

  // ===================== 数据可见性 =====================
  const accessibleUnitIds = useMemo(() => {
    if (!user) return [];
    if (isSuperadmin) return salesUnits.map((u) => u.id);

    // 销售单位中指派的管理人员 + 历史 managedUnitIds
    const ids = new Set<string>(user.managedUnitIds || []);
    salesUnits.forEach((u) => {
      if (
        u.groupAdminId === user.id ||
        u.militaryCadreId === user.id ||
        u.orgDeptId === user.id ||
        u.unitLeaderId === user.id
      ) {
        ids.add(u.id);
      }
    });

    // 未配置范围时与后端一致：可看全部（由模块权限控制入口）
    if (ids.size === 0) return salesUnits.map((u) => u.id);

    return Array.from(ids).filter((id) => salesUnits.some((u) => u.id === id));
  }, [user, isSuperadmin, salesUnits]);

  const canAccessUnit = (unitId: string): boolean => {
    if (!user) return false;
    if (isSuperadmin) return true;
    return accessibleUnitIds.includes(unitId);
  };

  const visibleSalesUnits = useMemo<SalesUnit[]>(() => {
    if (isSuperadmin) return salesUnits;
    return salesUnits.filter((u) => accessibleUnitIds.includes(u.id));
  }, [salesUnits, accessibleUnitIds, isSuperadmin]);

  const visiblePersonnel = useMemo<Personnel[]>(() => {
    if (isSuperadmin) return personnel;
    return personnel.filter((p) => accessibleUnitIds.includes(p.salesUnitId));
  }, [personnel, accessibleUnitIds, isSuperadmin]);

  const visibleSalesRecords = useMemo<SalesRecord[]>(() => {
    if (isSuperadmin) return salesRecords;
    return salesRecords.filter((s) => accessibleUnitIds.includes(s.salesUnitId));
  }, [salesRecords, accessibleUnitIds, isSuperadmin]);

  const visibleCostRecords = useMemo<CostRecord[]>(() => {
    if (isSuperadmin) return costRecords;
    return costRecords.filter((c) => accessibleUnitIds.includes(c.salesUnitId));
  }, [costRecords, accessibleUnitIds, isSuperadmin]);

  const visibleIncomeRecords = useMemo<IncomeRecord[]>(() => {
    if (isSuperadmin) return incomeRecords;
    return incomeRecords.filter((r) => accessibleUnitIds.includes(r.salesUnitId));
  }, [incomeRecords, accessibleUnitIds, isSuperadmin]);

  const visibleRevenueSettlements = useMemo<RevenueSettlement[]>(() => {
    if (isSuperadmin) return revenueSettlements;
    return revenueSettlements.filter((r) => accessibleUnitIds.includes(r.salesUnitId));
  }, [revenueSettlements, accessibleUnitIds, isSuperadmin]);

  const visibleUnitProductSettlements = useMemo<UnitProductSettlement[]>(() => {
    if (isSuperadmin) return unitProductSettlements;
    return unitProductSettlements.filter((s) => accessibleUnitIds.includes(s.salesUnitId));
  }, [unitProductSettlements, accessibleUnitIds, isSuperadmin]);

  // ===================== 模块编辑权限 =====================
  const canEditUnit = canEdit("sales_units");
  const canEditPersonnel = canEdit("personnel");
  const canEditPersonnelDates = canEdit("personnel");
  const canEditSales = canEdit("sales_records");
  const canEditCost = canEdit("cost_management") || canEdit("profit_analysis");
  const canEditProduct = canEdit("product_settlement");
  const canManageUsers = canEdit("users");

  // 无任何编辑权限时视为只读
  const isReadOnly = !isSuperadmin && !(
    canEditUnit || canEditPersonnel || canEditSales || canEditCost || canEditProduct || canManageUsers
  );

  return {
    role,
    permissions,
    isSuperadmin,
    isReadOnly,
    canView,
    canEdit,
    accessibleUnitIds,
    canAccessUnit,
    visibleSalesUnits,
    visiblePersonnel,
    visibleSalesRecords,
    visibleCostRecords,
    visibleIncomeRecords,
    visibleRevenueSettlements,
    visibleUnitProductSettlements,
    canEditUnit,
    canEditPersonnel,
    canEditPersonnelDates,
    canEditSales,
    canEditCost,
    canEditProduct,
    canManageUsers,
  };
}
