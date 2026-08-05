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

  // 列表接口已按库中 managedUnitIds 过滤；前端以接口结果为准，避免 JWT 快照过期再滤空
  const accessibleUnitIds = useMemo(() => {
    if (!user) return [];
    if (isSuperadmin) return salesUnits.map((u) => u.id);
    return salesUnits.map((u) => u.id);
  }, [user, isSuperadmin, salesUnits]);

  const canAccessUnit = (unitId: string): boolean => {
    if (!user) return false;
    if (isSuperadmin) return true;
    return accessibleUnitIds.includes(unitId);
  };

  const visibleSalesUnits = useMemo<SalesUnit[]>(() => salesUnits, [salesUnits]);

  const visiblePersonnel = useMemo<Personnel[]>(() => personnel, [personnel]);

  const visibleSalesRecords = useMemo<SalesRecord[]>(() => salesRecords, [salesRecords]);

  const visibleCostRecords = useMemo<CostRecord[]>(() => costRecords, [costRecords]);

  const visibleIncomeRecords = useMemo<IncomeRecord[]>(() => incomeRecords, [incomeRecords]);

  const visibleRevenueSettlements = useMemo<RevenueSettlement[]>(
    () => revenueSettlements,
    [revenueSettlements]
  );

  const visibleUnitProductSettlements = useMemo<UnitProductSettlement[]>(
    () => unitProductSettlements,
    [unitProductSettlements]
  );

  const canEditUnit = canEdit("sales_units");
  const canEditPersonnel = canEdit("personnel");
  const canEditPersonnelDates = canEdit("personnel");
  const canEditSales = canEdit("sales_records");
  const canEditCost = canEdit("cost_management") || canEdit("profit_analysis");
  const canEditProduct = canEdit("product_settlement");
  const canManageUsers = canEdit("users");

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
