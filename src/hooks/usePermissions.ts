import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import type {
  SalesUnit, Personnel, SalesRecord, CostRecord, IncomeRecord,
  RevenueSettlement, CostSettlement, UnitProductSettlement,
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
    incomeRecords, revenueSettlements, costSettlements, unitProductSettlements,
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

  /**
   * 可见单位：超管看全部；普通账号以权限分配勾选的 managedUnitIds 为准，
   * 再与接口返回的销售单位求交（双保险，防止漏看其他单位）。
   */
  const accessibleUnitIds = useMemo(() => {
    if (!user) return [];
    if (isSuperadmin) return salesUnits.map((u) => u.id);
    const managed = Array.isArray(user.managedUnitIds) ? user.managedUnitIds : [];
    const managedSet = new Set(managed.map(String));
    if (managedSet.size === 0) return [];
    return salesUnits.map((u) => u.id).filter((id) => managedSet.has(id));
  }, [user, isSuperadmin, salesUnits]);

  const canAccessUnit = (unitId: string): boolean => {
    if (!user) return false;
    if (isSuperadmin) return true;
    return accessibleUnitIds.includes(unitId);
  };

  const visibleSalesUnits = useMemo<SalesUnit[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return salesUnits;
    const idSet = new Set(accessibleUnitIds);
    return salesUnits.filter((u) => idSet.has(u.id));
  }, [user, isSuperadmin, salesUnits, accessibleUnitIds]);

  const visiblePersonnel = useMemo<Personnel[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return personnel;
    const idSet = new Set(accessibleUnitIds);
    if (idSet.size === 0) return [];
    return personnel.filter((p) => idSet.has(p.salesUnitId));
  }, [user, isSuperadmin, personnel, accessibleUnitIds]);

  const visibleSalesRecords = useMemo<SalesRecord[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return salesRecords;
    const idSet = new Set(accessibleUnitIds);
    if (idSet.size === 0) return [];
    return salesRecords.filter((record) => {
      if (record.salesUnitId && idSet.has(record.salesUnitId)) return true;
      return (record.collaborators || []).some(
        (item) => Boolean(item.salesUnitId && idSet.has(item.salesUnitId)),
      );
    });
  }, [user, isSuperadmin, salesRecords, accessibleUnitIds]);

  const visibleCostRecords = useMemo<CostRecord[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return costRecords;
    const idSet = new Set(accessibleUnitIds);
    if (idSet.size === 0) return [];
    return costRecords.filter((r) => idSet.has(r.salesUnitId));
  }, [user, isSuperadmin, costRecords, accessibleUnitIds]);

  const visibleIncomeRecords = useMemo<IncomeRecord[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return incomeRecords;
    const idSet = new Set(accessibleUnitIds);
    if (idSet.size === 0) return [];
    return incomeRecords.filter((r) => idSet.has(r.salesUnitId));
  }, [user, isSuperadmin, incomeRecords, accessibleUnitIds]);

  const visibleRevenueSettlements = useMemo<RevenueSettlement[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return revenueSettlements;
    const idSet = new Set(accessibleUnitIds);
    if (idSet.size === 0) return [];
    return revenueSettlements.filter((r) => idSet.has(r.salesUnitId));
  }, [user, isSuperadmin, revenueSettlements, accessibleUnitIds]);

  const visibleCostSettlements = useMemo<CostSettlement[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return costSettlements;
    const idSet = new Set(accessibleUnitIds);
    if (idSet.size === 0) return [];
    return costSettlements.filter((r) => idSet.has(r.salesUnitId));
  }, [user, isSuperadmin, costSettlements, accessibleUnitIds]);

  const visibleUnitProductSettlements = useMemo<UnitProductSettlement[]>(() => {
    if (!user) return [];
    if (isSuperadmin) return unitProductSettlements;
    const idSet = new Set(accessibleUnitIds);
    if (idSet.size === 0) return [];
    return unitProductSettlements.filter((r) => idSet.has(r.salesUnitId));
  }, [user, isSuperadmin, unitProductSettlements, accessibleUnitIds]);

  const canEditUnit = canEdit("sales_units");
  const canEditPersonnel = canEdit("personnel");
  const canEditPersonnelDates = canEdit("personnel");
  const canEditHr = canEdit("hr_management");
  const canViewHr = canView("hr_management");
  const canEditSales = canEdit("sales_records");
  const canEditCost = canEdit("cost_management") || canEdit("profit_analysis");
  const canEditProduct = canEdit("product_settlement");
  const canEditBattleReport = canEdit("sales_battle_report");
  const canEditFinanceNotice = canEdit("finance_notice");
  const canManageUsers = canEdit("users");

  const isReadOnly = !isSuperadmin && !(
    canEditUnit
    || canEditPersonnel
    || canEditHr
    || canEditSales
    || canEditCost
    || canEditProduct
    || canEditBattleReport
    || canEditFinanceNotice
    || canManageUsers
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
    visibleCostSettlements,
    visibleUnitProductSettlements,
    canEditUnit,
    canEditPersonnel,
    canEditPersonnelDates,
    canEditHr,
    canViewHr,
    canEditSales,
    canEditCost,
    canEditProduct,
    canEditBattleReport,
    canEditFinanceNotice,
    canManageUsers,
  };
}
