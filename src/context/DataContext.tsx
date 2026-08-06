import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type {
  SalesUnit,
  Personnel,
  Product,
  SalesRecord,
  CostRecord,
  CostChangeLog,
  AppNotification,
  MonthlyAdjustment,
  SyncedOrder,
  PerformanceTarget,
  PositionGroupLabel,
  IncomeRecord,
  RevenueSettlement,
  UnitProductSettlement,
  ProductPersonCommission,
  TeamMgmtCommissionRule,
} from "@/types";
import { useAuth } from "@/context/AuthContext";
import {
  API_BASE,
  salesUnitsApi,
  personnelApi,
  productsApi,
  salesRecordsApi,
  costRecordsApi,
  incomeRecordsApi,
  revenueSettlementsApi,
  unitProductSettlementsApi,
  productPersonCommissionsApi,
  costChangeLogsApi,
  notificationsApi,
  monthlyAdjustmentsApi,
  performanceTargetsApi,
  positionGroupLabelsApi,
  teamMgmtCommissionRulesApi,
} from "@/lib/api";
import { EMPTY_SALARY } from "@/lib/salary";

/** 旧版 localStorage key，仅用于「导入到服务器」 */
export const LEGACY_STORAGE_KEYS = {
  salesUnits: "pm5_salesUnits",
  personnel: "pm5_personnel",
  products: "pm5_products",
  salesRecords: "pm5_salesRecords",
  costRecords: "pm5_costRecords",
  incomeRecords: "pm5_incomeRecords",
  revenueSettlements: "pm5_revenueSettlements",
  unitProductSettlements: "pm5_unitProductSettlements",
  productPersonCommissions: "pm5_productPersonCommissions",
  changeLogs: "pm5_costChangeLogs",
  notifications: "pm5_notifications",
  monthlyAdjustments: "pm5_monthlyAdjustments",
  performanceTargets: "pm5_performanceTargets",
  positionGroupLabels: "pm5_positionGroupLabels",
} as const;

export function loadLegacyLocalStoragePayload(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, storageKey] of Object.entries(LEGACY_STORAGE_KEYS)) {
    try {
      const raw = localStorage.getItem(storageKey);
      out[key] = raw ? JSON.parse(raw) : [];
    } catch {
      out[key] = [];
    }
  }
  return out;
}

interface DataContextType {
  salesUnits: SalesUnit[];
  personnel: Personnel[];
  products: Product[];
  salesRecords: SalesRecord[];
  allSalesRecords: SalesRecord[];
  syncedOrders: SyncedOrder[];
  syncedLoading: boolean;
  costRecords: CostRecord[];
  incomeRecords: IncomeRecord[];
  revenueSettlements: RevenueSettlement[];
  unitProductSettlements: UnitProductSettlement[];
  productPersonCommissions: ProductPersonCommission[];
  teamMgmtCommissionRules: TeamMgmtCommissionRule[];
  costChangeLogs: CostChangeLog[];
  notifications: AppNotification[];
  monthlyAdjustments: MonthlyAdjustment[];
  loading: boolean;

  addSalesUnit: (unit: Omit<SalesUnit, "id" | "createdAt">) => Promise<void>;
  updateSalesUnit: (id: string, unit: Partial<SalesUnit>) => Promise<void>;
  deleteSalesUnit: (id: string) => Promise<void>;

  addPersonnel: (p: Omit<Personnel, "id">) => Promise<Personnel>;
  updatePersonnel: (id: string, p: Partial<Personnel>) => Promise<void>;
  deletePersonnel: (id: string) => Promise<void>;
  ensurePersonnelByName: (
    name: string,
    salesUnitId: string,
    extras?: Partial<Omit<Personnel, "id" | "name" | "salesUnitId">>
  ) => Promise<Personnel | null>;

  addProduct: (p: Omit<Product, "id">) => Promise<Product>;
  updateProduct: (id: string, p: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  ensureProductByName: (
    name: string,
    extras?: Partial<Omit<Product, "id" | "name">>
  ) => Promise<Product | null>;

  addSalesRecord: (s: Omit<SalesRecord, "id" | "totalAmount"> & { totalAmount?: number }) => Promise<void>;
  updateSalesRecord: (id: string, s: Partial<SalesRecord>) => Promise<void>;
  deleteSalesRecord: (id: string) => Promise<void>;

  addCostRecord: (
    c: Omit<CostRecord, "id" | "totalCost" | "createdAt">,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => Promise<void>;
  updateCostRecord: (
    id: string,
    c: Partial<CostRecord>,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => Promise<void>;
  deleteCostRecord: (
    id: string,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => Promise<void>;

  addIncomeRecord: (r: Omit<IncomeRecord, "id" | "totalAmount" | "createdAt">) => Promise<void>;
  updateIncomeRecord: (id: string, r: Partial<IncomeRecord>) => Promise<void>;
  deleteIncomeRecord: (id: string) => Promise<void>;

  upsertRevenueSettlement: (s: Omit<RevenueSettlement, "id" | "createdAt">) => Promise<void>;
  deleteRevenueSettlement: (id: string) => Promise<void>;

  upsertUnitProductSettlement: (s: Omit<UnitProductSettlement, "id" | "createdAt">) => Promise<void>;
  batchUpsertUnitProductSettlements: (items: Omit<UnitProductSettlement, "id" | "createdAt">[]) => Promise<void>;
  deleteUnitProductSettlement: (id: string) => Promise<void>;

  upsertProductPersonCommission: (c: Omit<ProductPersonCommission, "id" | "createdAt">) => Promise<void>;
  batchUpsertProductPersonCommissions: (
    items: Omit<ProductPersonCommission, "id" | "createdAt">[],
  ) => Promise<void>;
  deleteProductPersonCommission: (id: string) => Promise<void>;

  upsertTeamMgmtCommissionRule: (
    r: Omit<TeamMgmtCommissionRule, "id" | "createdAt">,
  ) => Promise<void>;
  deleteTeamMgmtCommissionRule: (id: string) => Promise<void>;

  upsertMonthlyAdjustment: (a: Omit<MonthlyAdjustment, "id" | "createdAt">) => Promise<void>;
  deleteMonthlyAdjustment: (id: string) => Promise<void>;

  performanceTargets: PerformanceTarget[];
  upsertPerformanceTarget: (t: Omit<PerformanceTarget, "id" | "createdAt">) => Promise<void>;
  deletePerformanceTarget: (id: string) => Promise<void>;
  batchUpsertPerformanceTargets: (targets: Omit<PerformanceTarget, "id" | "createdAt">[]) => Promise<void>;

  positionGroupLabels: PositionGroupLabel[];
  addPositionGroupLabel: (l: Omit<PositionGroupLabel, "id" | "createdAt">) => Promise<void>;
  updatePositionGroupLabel: (id: string, l: Partial<PositionGroupLabel>) => Promise<void>;
  deletePositionGroupLabel: (id: string) => Promise<void>;
  matchPositionLabel: (position: string) => PositionGroupLabel | null;

  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;

  refreshAll: () => Promise<void>;
  refreshSyncedOrders: () => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [salesUnits, setSalesUnits] = useState<SalesUnit[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([]);
  const [syncedOrders, setSyncedOrders] = useState<SyncedOrder[]>([]);
  const [syncedLoading, setSyncedLoading] = useState(false);
  const [costRecords, setCostRecords] = useState<CostRecord[]>([]);
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [revenueSettlements, setRevenueSettlements] = useState<RevenueSettlement[]>([]);
  const [unitProductSettlements, setUnitProductSettlements] = useState<UnitProductSettlement[]>([]);
  const [productPersonCommissions, setProductPersonCommissions] = useState<ProductPersonCommission[]>([]);
  const [teamMgmtCommissionRules, setTeamMgmtCommissionRules] = useState<TeamMgmtCommissionRule[]>([]);
  const [costChangeLogs, setCostChangeLogs] = useState<CostChangeLog[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [monthlyAdjustments, setMonthlyAdjustments] = useState<MonthlyAdjustment[]>([]);
  const [performanceTargets, setPerformanceTargets] = useState<PerformanceTarget[]>([]);
  const [positionGroupLabels, setPositionGroupLabels] = useState<PositionGroupLabel[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSyncedOrders = useCallback(async () => {
    setSyncedLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/synced-orders`);
      const data = await resp.json();
      setSyncedOrders(Array.isArray(data?.orders) ? data.orders : []);
    } catch {
      setSyncedOrders([]);
    } finally {
      setSyncedLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        salesUnitsApi.list(),
        personnelApi.list(),
        productsApi.list(),
        salesRecordsApi.list(),
        costRecordsApi.list(),
        incomeRecordsApi.list(),
        revenueSettlementsApi.list(),
        unitProductSettlementsApi.list(),
        productPersonCommissionsApi.list(),
        costChangeLogsApi.list(),
        notificationsApi.list(),
        monthlyAdjustmentsApi.list(),
        performanceTargetsApi.list(),
        positionGroupLabelsApi.list(),
        teamMgmtCommissionRulesApi.list(),
      ]);

      function value<T>(i: number, fallback: T): T {
        const r = results[i];
        if (r.status === "fulfilled") return r.value as T;
        console.error("[DataContext] refresh item failed", i, r.reason);
        return fallback;
      }

      setSalesUnits(value(0, []));
      setPersonnel(value(1, []));
      setProducts(value(2, []));
      setSalesRecords(value(3, []));
      setCostRecords(value(4, []));
      setIncomeRecords(value(5, []));
      setRevenueSettlements(value(6, []));
      setUnitProductSettlements(value(7, []));
      setProductPersonCommissions(value(8, []));
      setCostChangeLogs(value(9, []));
      setNotifications(value(10, []));
      setMonthlyAdjustments(value(11, []));
      setPerformanceTargets(value(12, []));
      const labels = value(13, [] as PositionGroupLabel[]);
      setPositionGroupLabels(labels.length ? labels : []);
      setTeamMgmtCommissionRules(value(14, []));
      await refreshSyncedOrders();
    } catch (e) {
      console.error("[DataContext] refreshAll failed", e);
    } finally {
      setLoading(false);
    }
  }, [refreshSyncedOrders]);

  const managedUnitKey = (user?.managedUnitIds || []).join(",");

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setSalesUnits([]);
      setPersonnel([]);
      setProducts([]);
      setSalesRecords([]);
      setSyncedOrders([]);
      setCostRecords([]);
      setIncomeRecords([]);
      setRevenueSettlements([]);
      setUnitProductSettlements([]);
      setProductPersonCommissions([]);
      setCostChangeLogs([]);
      setNotifications([]);
      setMonthlyAdjustments([]);
      setPerformanceTargets([]);
      setPositionGroupLabels([]);
      setTeamMgmtCommissionRules([]);
      setLoading(false);
      return;
    }

    // 登录成功、会话恢复、或可见单位变更后重新拉业务数据
    void refreshAll();
  }, [authLoading, user, managedUnitKey, refreshAll]);

  const allSalesRecords = useMemo(() => {
    const syncedAsSales: SalesRecord[] = syncedOrders.map((o) => ({
      id: o.id,
      salesUnitId: o.salesUnitId,
      personnelId: o.personnelId,
      productId: o.productId,
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      totalAmount: o.totalAmount,
      saleDate: o.saleDate,
      remark: o.remark,
      synced: true,
      externalOrderId: o.externalOrderId,
      customerName: o.customerName,
      salesUnitName: o.salesUnitName,
      salesPersonName: o.salesPersonName,
      productName: o.productName,
      syncedAt: o.syncedAt,
    }));
    return [...salesRecords, ...syncedAsSales];
  }, [salesRecords, syncedOrders]);

  // -------- SalesUnit --------
  const addSalesUnit = useCallback(async (unit: Omit<SalesUnit, "id" | "createdAt">) => {
    const created = await salesUnitsApi.create(unit);
    setSalesUnits((prev) => [...prev, created]);
  }, []);
  const updateSalesUnit = useCallback(async (id: string, unit: Partial<SalesUnit>) => {
    const updated = await salesUnitsApi.update(id, unit);
    setSalesUnits((prev) => prev.map((u) => (u.id === id ? updated : u)));
  }, []);
  const deleteSalesUnit = useCallback(async (id: string) => {
    await salesUnitsApi.delete(id);
    setSalesUnits((prev) => prev.filter((u) => u.id !== id));
  }, []);

  // -------- Personnel --------
  const addPersonnel = useCallback(async (p: Omit<Personnel, "id">) => {
    const created = await personnelApi.create(p);
    setPersonnel((prev) => [...prev, created]);
    return created;
  }, []);
  const updatePersonnel = useCallback(async (id: string, p: Partial<Personnel>) => {
    const updated = await personnelApi.update(id, p);
    setPersonnel((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }, []);
  const deletePersonnel = useCallback(async (id: string) => {
    await personnelApi.delete(id);
    setPersonnel((prev) => prev.filter((x) => x.id !== id));
  }, []);
  /** 按姓名+单位确保人员存在；不存在则自动创建（用于销售导入） */
  const ensurePersonnelByName = useCallback(
    async (
      name: string,
      salesUnitId: string,
      extras?: Partial<Omit<Personnel, "id" | "name" | "salesUnitId">>,
    ) => {
      const trimmed = (name || "").trim();
      const unitId = (salesUnitId || "").trim();
      if (!trimmed || !unitId) return null;

      const existing = personnel.find(
        (p) =>
          p.salesUnitId === unitId
          && (p.name || "").trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) return existing;

      const created = await personnelApi.create({
        name: trimmed,
        salesUnitId: unitId,
        position: extras?.position ?? "销售",
        phone: extras?.phone ?? "",
        email: extras?.email ?? "",
        salary: extras?.salary ?? { ...EMPTY_SALARY },
        socialInsurance: extras?.socialInsurance ?? 0,
        housingFund: extras?.housingFund ?? 0,
        hireDate: extras?.hireDate ?? "",
        resignDate: extras?.resignDate,
        status: extras?.status ?? "active",
      });
      setPersonnel((prev) => {
        if (prev.some((p) => p.id === created.id)) return prev;
        const dup = prev.find(
          (p) =>
            p.salesUnitId === unitId
            && (p.name || "").trim().toLowerCase() === trimmed.toLowerCase(),
        );
        if (dup) return prev;
        return [...prev, created];
      });
      return created;
    },
    [personnel],
  );

  // -------- Product --------
  const addProduct = useCallback(async (p: Omit<Product, "id">) => {
    const created = await productsApi.create(p);
    setProducts((prev) => [...prev, created]);
    return created;
  }, []);
  const updateProduct = useCallback(async (id: string, p: Partial<Product>) => {
    const updated = await productsApi.update(id, p);
    setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }, []);
  const deleteProduct = useCallback(async (id: string) => {
    await productsApi.delete(id);
    setProducts((prev) => prev.filter((x) => x.id !== id));
  }, []);
  const ensureProductByName = useCallback(
    async (name: string, extras?: Partial<Omit<Product, "id" | "name">>) => {
      const trimmed = (name || "").trim();
      if (!trimmed) return null;
      const existing = products.find(
        (p) => (p.name || "").trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) return existing;
      const created = await productsApi.ensure({ name: trimmed, ...extras });
      setProducts((prev) => {
        if (prev.some((p) => p.id === created.id)) return prev;
        return [...prev, created];
      });
      return created;
    },
    [products]
  );

  // -------- Sales --------
  const addSalesRecord = useCallback(async (s: Omit<SalesRecord, "id" | "totalAmount"> & { totalAmount?: number }) => {
    const totalAmount = s.totalAmount != null ? s.totalAmount : (s.quantity || 1) * (s.unitPrice || 0);
    const created = await salesRecordsApi.create({ ...s, totalAmount });
    setSalesRecords((prev) => [created, ...prev]);
  }, []);
  const updateSalesRecord = useCallback(async (id: string, s: Partial<SalesRecord>) => {
    const updated = await salesRecordsApi.update(id, s);
    setSalesRecords((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }, []);
  const deleteSalesRecord = useCallback(async (id: string) => {
    await salesRecordsApi.delete(id);
    setSalesRecords((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // -------- Cost --------
  const addCostRecord = useCallback(async (
    c: Omit<CostRecord, "id" | "totalCost" | "createdAt">,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => {
    const created = await costRecordsApi.create({ ...c, changeReason });
    setCostRecords((prev) => [created, ...prev]);
    if (changeReason) {
      const log = await costChangeLogsApi.create({
        costRecordId: created.id,
        action: "create",
        reason: changeReason,
        operator: operator?.name || "",
        operatorId: operator?.id || "",
        summary: `新增成本 ${created.totalCost}`,
        costRecordRemark: created.remark,
      });
      setCostChangeLogs((prev) => [log, ...prev]);
      const notif = await notificationsApi.create({
        type: "cost_change",
        title: "成本变更",
        message: `${operator?.name || "用户"} 新增了成本记录`,
      });
      setNotifications((prev) => [notif, ...prev]);
    }
  }, []);

  const updateCostRecord = useCallback(async (
    id: string,
    c: Partial<CostRecord>,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => {
    const updated = await costRecordsApi.update(id, { ...c, changeReason });
    setCostRecords((prev) => prev.map((x) => (x.id === id ? updated : x)));
    if (changeReason) {
      const log = await costChangeLogsApi.create({
        costRecordId: id,
        action: "update",
        reason: changeReason,
        operator: operator?.name || "",
        operatorId: operator?.id || "",
        summary: `更新成本`,
        costRecordRemark: updated.remark,
      });
      setCostChangeLogs((prev) => [log, ...prev]);
    }
  }, []);

  const deleteCostRecord = useCallback(async (
    id: string,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => {
    const target = costRecords.find((x) => x.id === id);
    await costRecordsApi.delete(id);
    setCostRecords((prev) => prev.filter((x) => x.id !== id));
    if (changeReason) {
      const log = await costChangeLogsApi.create({
        costRecordId: id,
        action: "delete",
        reason: changeReason,
        operator: operator?.name || "",
        operatorId: operator?.id || "",
        summary: `删除成本`,
        costRecordRemark: target?.remark,
      });
      setCostChangeLogs((prev) => [log, ...prev]);
    }
  }, [costRecords]);

  // -------- Income --------
  const addIncomeRecord = useCallback(async (r: Omit<IncomeRecord, "id" | "totalAmount" | "createdAt">) => {
    const created = await incomeRecordsApi.create(r);
    setIncomeRecords((prev) => [created, ...prev]);
  }, []);
  const updateIncomeRecord = useCallback(async (id: string, r: Partial<IncomeRecord>) => {
    const updated = await incomeRecordsApi.update(id, r);
    setIncomeRecords((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }, []);
  const deleteIncomeRecord = useCallback(async (id: string) => {
    await incomeRecordsApi.delete(id);
    setIncomeRecords((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // -------- Revenue / Settlement / Commission --------
  const upsertRevenueSettlement = useCallback(async (s: Omit<RevenueSettlement, "id" | "createdAt">) => {
    const saved = await revenueSettlementsApi.upsert(s);
    setRevenueSettlements((prev) => {
      const idx = prev.findIndex((x) => x.salesUnitId === saved.salesUnitId && x.yearMonth === saved.yearMonth);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  }, []);
  const deleteRevenueSettlement = useCallback(async (id: string) => {
    await revenueSettlementsApi.delete(id);
    setRevenueSettlements((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const upsertUnitProductSettlement = useCallback(async (s: Omit<UnitProductSettlement, "id" | "createdAt">) => {
    const saved = await unitProductSettlementsApi.upsert(s);
    setUnitProductSettlements((prev) => {
      const idx = prev.findIndex((x) => x.salesUnitId === saved.salesUnitId && x.productId === saved.productId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  }, []);
  const batchUpsertUnitProductSettlements = useCallback(async (
    items: Omit<UnitProductSettlement, "id" | "createdAt">[],
  ) => {
    await unitProductSettlementsApi.batch(items);
    setUnitProductSettlements(await unitProductSettlementsApi.list());
  }, []);
  const deleteUnitProductSettlement = useCallback(async (id: string) => {
    await unitProductSettlementsApi.delete(id);
    setUnitProductSettlements((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const upsertProductPersonCommission = useCallback(async (c: Omit<ProductPersonCommission, "id" | "createdAt">) => {
    const saved = await productPersonCommissionsApi.upsert(c);
    setProductPersonCommissions((prev) => {
      const idx = prev.findIndex(
        (x) => x.salesUnitId === saved.salesUnitId && x.productId === saved.productId && x.personnelId === saved.personnelId
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  }, []);
  const batchUpsertProductPersonCommissions = useCallback(async (
    items: Omit<ProductPersonCommission, "id" | "createdAt">[],
  ) => {
    await productPersonCommissionsApi.batch(items);
    setProductPersonCommissions(await productPersonCommissionsApi.list());
  }, []);
  const deleteProductPersonCommission = useCallback(async (id: string) => {
    await productPersonCommissionsApi.delete(id);
    setProductPersonCommissions((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const upsertTeamMgmtCommissionRule = useCallback(async (
    r: Omit<TeamMgmtCommissionRule, "id" | "createdAt">,
  ) => {
    const saved = await teamMgmtCommissionRulesApi.upsert(r);
    setTeamMgmtCommissionRules((prev) => {
      const idx = prev.findIndex((x) => x.salesUnitId === saved.salesUnitId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  }, []);
  const deleteTeamMgmtCommissionRule = useCallback(async (id: string) => {
    await teamMgmtCommissionRulesApi.delete(id);
    setTeamMgmtCommissionRules((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // -------- Monthly / Targets / Labels --------
  const upsertMonthlyAdjustment = useCallback(async (a: Omit<MonthlyAdjustment, "id" | "createdAt">) => {
    const saved = await monthlyAdjustmentsApi.upsert(a);
    setMonthlyAdjustments((prev) => {
      const idx = prev.findIndex((x) => x.personnelId === saved.personnelId && x.yearMonth === saved.yearMonth);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  }, []);
  const deleteMonthlyAdjustment = useCallback(async (id: string) => {
    await monthlyAdjustmentsApi.delete(id);
    setMonthlyAdjustments((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const upsertPerformanceTarget = useCallback(async (t: Omit<PerformanceTarget, "id" | "createdAt">) => {
    const saved = await performanceTargetsApi.upsert(t);
    setPerformanceTargets((prev) => {
      const idx = prev.findIndex(
        (x) => x.salesUnitId === saved.salesUnitId && x.yearMonth === saved.yearMonth
          && (x.personnelId || "") === (saved.personnelId || "")
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  }, []);
  const deletePerformanceTarget = useCallback(async (id: string) => {
    await performanceTargetsApi.delete(id);
    setPerformanceTargets((prev) => prev.filter((x) => x.id !== id));
  }, []);
  const batchUpsertPerformanceTargets = useCallback(async (targets: Omit<PerformanceTarget, "id" | "createdAt">[]) => {
    await performanceTargetsApi.batch(targets);
    setPerformanceTargets(await performanceTargetsApi.list());
  }, []);

  const addPositionGroupLabel = useCallback(async (l: Omit<PositionGroupLabel, "id" | "createdAt">) => {
    const created = await positionGroupLabelsApi.create(l);
    setPositionGroupLabels((prev) => [...prev, created]);
  }, []);
  const updatePositionGroupLabel = useCallback(async (id: string, l: Partial<PositionGroupLabel>) => {
    const updated = await positionGroupLabelsApi.update(id, l);
    setPositionGroupLabels((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }, []);
  const deletePositionGroupLabel = useCallback(async (id: string) => {
    await positionGroupLabelsApi.delete(id);
    setPositionGroupLabels((prev) => prev.filter((x) => x.id !== id));
  }, []);
  const matchPositionLabel = useCallback((position: string) => {
    const pos = (position || "").toLowerCase();
    return positionGroupLabels.find((l) => pos.includes((l.keyword || "").toLowerCase())) || null;
  }, [positionGroupLabels]);

  const markNotificationRead = useCallback((id: string) => {
    notificationsApi.markRead(id).then((n) => {
      setNotifications((prev) => prev.map((x) => (x.id === id ? n : x)));
    }).catch(() => {
      setNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)));
    });
  }, []);
  const markAllNotificationsRead = useCallback(() => {
    notificationsApi.markAllRead().then(() => {
      setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    }).catch(() => {
      setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    });
  }, []);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const value: DataContextType = {
    salesUnits, personnel, products, salesRecords, allSalesRecords, syncedOrders, syncedLoading,
    costRecords, incomeRecords, revenueSettlements, unitProductSettlements, productPersonCommissions,
    teamMgmtCommissionRules,
    costChangeLogs, notifications, monthlyAdjustments, loading,
    addSalesUnit, updateSalesUnit, deleteSalesUnit,
    addPersonnel, updatePersonnel, deletePersonnel, ensurePersonnelByName,
    addProduct, updateProduct, deleteProduct, ensureProductByName,
    addSalesRecord, updateSalesRecord, deleteSalesRecord,
    addCostRecord, updateCostRecord, deleteCostRecord,
    addIncomeRecord, updateIncomeRecord, deleteIncomeRecord,
    upsertRevenueSettlement, deleteRevenueSettlement,
    upsertUnitProductSettlement, batchUpsertUnitProductSettlements, deleteUnitProductSettlement,
    upsertProductPersonCommission, batchUpsertProductPersonCommissions, deleteProductPersonCommission,
    upsertTeamMgmtCommissionRule, deleteTeamMgmtCommissionRule,
    upsertMonthlyAdjustment, deleteMonthlyAdjustment,
    performanceTargets, upsertPerformanceTarget, deletePerformanceTarget, batchUpsertPerformanceTargets,
    positionGroupLabels, addPositionGroupLabel, updatePositionGroupLabel, deletePositionGroupLabel, matchPositionLabel,
    markNotificationRead, markAllNotificationsRead, unreadCount,
    refreshAll, refreshSyncedOrders,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
