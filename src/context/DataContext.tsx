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
} from "@/types";
import { API_BASE } from "@/lib/api";

// ===================== Context 定义 =====================
interface DataContextType {
  salesUnits: SalesUnit[];
  personnel: Personnel[];
  products: Product[];
  salesRecords: SalesRecord[]; // 手动录入的销售记录
  allSalesRecords: SalesRecord[]; // 手动 + 同步合并后的全部销售记录
  syncedOrders: SyncedOrder[]; // 生态圈同步的原始订单
  syncedLoading: boolean;
  costRecords: CostRecord[];
  incomeRecords: IncomeRecord[];
  revenueSettlements: RevenueSettlement[];
  unitProductSettlements: UnitProductSettlement[];
  productPersonCommissions: ProductPersonCommission[];
  costChangeLogs: CostChangeLog[];
  notifications: AppNotification[];
  monthlyAdjustments: MonthlyAdjustment[];
  loading: boolean;

  // SalesUnit CRUD
  addSalesUnit: (unit: Omit<SalesUnit, "id" | "createdAt">) => Promise<void>;
  updateSalesUnit: (id: string, unit: Partial<SalesUnit>) => Promise<void>;
  deleteSalesUnit: (id: string) => Promise<void>;

  // Personnel CRUD
  addPersonnel: (p: Omit<Personnel, "id">) => Promise<void>;
  updatePersonnel: (id: string, p: Partial<Personnel>) => Promise<void>;
  deletePersonnel: (id: string) => Promise<void>;

  // Product CRUD
  addProduct: (p: Omit<Product, "id">) => Promise<Product>;
  updateProduct: (id: string, p: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  /** 按名称确保产品存在：已有则返回，没有则自动建档 */
  ensureProductByName: (
    name: string,
    extras?: Partial<Omit<Product, "id" | "name">>
  ) => Promise<Product | null>;

  // SalesRecord CRUD
  addSalesRecord: (s: Omit<SalesRecord, "id" | "totalAmount">) => Promise<void>;
  updateSalesRecord: (id: string, s: Partial<SalesRecord>) => Promise<void>;
  deleteSalesRecord: (id: string) => Promise<void>;

  // CostRecord CRUD (with changeReason)
  addCostRecord: (c: Omit<CostRecord, "id" | "totalCost" | "createdAt">, changeReason: string, operator?: { name: string; id: string }) => Promise<void>;
  updateCostRecord: (id: string, c: Partial<CostRecord>, changeReason: string, operator?: { name: string; id: string }) => Promise<void>;
  deleteCostRecord: (id: string, changeReason: string, operator?: { name: string; id: string }) => Promise<void>;

  // IncomeRecord CRUD
  addIncomeRecord: (r: Omit<IncomeRecord, "id" | "totalAmount" | "createdAt">) => Promise<void>;
  updateIncomeRecord: (id: string, r: Partial<IncomeRecord>) => Promise<void>;
  deleteIncomeRecord: (id: string) => Promise<void>;

  // RevenueSettlement CRUD
  upsertRevenueSettlement: (s: Omit<RevenueSettlement, "id" | "createdAt">) => Promise<void>;
  deleteRevenueSettlement: (id: string) => Promise<void>;

  // UnitProductSettlement CRUD（按单位×产品结算设置）
  upsertUnitProductSettlement: (s: Omit<UnitProductSettlement, "id" | "createdAt">) => Promise<void>;
  batchUpsertUnitProductSettlements: (items: Omit<UnitProductSettlement, "id" | "createdAt">[]) => Promise<void>;
  deleteUnitProductSettlement: (id: string) => Promise<void>;

  // ProductPersonCommission CRUD（按单位×产品×人员提成设置）
  upsertProductPersonCommission: (c: Omit<ProductPersonCommission, "id" | "createdAt">) => Promise<void>;
  deleteProductPersonCommission: (id: string) => Promise<void>;

  // MonthlyAdjustment CRUD
  upsertMonthlyAdjustment: (a: Omit<MonthlyAdjustment, "id" | "createdAt">) => Promise<void>;
  deleteMonthlyAdjustment: (id: string) => Promise<void>;

  // PerformanceTarget CRUD
  performanceTargets: PerformanceTarget[];
  upsertPerformanceTarget: (t: Omit<PerformanceTarget, "id" | "createdAt">) => Promise<void>;
  deletePerformanceTarget: (id: string) => Promise<void>;
  batchUpsertPerformanceTargets: (targets: Omit<PerformanceTarget, "id" | "createdAt">[]) => Promise<void>;

  // PositionGroupLabel CRUD（战报岗位分组标签）
  positionGroupLabels: PositionGroupLabel[];
  addPositionGroupLabel: (l: Omit<PositionGroupLabel, "id" | "createdAt">) => Promise<void>;
  updatePositionGroupLabel: (id: string, l: Partial<PositionGroupLabel>) => Promise<void>;
  deletePositionGroupLabel: (id: string) => Promise<void>;
  matchPositionLabel: (position: string) => PositionGroupLabel | null;

  // Notifications
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;

  // 刷新
  refreshAll: () => Promise<void>;
  refreshSyncedOrders: () => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

// ===================== Storage 工具 =====================
const KEYS = {
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
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

function save<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function genId(prefix: string) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

// ===================== Provider =====================
export function DataProvider({ children }: { children: ReactNode }) {
  const [salesUnits, setSalesUnits] = useState<SalesUnit[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([]);
  const [costRecords, setCostRecords] = useState<CostRecord[]>([]);
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [revenueSettlements, setRevenueSettlements] = useState<RevenueSettlement[]>([]);
  const [unitProductSettlements, setUnitProductSettlements] = useState<UnitProductSettlement[]>([]);
  const [productPersonCommissions, setProductPersonCommissions] = useState<ProductPersonCommission[]>([]);
  const [costChangeLogs, setCostChangeLogs] = useState<CostChangeLog[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [monthlyAdjustments, setMonthlyAdjustments] = useState<MonthlyAdjustment[]>([]);
  const [performanceTargets, setPerformanceTargets] = useState<PerformanceTarget[]>([]);
  const [positionGroupLabels, setPositionGroupLabels] = useState<PositionGroupLabel[]>([]);
  const [syncedOrders, setSyncedOrders] = useState<SyncedOrder[]>([]);
  const [syncedLoading, setSyncedLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSalesUnits(load(KEYS.salesUnits, []));
    setPersonnel(load(KEYS.personnel, []));
    setSalesRecords(load(KEYS.salesRecords, []));
    setCostRecords(load(KEYS.costRecords, []));
    setIncomeRecords(load(KEYS.incomeRecords, []));
    setRevenueSettlements(load(KEYS.revenueSettlements, []));
    setUnitProductSettlements(load(KEYS.unitProductSettlements, []));
    setProductPersonCommissions(load(KEYS.productPersonCommissions, []));
    setCostChangeLogs(load(KEYS.changeLogs, []));
    setNotifications(load(KEYS.notifications, []));
    setMonthlyAdjustments(load(KEYS.monthlyAdjustments, []));
    setPerformanceTargets(load(KEYS.performanceTargets, []));
    // 默认规则：岗位名包含「外援」的人员显示「外援团」徽章
    const savedLabels = load(KEYS.positionGroupLabels, [] as PositionGroupLabel[]);
    if (savedLabels.length === 0) {
      const defaults: PositionGroupLabel[] = [
        {
          id: "pgl_default_external",
          keyword: "外援",
          label: "外援团",
          color: "gray",
          description: "外聘/支援人员，不参与个人业绩目标考核",
          createdAt: new Date().toISOString(),
        },
      ];
      setPositionGroupLabels(defaults);
      save(KEYS.positionGroupLabels, defaults);
    } else {
      setPositionGroupLabels(savedLabels);
    }
    // 产品不再预置默认清单：由销售订单/销售记录按名称自动录入后，再配置结算比例与提成
    // 一次性清理历史内置产品（pr_default_*），避免残留占位数据
    const savedProducts = load(KEYS.products, [] as Product[]);
    const cleanedProducts = savedProducts.filter(
      (p) => !String(p.id || "").startsWith("pr_default_")
    );
    if (cleanedProducts.length !== savedProducts.length) {
      save(KEYS.products, cleanedProducts);
      const removedIds = new Set(
        savedProducts
          .filter((p) => String(p.id || "").startsWith("pr_default_"))
          .map((p) => p.id)
      );
      const cleanedSettlements = load(KEYS.unitProductSettlements, [] as UnitProductSettlement[])
        .filter((s) => !removedIds.has(s.productId));
      save(KEYS.unitProductSettlements, cleanedSettlements);
      setUnitProductSettlements(cleanedSettlements);
      const cleanedCommissions = load(KEYS.productPersonCommissions, [] as ProductPersonCommission[])
        .filter((c) => !removedIds.has(c.productId));
      save(KEYS.productPersonCommissions, cleanedCommissions);
      setProductPersonCommissions(cleanedCommissions);
    }
    setProducts(cleanedProducts);
    setLoading(false);
  }, []);

  // ===================== 生态圈订单同步 =====================
  const refreshSyncedOrders = useCallback(async () => {
    setSyncedLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/synced-orders`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.success) {
          setSyncedOrders(data.orders || []);
        }
      }
    } catch (err) {
      // 服务器未启动或网络错误，静默处理
      console.warn("拉取同步订单失败:", err);
    } finally {
      setSyncedLoading(false);
    }
  }, []);

  // 首次加载 + 每30秒自动刷新同步订单
  useEffect(() => {
    refreshSyncedOrders();
    const timer = setInterval(refreshSyncedOrders, 30000);
    return () => clearInterval(timer);
  }, [refreshSyncedOrders]);

  // 将同步订单匹配到系统中的单位/人员/产品（按名称匹配）
  const matchedSyncedRecords = useMemo<SalesRecord[]>(() => {
    return syncedOrders.map((order) => {
      // 按名称匹配销售单位
      let matchedUnitId = order.salesUnitId;
      if (!matchedUnitId && order.salesUnitName) {
        const unit = salesUnits.find(
          (u) => u.name === order.salesUnitName || u.name.includes(order.salesUnitName) || order.salesUnitName.includes(u.name)
        );
        if (unit) matchedUnitId = unit.id;
      }

      // 按名称匹配销售人员
      let matchedPersonId = order.personnelId;
      if (!matchedPersonId && order.salesPersonName) {
        const person = personnel.find((p) => p.name === order.salesPersonName);
        if (person) matchedPersonId = person.id;
      }

      // 按名称匹配产品
      let matchedProductId = order.productId;
      if (!matchedProductId && order.productName) {
        const product = products.find(
          (p) => p.name === order.productName || p.name.includes(order.productName) || order.productName.includes(p.name)
        );
        if (product) matchedProductId = product.id;
      }

      return {
        id: order.id,
        salesUnitId: matchedUnitId || "",
        personnelId: matchedPersonId || "",
        productId: matchedProductId || "",
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        totalAmount: order.totalAmount,
        saleDate: order.saleDate,
        remark: order.remark,
        synced: true,
        externalOrderId: order.externalOrderId,
        customerName: order.customerName,
        salesUnitName: order.salesUnitName,
        salesPersonName: order.salesPersonName,
        productName: order.productName,
        syncedAt: order.syncedAt,
      } as SalesRecord;
    });
  }, [syncedOrders, salesUnits, personnel, products]);

  // 合并手动记录 + 同步记录
  const allSalesRecords = useMemo<SalesRecord[]>(() => {
    return [...salesRecords, ...matchedSyncedRecords];
  }, [salesRecords, matchedSyncedRecords]);

  // 销售订单自动录入产品：订单/记录中出现的产品名，若不存在则自动建档（售价/结算/提成默认 0，后续在产品管理配置）
  useEffect(() => {
    if (loading) return;

    const existingNames = new Set(
      products.map((p) => (p.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const pending = new Map<string, { name: string; unitPrice: number; category: string }>();

    function collectName(nameRaw?: string, unitPrice?: number, category?: string) {
      const name = (nameRaw || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (existingNames.has(key) || pending.has(key)) return;
      pending.set(key, {
        name,
        unitPrice: unitPrice && unitPrice > 0 ? unitPrice : 0,
        category: (category || "").trim(),
      });
    }

    for (const order of syncedOrders) {
      collectName(order.productName, order.unitPrice);
    }
    for (const record of salesRecords) {
      const known = record.productId
        ? products.find((p) => p.id === record.productId)
        : undefined;
      if (known) continue;
      collectName(record.productName, record.unitPrice);
    }

    if (pending.size === 0) return;

    setProducts((prev) => {
      const names = new Set(
        prev.map((p) => (p.name || "").trim().toLowerCase()).filter(Boolean)
      );
      const additions: Product[] = [];
      pending.forEach((item) => {
        const key = item.name.toLowerCase();
        if (names.has(key)) return;
        names.add(key);
        additions.push({
          id: genId("pr"),
          name: item.name,
          category: item.category,
          unitPrice: item.unitPrice,
          costType: "percentage",
          unitCost: 0,
          costRate: 0,
          description: "由销售订单自动录入",
          commissionType: "percentage",
          commissionRate: 0,
          commissionAmount: 0,
          commissionNote: "",
        });
      });
      if (additions.length === 0) return prev;
      const updated = [...prev, ...additions];
      save(KEYS.products, updated);
      return updated;
    });
  }, [loading, syncedOrders, salesRecords, products]);

  // 产品建档后，把销售记录里仅有产品名的行回填 productId，便于结算/提成匹配
  useEffect(() => {
    if (loading || products.length === 0) return;
    setSalesRecords((prev) => {
      let changed = false;
      const updated = prev.map((record) => {
        if (record.productId && products.some((p) => p.id === record.productId)) {
          return record;
        }
        const name = (record.productName || "").trim().toLowerCase();
        if (!name) return record;
        const matched = products.find(
          (p) => (p.name || "").trim().toLowerCase() === name
        );
        if (!matched || record.productId === matched.id) return record;
        changed = true;
        return { ...record, productId: matched.id, productName: matched.name };
      });
      if (!changed) return prev;
      save(KEYS.salesRecords, updated);
      return updated;
    });
  }, [loading, products]);

  // ===================== 通知 & 日志辅助 =====================
  const addChangeLog = useCallback(
    (log: Omit<CostChangeLog, "id" | "timestamp">) => {
      const fullLog: CostChangeLog = {
        ...log,
        id: genId("log"),
        timestamp: new Date().toISOString(),
      };
      setCostChangeLogs((prev) => {
        const updated = [fullLog, ...prev];
        save(KEYS.changeLogs, updated);
        return updated;
      });
      return fullLog;
    },
    []
  );

  const addNotification = useCallback(
    (title: string, message: string) => {
      const notif: AppNotification = {
        id: genId("notif"),
        type: "cost_change",
        title,
        message,
        timestamp: new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => {
        const updated = [notif, ...prev];
        save(KEYS.notifications, updated);
        return updated;
      });
    },
    []
  );

  // ===================== SalesUnit CRUD =====================
  const addSalesUnit = useCallback(async (unit: Omit<SalesUnit, "id" | "createdAt">) => {
    const newUnit: SalesUnit = { ...unit, id: genId("su"), createdAt: new Date().toISOString() };
    setSalesUnits((prev) => {
      const updated = [...prev, newUnit];
      save(KEYS.salesUnits, updated);
      return updated;
    });
  }, []);

  const updateSalesUnit = useCallback(async (id: string, unit: Partial<SalesUnit>) => {
    setSalesUnits((prev) => {
      const updated = prev.map((u) => (u.id === id ? { ...u, ...unit } : u));
      save(KEYS.salesUnits, updated);
      return updated;
    });
  }, []);

  const deleteSalesUnit = useCallback(async (id: string) => {
    setSalesUnits((prev) => {
      const updated = prev.filter((u) => u.id !== id);
      save(KEYS.salesUnits, updated);
      return updated;
    });
  }, []);

  // ===================== Personnel CRUD =====================
  const addPersonnel = useCallback(async (p: Omit<Personnel, "id">) => {
    const newP: Personnel = { ...p, id: genId("p") };
    setPersonnel((prev) => {
      const updated = [...prev, newP];
      save(KEYS.personnel, updated);
      return updated;
    });
  }, []);

  const updatePersonnel = useCallback(async (id: string, p: Partial<Personnel>) => {
    setPersonnel((prev) => {
      const updated = prev.map((x) => (x.id === id ? { ...x, ...p } : x));
      save(KEYS.personnel, updated);
      return updated;
    });
  }, []);

  const deletePersonnel = useCallback(async (id: string) => {
    setPersonnel((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.personnel, updated);
      return updated;
    });
  }, []);

  // ===================== Product CRUD =====================
  const addProduct = useCallback(async (p: Omit<Product, "id">) => {
    const newP: Product = { ...p, id: genId("pr") };
    setProducts((prev) => {
      const updated = [...prev, newP];
      save(KEYS.products, updated);
      return updated;
    });
    return newP;
  }, []);

  const updateProduct = useCallback(async (id: string, p: Partial<Product>) => {
    setProducts((prev) => {
      const updated = prev.map((x) => (x.id === id ? { ...x, ...p } : x));
      save(KEYS.products, updated);
      return updated;
    });
  }, []);

  const deleteProduct = useCallback(async (id: string) => {
    setProducts((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.products, updated);
      return updated;
    });
  }, []);

  const ensureProductByName = useCallback(
    async (name: string, extras?: Partial<Omit<Product, "id" | "name">>) => {
      const trimmed = (name || "").trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      let result: Product | null = null;

      setProducts((prev) => {
        const existing = prev.find(
          (p) => (p.name || "").trim().toLowerCase() === key
        );
        if (existing) {
          result = existing;
          return prev;
        }
        const created: Product = {
          id: genId("pr"),
          name: trimmed,
          category: extras?.category || "",
          salesUnitId: extras?.salesUnitId,
          unitPrice: extras?.unitPrice || 0,
          costType: extras?.costType || "percentage",
          unitCost: extras?.unitCost || 0,
          costRate: extras?.costRate || 0,
          description: extras?.description || "由销售订单自动录入",
          commissionType: extras?.commissionType || "percentage",
          commissionRate: extras?.commissionRate || 0,
          commissionAmount: extras?.commissionAmount || 0,
          commissionNote: extras?.commissionNote || "",
          settlementType: extras?.settlementType,
          settlementRate: extras?.settlementRate,
          settlementAmount: extras?.settlementAmount,
          settlementNote: extras?.settlementNote,
        };
        result = created;
        const updated = [...prev, created];
        save(KEYS.products, updated);
        return updated;
      });

      return result;
    },
    []
  );

  // ===================== SalesRecord CRUD =====================
  const addSalesRecord = useCallback(async (s: Omit<SalesRecord, "id" | "totalAmount">) => {
    const totalAmount = s.quantity * s.unitPrice;
    const newS: SalesRecord = { ...s, id: genId("sr"), totalAmount };
    setSalesRecords((prev) => {
      const updated = [...prev, newS];
      save(KEYS.salesRecords, updated);
      return updated;
    });
  }, []);

  const updateSalesRecord = useCallback(async (id: string, s: Partial<SalesRecord>) => {
    setSalesRecords((prev) => {
      const updated = prev.map((x) => {
        if (x.id !== id) return x;
        const merged = { ...x, ...s };
        if (s.quantity !== undefined || s.unitPrice !== undefined) {
          merged.totalAmount = merged.quantity * merged.unitPrice;
        }
        return merged;
      });
      save(KEYS.salesRecords, updated);
      return updated;
    });
  }, []);

  const deleteSalesRecord = useCallback(async (id: string) => {
    setSalesRecords((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.salesRecords, updated);
      return updated;
    });
  }, []);

  // ===================== CostRecord CRUD (with changeReason) =====================
  const addCostRecord = useCallback(async (
    c: Omit<CostRecord, "id" | "totalCost" | "createdAt">,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => {
    const totalCost = c.items.reduce((sum, item) => sum + (item.amount || 0), 0);
    const now = new Date().toISOString();
    const newRecord: CostRecord = {
      ...c,
      id: genId("cr"),
      totalCost,
      createdAt: now,
      changeReason,
    };
    setCostRecords((prev) => {
      const updated = [...prev, newRecord];
      save(KEYS.costRecords, updated);
      return updated;
    });

    // 记录变更日志
    const opName = operator?.name || c.createdBy || "系统";
    const opId = operator?.id || "system";
    addChangeLog({
      costRecordId: newRecord.id,
      action: "create",
      reason: changeReason,
      operator: opName,
      operatorId: opId,
      summary: `新增成本记录 ¥${totalCost.toFixed(2)}（${c.items.length}项）`,
      costRecordRemark: c.remark,
    });

    // 发送通知
    addNotification(
      "成本数据新增",
      `${opName} 新增成本记录 ¥${totalCost.toFixed(2)}，原因：${changeReason}`
    );
  }, [addChangeLog, addNotification]);

  const updateCostRecord = useCallback(async (
    id: string,
    c: Partial<CostRecord>,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => {
    let oldRecord: CostRecord | undefined;
    setCostRecords((prev) => {
      oldRecord = prev.find((x) => x.id === id);
      const updated = prev.map((x) => {
        if (x.id !== id) return x;
        const merged = { ...x, ...c, changeReason };
        if (c.items) {
          merged.totalCost = c.items.reduce((sum, item) => sum + (item.amount || 0), 0);
        }
        return merged;
      });
      save(KEYS.costRecords, updated);
      return updated;
    });

    if (oldRecord) {
      const opName = operator?.name || "系统";
      const opId = operator?.id || "system";
      const oldTotal = oldRecord.totalCost;
      const newTotal = c.items
        ? c.items.reduce((sum, item) => sum + (item.amount || 0), 0)
        : oldTotal;

      addChangeLog({
        costRecordId: id,
        action: "update",
        reason: changeReason,
        operator: opName,
        operatorId: opId,
        summary: `修改成本记录 ¥${oldTotal.toFixed(2)} → ¥${newTotal.toFixed(2)}`,
        costRecordRemark: c.remark || oldRecord.remark,
      });

      addNotification(
        "成本数据变更",
        `${opName} 修改成本记录：¥${oldTotal.toFixed(2)} → ¥${newTotal.toFixed(2)}，原因：${changeReason}`
      );
    }
  }, [addChangeLog, addNotification]);

  const deleteCostRecord = useCallback(async (
    id: string,
    changeReason: string,
    operator?: { name: string; id: string }
  ) => {
    let oldRecord: CostRecord | undefined;
    setCostRecords((prev) => {
      oldRecord = prev.find((x) => x.id === id);
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.costRecords, updated);
      return updated;
    });

    if (oldRecord) {
      const opName = operator?.name || "系统";
      const opId = operator?.id || "system";

      addChangeLog({
        costRecordId: id,
        action: "delete",
        reason: changeReason,
        operator: opName,
        operatorId: opId,
        summary: `删除成本记录 ¥${oldRecord.totalCost.toFixed(2)}`,
        costRecordRemark: oldRecord.remark,
      });

      addNotification(
        "成本数据删除",
        `${opName} 删除成本记录 ¥${oldRecord.totalCost.toFixed(2)}，原因：${changeReason}`
      );
    }
  }, [addChangeLog, addNotification]);

  // ===================== IncomeRecord CRUD =====================
  const addIncomeRecord = useCallback(async (r: Omit<IncomeRecord, "id" | "totalAmount" | "createdAt">) => {
    const totalAmount = r.items.reduce((sum, item) => sum + (item.amount || 0), 0);
    const newRecord: IncomeRecord = {
      ...r,
      id: genId("ir"),
      totalAmount,
      createdAt: new Date().toISOString(),
    };
    setIncomeRecords((prev) => {
      const updated = [...prev, newRecord];
      save(KEYS.incomeRecords, updated);
      return updated;
    });
  }, []);

  const updateIncomeRecord = useCallback(async (id: string, r: Partial<IncomeRecord>) => {
    setIncomeRecords((prev) => {
      const updated = prev.map((x) => {
        if (x.id !== id) return x;
        const merged = { ...x, ...r };
        if (r.items) {
          merged.totalAmount = r.items.reduce((sum, item) => sum + (item.amount || 0), 0);
        }
        return merged;
      });
      save(KEYS.incomeRecords, updated);
      return updated;
    });
  }, []);

  const deleteIncomeRecord = useCallback(async (id: string) => {
    setIncomeRecords((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.incomeRecords, updated);
      return updated;
    });
  }, []);

  // ===================== RevenueSettlement CRUD =====================
  const upsertRevenueSettlement = useCallback(async (s: Omit<RevenueSettlement, "id" | "createdAt">) => {
    setRevenueSettlements((prev) => {
      // 查找是否已有该单位该月的结算记录
      const existingIdx = prev.findIndex(
        (x) => x.salesUnitId === s.salesUnitId && x.yearMonth === s.yearMonth
      );
      let updated: RevenueSettlement[];
      if (existingIdx >= 0) {
        updated = prev.map((x) =>
          x.id === prev[existingIdx].id ? { ...x, ...s } : x
        );
      } else {
        const newRecord: RevenueSettlement = {
          ...s,
          id: genId("rs"),
          createdAt: new Date().toISOString(),
        };
        updated = [...prev, newRecord];
      }
      save(KEYS.revenueSettlements, updated);
      return updated;
    });
  }, []);

  const deleteRevenueSettlement = useCallback(async (id: string) => {
    setRevenueSettlements((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.revenueSettlements, updated);
      return updated;
    });
  }, []);

  // ===================== UnitProductSettlement CRUD =====================
  const upsertUnitProductSettlement = useCallback(async (s: Omit<UnitProductSettlement, "id" | "createdAt">) => {
    setUnitProductSettlements((prev) => {
      const existingIdx = prev.findIndex(
        (x) => x.salesUnitId === s.salesUnitId && x.productId === s.productId
      );
      let updated: UnitProductSettlement[];
      const now = new Date().toISOString();
      if (existingIdx >= 0) {
        updated = prev.map((x) =>
          x.id === prev[existingIdx].id ? { ...x, ...s, updatedAt: now } : x
        );
      } else {
        const newRecord: UnitProductSettlement = {
          ...s,
          id: genId("ups"),
          createdAt: now,
        };
        updated = [...prev, newRecord];
      }
      save(KEYS.unitProductSettlements, updated);
      return updated;
    });
  }, []);

  const batchUpsertUnitProductSettlements = useCallback(async (items: Omit<UnitProductSettlement, "id" | "createdAt">[]) => {
    setUnitProductSettlements((prev) => {
      let updated = [...prev];
      const now = new Date().toISOString();
      items.forEach((s) => {
        const existingIdx = updated.findIndex(
          (x) => x.salesUnitId === s.salesUnitId && x.productId === s.productId
        );
        if (existingIdx >= 0) {
          updated = updated.map((x) =>
            x.id === updated[existingIdx].id ? { ...x, ...s, updatedAt: now } : x
          );
        } else {
          updated.push({ ...s, id: genId("ups"), createdAt: now });
        }
      });
      save(KEYS.unitProductSettlements, updated);
      return updated;
    });
  }, []);

  const deleteUnitProductSettlement = useCallback(async (id: string) => {
    setUnitProductSettlements((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.unitProductSettlements, updated);
      return updated;
    });
  }, []);

  // ===================== ProductPersonCommission CRUD =====================
  const upsertProductPersonCommission = useCallback(async (c: Omit<ProductPersonCommission, "id" | "createdAt">) => {
    setProductPersonCommissions((prev) => {
      const existingIdx = prev.findIndex(
        (x) => x.salesUnitId === c.salesUnitId && x.productId === c.productId && x.personnelId === c.personnelId
      );
      let updated: ProductPersonCommission[];
      const now = new Date().toISOString();
      if (existingIdx >= 0) {
        updated = prev.map((x) =>
          x.id === prev[existingIdx].id ? { ...x, ...c, updatedAt: now } : x
        );
      } else {
        const newRecord: ProductPersonCommission = {
          ...c,
          id: genId("ppc"),
          createdAt: now,
        };
        updated = [...prev, newRecord];
      }
      save(KEYS.productPersonCommissions, updated);
      return updated;
    });
  }, []);

  const deleteProductPersonCommission = useCallback(async (id: string) => {
    setProductPersonCommissions((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.productPersonCommissions, updated);
      return updated;
    });
  }, []);

  // ===================== MonthlyAdjustment CRUD =====================
  const upsertMonthlyAdjustment = useCallback(async (a: Omit<MonthlyAdjustment, "id" | "createdAt">) => {
    setMonthlyAdjustments((prev) => {
      // 查找是否已有该人员该月的调整记录
      const existing = prev.find(
        (x) => x.personnelId === a.personnelId && x.yearMonth === a.yearMonth
      );
      let updated: MonthlyAdjustment[];
      if (existing) {
        updated = prev.map((x) =>
          x.id === existing.id
            ? { ...x, ...a, id: existing.id, createdAt: existing.createdAt }
            : x
        );
      } else {
        const newAdj: MonthlyAdjustment = {
          ...a,
          id: genId("ma"),
          createdAt: new Date().toISOString(),
        };
        updated = [...prev, newAdj];
      }
      save(KEYS.monthlyAdjustments, updated);
      return updated;
    });
  }, []);

  const deleteMonthlyAdjustment = useCallback(async (id: string) => {
    setMonthlyAdjustments((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.monthlyAdjustments, updated);
      return updated;
    });
  }, []);

  // ===================== PerformanceTarget CRUD =====================
  const upsertPerformanceTarget = useCallback(async (t: Omit<PerformanceTarget, "id" | "createdAt">) => {
    setPerformanceTargets((prev) => {
      // 唯一性：同一单位同一月份同一人员只能有一条（personnelId 为空表示单位整体）
      const existing = prev.find(
        (x) =>
          x.salesUnitId === t.salesUnitId &&
          x.yearMonth === t.yearMonth &&
          (x.personnelId || "") === (t.personnelId || "")
      );
      let updated: PerformanceTarget[];
      if (existing) {
        updated = prev.map((x) =>
          x.id === existing.id
            ? { ...x, ...t, id: existing.id, createdAt: existing.createdAt }
            : x
        );
      } else {
        const newT: PerformanceTarget = {
          ...t,
          id: genId("pt"),
          createdAt: new Date().toISOString(),
        };
        updated = [...prev, newT];
      }
      save(KEYS.performanceTargets, updated);
      return updated;
    });
  }, []);

  const deletePerformanceTarget = useCallback(async (id: string) => {
    setPerformanceTargets((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.performanceTargets, updated);
      return updated;
    });
  }, []);

  const batchUpsertPerformanceTargets = useCallback(async (targets: Omit<PerformanceTarget, "id" | "createdAt">[]) => {
    setPerformanceTargets((prev) => {
      let updated = [...prev];
      targets.forEach((t) => {
        const existing = updated.find(
          (x) =>
            x.salesUnitId === t.salesUnitId &&
            x.yearMonth === t.yearMonth &&
            (x.personnelId || "") === (t.personnelId || "")
        );
        if (existing) {
          updated = updated.map((x) =>
            x.id === existing.id
              ? { ...x, ...t, id: existing.id, createdAt: existing.createdAt }
              : x
          );
        } else {
          updated.push({
            ...t,
            id: genId("pt"),
            createdAt: new Date().toISOString(),
          });
        }
      });
      save(KEYS.performanceTargets, updated);
      return updated;
    });
  }, []);

  // ===================== PositionGroupLabel CRUD =====================
  const addPositionGroupLabel = useCallback(async (l: Omit<PositionGroupLabel, "id" | "createdAt">) => {
    setPositionGroupLabels((prev) => {
      const newLabel: PositionGroupLabel = {
        ...l,
        id: genId("pgl"),
        createdAt: new Date().toISOString(),
      };
      const updated = [...prev, newLabel];
      save(KEYS.positionGroupLabels, updated);
      return updated;
    });
  }, []);

  const updatePositionGroupLabel = useCallback(async (id: string, l: Partial<PositionGroupLabel>) => {
    setPositionGroupLabels((prev) => {
      const updated = prev.map((x) => (x.id === id ? { ...x, ...l } : x));
      save(KEYS.positionGroupLabels, updated);
      return updated;
    });
  }, []);

  const deletePositionGroupLabel = useCallback(async (id: string) => {
    setPositionGroupLabels((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      save(KEYS.positionGroupLabels, updated);
      return updated;
    });
  }, []);

  // 匹配某个岗位是否属于特殊分组（返回第一条命中的规则）
  const matchPositionLabel = useCallback(
    (position: string): PositionGroupLabel | null => {
      if (!position) return null;
      const lower = position.toLowerCase();
      for (const rule of positionGroupLabels) {
        if (!rule.keyword) continue;
        if (lower.includes(rule.keyword.toLowerCase())) {
          return rule;
        }
      }
      return null;
    },
    [positionGroupLabels]
  );

  // ===================== Notifications =====================
  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      save(KEYS.notifications, updated);
      return updated;
    });
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      save(KEYS.notifications, updated);
      return updated;
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const refreshAll = useCallback(async () => {
    setSalesUnits(load(KEYS.salesUnits, []));
    setPersonnel(load(KEYS.personnel, []));
    setProducts(load(KEYS.products, []));
    setSalesRecords(load(KEYS.salesRecords, []));
    setCostRecords(load(KEYS.costRecords, []));
    setIncomeRecords(load(KEYS.incomeRecords, []));
    setRevenueSettlements(load(KEYS.revenueSettlements, []));
    setUnitProductSettlements(load(KEYS.unitProductSettlements, []));
    setProductPersonCommissions(load(KEYS.productPersonCommissions, []));
    setCostChangeLogs(load(KEYS.changeLogs, []));
    setNotifications(load(KEYS.notifications, []));
    setMonthlyAdjustments(load(KEYS.monthlyAdjustments, []));
    setPerformanceTargets(load(KEYS.performanceTargets, []));
    setPositionGroupLabels(load(KEYS.positionGroupLabels, []));
  }, []);

  return (
    <DataContext.Provider
      value={{
        salesUnits,
        personnel,
        products,
        salesRecords,
        allSalesRecords,
        syncedOrders,
        syncedLoading,
        costRecords,
        incomeRecords,
        revenueSettlements,
        unitProductSettlements,
        costChangeLogs,
        notifications,
        monthlyAdjustments,
        performanceTargets,
        positionGroupLabels,
        loading,
        addSalesUnit,
        updateSalesUnit,
        deleteSalesUnit,
        addPersonnel,
        updatePersonnel,
        deletePersonnel,
        addProduct,
        updateProduct,
        deleteProduct,
        ensureProductByName,
        addSalesRecord,
        updateSalesRecord,
        deleteSalesRecord,
        addCostRecord,
        updateCostRecord,
        deleteCostRecord,
        addIncomeRecord,
        updateIncomeRecord,
        deleteIncomeRecord,
        upsertRevenueSettlement,
        deleteRevenueSettlement,
        upsertUnitProductSettlement,
        batchUpsertUnitProductSettlements,
        deleteUnitProductSettlement,
        productPersonCommissions,
        upsertProductPersonCommission,
        deleteProductPersonCommission,
        upsertMonthlyAdjustment,
        deleteMonthlyAdjustment,
        upsertPerformanceTarget,
        deletePerformanceTarget,
        batchUpsertPerformanceTargets,
        addPositionGroupLabel,
        updatePositionGroupLabel,
        deletePositionGroupLabel,
        matchPositionLabel,
        markNotificationRead,
        markAllNotificationsRead,
        unreadCount,
        refreshAll,
        refreshSyncedOrders,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
