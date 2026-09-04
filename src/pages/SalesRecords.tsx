import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { calcSalePersonCommissionPreview } from "@/lib/commissionReward";
import {
  buildDefaultShares,
  formatShareLabel,
  getCollaboratorsAmountSum,
  getCollaboratorsShareSum,
  getPersonShareAmount,
  getPersonShareQuantity,
  getSaleShareMode,
  getSaleShares,
  resolveCollaboratorUnitId,
  validatePerformanceSplit,
  type SaleCollaborator,
  type SaleShareMode,
} from "@/lib/saleCollaborators";
import { resolveUnitIdAt } from "@/lib/unitAssignment";
import {
  buildSaleNameMaps,
  buildSalesDuplicateFingerprint,
  getSalesRecordFingerprint,
  type SaleNameMaps,
} from "@/lib/salesDuplicate";
import type { SalesRecord } from "@/types";
import {
  Plus, Search, Pencil, Trash2, RefreshCw, CloudDownload, Upload, FileSpreadsheet,
  CheckCircle2, AlertCircle, ChevronLeft, ChevronRight, Users, ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
  getProductDomainKey,
} from "./ProductSettlement/components/m-business-domain-section";

const SALE_STICKY_OPS =
  "sticky right-0 z-20 border-l shadow-[-8px_0_12px_-8px_rgba(0,0,0,0.16)]";

const UI_SCALE_KEY = "yeji.salesRecordsUiScale";
const UI_SCALE_OPTIONS = [
  { value: "1", label: "标准" },
  { value: "1.2", label: "放大" },
  { value: "1.35", label: "更大" },
] as const;
type UiScale = (typeof UI_SCALE_OPTIONS)[number]["value"];

function readUiScale(): UiScale {
  try {
    const v = localStorage.getItem(UI_SCALE_KEY);
    if (v === "1" || v === "1.2" || v === "1.35") return v;
  } catch {
    /* ignore */
  }
  return "1.2";
}

/** 长文本截断，点击展开查看全文 */
function ExpandableCellText({
  text,
  emptyText = "-",
  label = "完整内容",
  maxLen = 10,
  className = "max-w-[11rem]",
}: {
  text?: string;
  emptyText?: string;
  label?: string;
  maxLen?: number;
  className?: string;
}) {
  const value = (text || "").trim();
  if (!value) {
    return <span className="text-base text-muted-foreground">{emptyText}</span>;
  }
  if (value.length <= maxLen) {
    return <span className="text-base">{value}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            `block w-full truncate text-left text-base text-primary hover:underline cursor-pointer ${className}`
          }
          title="点击查看完整内容"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[min(20rem,90vw)] p-3">
        <p className="mb-1 text-sm text-muted-foreground">{label}</p>
        <p className="text-base break-all whitespace-pre-wrap">{value}</p>
      </PopoverContent>
    </Popover>
  );
}

// ===================== 批量导入类型 =====================
interface ImportRow {
  rowIndex: number;
  customerName: string;
  productCategory: string;
  productName: string;
  orderAmount: number; // 订单金额
  totalAmount: number; // 实收金额
  orderType: string; // 订单类型
  salesUnitName: string;
  salesPersonName: string;
  saleDate: string;
  activityName: string; // 参加活动
  // 匹配结果
  matchedUnitId: string;
  matchedPersonId: string;
  matchedProductId: string;
  unitMatched: boolean;
  personMatched: boolean;
  productMatched: boolean;
  selected: boolean; // 是否勾选导入
  isDuplicate?: boolean; // 与已有记录或表内其他行完全相同
  duplicateReason?: string;
  duplicateExistingId?: string; // 可覆盖的已有记录 id
}

/** 每组完全相同的记录保留 1 笔（优先留同步单），返回可删的多余 id */
function pickDeletableDuplicateIds(
  records: SalesRecord[],
  maps: SaleNameMaps,
): string[] {
  const groups = new Map<string, SalesRecord[]>();
  for (const s of records) {
    const key = getSalesRecordFingerprint(s, maps);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const extraIds: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const syncedList = group.filter((s) => s.synced);
    const manualList = group.filter((s) => !s.synced);
    if (syncedList.length > 0) {
      // 有同步单时：保留 1 笔同步，其余同步 + 全部手动可删
      const sortedSynced = [...syncedList].sort((a, b) => {
        const dateDiff = (a.saleDate || "").localeCompare(b.saleDate || "");
        if (dateDiff !== 0) return dateDiff;
        return a.id.localeCompare(b.id);
      });
      extraIds.push(...sortedSynced.slice(1).map((s) => s.id));
      extraIds.push(...manualList.map((s) => s.id));
      continue;
    }
    const sorted = [...manualList].sort((a, b) => {
      const dateDiff = (a.saleDate || "").localeCompare(b.saleDate || "");
      if (dateDiff !== 0) return dateDiff;
      return a.id.localeCompare(b.id);
    });
    extraIds.push(...sorted.slice(1).map((s) => s.id));
  }
  return extraIds;
}

function markDuplicateImportRows(
  rows: ImportRow[],
  existing: SalesRecord[],
  productList: { id: string; name: string }[],
  personList: { id: string; name: string }[],
  unitList: { id: string; name: string }[],
): ImportRow[] {
  const maps = buildSaleNameMaps(productList, personList, unitList);
  const existingByKey = new Map<string, string>();
  for (const s of existing) {
    const key = getSalesRecordFingerprint(s, maps);
    if (!existingByKey.has(key)) existingByKey.set(key, s.id);
  }

  const seenInFile = new Set<string>();
  return rows.map((row) => {
    const key = buildSalesDuplicateFingerprint({
      customerName: row.customerName,
      productName: maps.productNameById.get(row.matchedProductId) || row.productName,
      orderAmount: row.orderAmount,
      totalAmount: row.totalAmount,
      orderType: row.orderType,
      unitName: maps.unitNameById.get(row.matchedUnitId) || row.salesUnitName,
      personName: maps.personNameById.get(row.matchedPersonId) || row.salesPersonName,
      saleDate: row.saleDate,
      activityName: row.activityName,
    });
    const existingId = existingByKey.get(key);
    const inFileDup = seenInFile.has(key);
    seenInFile.add(key);
    const isDuplicate = Boolean(existingId) || inFileDup;
    return {
      ...row,
      isDuplicate,
      duplicateReason: existingId
        ? "与系统中已有记录完全相同"
        : inFileDup
          ? "导入表内重复行"
          : "",
      duplicateExistingId: existingId,
      // 重复行仍默认勾选，允许正常导入；列表/预览可用筛选查看
      selected: row.selected,
    };
  });
}

// 表头别名：短词仅精确匹配，避免「客户」「类型」等误伤其他列
const HEADER_EXACT_ALIASES: Record<string, string[]> = {
  customerName: ["客户姓名", "客户名称", "客户名", "客户", "customer", "customername", "customer_name"],
  productCategory: ["产品类别", "产品分类", "类别", "category"],
  productName: ["购买产品", "产品名称", "产品", "product", "productname", "product_name"],
  orderAmount: ["订单金额", "原价", "orderamount", "order_amount"],
  totalAmount: ["实收金额", "实收", "成交金额", "amount", "total", "totalamount"],
  orderType: ["订单类型", "ordertype", "order_type"],
  salesUnitName: ["销售单位", "单位名称", "门店", "salesunit", "sales_unit"],
  salesPersonName: ["销售人员", "销售员", "业务员", "salesperson", "sales_person"],
  saleDate: ["成交日期", "销售日期", "saledate", "sale_date"],
  activityName: ["参加活动", "活动名称", "活动", "activity", "activityname"],
};

// 模糊匹配只用较长关键词，避免短别名串列
const HEADER_FUZZY_ALIASES: Record<string, string[]> = {
  customerName: ["客户姓名", "客户名称", "客户名", "customername"],
  productCategory: ["产品类别", "产品分类"],
  productName: ["购买产品", "产品名称", "productname"],
  orderAmount: ["订单金额", "orderamount"],
  totalAmount: ["实收金额", "成交金额", "totalamount"],
  orderType: ["订单类型", "ordertype"],
  salesUnitName: ["销售单位", "salesunit"],
  salesPersonName: ["销售人员", "销售员", "salesperson"],
  saleDate: ["成交日期", "销售日期", "saledate"],
  activityName: ["参加活动", "活动名称", "activityname"],
};

const FIXED_IMPORT_FIELDS = [
  "customerName",
  "productCategory",
  "productName",
  "orderAmount",
  "totalAmount",
  "orderType",
  "salesUnitName",
  "salesPersonName",
  "saleDate",
  "activityName",
] as const;

function normalizeHeader(h: string): string {
  return String(h ?? "")
    .replace(/^\ufeff/, "")
    .replace(/[\u200b\u00a0]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, ""); // 去掉括号备注，如 客户姓名(必填)
}

function matchHeader(header: string): string | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;

  for (const [field, aliases] of Object.entries(HEADER_EXACT_ALIASES)) {
    if (aliases.some((a) => normalizeHeader(a) === norm)) return field;
  }

  for (const [field, aliases] of Object.entries(HEADER_FUZZY_ALIASES)) {
    if (aliases.some((a) => {
      const alias = normalizeHeader(a);
      return alias.length >= 3 && (norm.includes(alias) || alias.includes(norm));
    })) {
      return field;
    }
  }

  // 兜底：含「客户」且含「名」→ 客户姓名
  if (norm.includes("客户") && (norm.includes("名") || norm.includes("customer"))) {
    return "customerName";
  }
  return null;
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    // Excel 日期序列数留给 parseDate 处理；普通数字直接转字符串
    return String(cell);
  }
  if (cell instanceof Date) {
    return cell.toISOString().slice(0, 10);
  }
  return String(cell).replace(/^\ufeff/, "").trim();
}

function parseDate(dateStr: string): string {
  const s = dateStr.trim();
  if (!s) return "";
  const ymdDash = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdDash) {
    const [, y, m, d] = ymdDash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ymdCompact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymdCompact) {
    const [, y, m, d] = ymdCompact;
    return `${y}-${m}-${d}`;
  }
  const excelNum = parseFloat(s);
  if (!isNaN(excelNum) && excelNum > 30000 && excelNum < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + excelNum * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return s;
}

function parseAmount(s: string): number {
  const cleaned = s.trim().replace(/[¥￥,，\s元]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Prefer match salesperson within the same unit */
function findMatchedPerson(
  personnel: { id: string; name: string; salesUnitId?: string }[],
  personName: string,
  unitId?: string,
): { id: string; name: string; salesUnitId?: string } | undefined {
  const name = (personName || "").trim();
  if (!name) return undefined;
  const pool = unitId
    ? personnel.filter((p) => p.salesUnitId === unitId)
    : personnel;
  const exact = pool.find((p) => (p.name || "").trim() === name);
  if (exact) return exact;
  const fuzzy = pool.find((p) => {
    const pn = (p.name || "").trim();
    return pn.includes(name) || name.includes(pn);
  });
  if (fuzzy) return fuzzy;
  return undefined;
}
/** 将二维表（含表头）解析为导入行 */
function parseImportMatrix(
  matrix: string[][],
  salesUnits: { id: string; name: string }[],
  personnel: { id: string; name: string; salesUnitId?: string }[],
  products: { id: string; name: string }[]
): ImportRow[] {
  const rows = matrix
    .map((r) => r.map((c) => cellToString(c)))
    .filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return [];

  // 找表头行：优先包含「客户姓名/购买产品」的行
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const joined = rows[i].map(normalizeHeader).join("|");
    if (
      joined.includes("客户") ||
      joined.includes("购买产品") ||
      joined.includes("实收") ||
      joined.includes("customer")
    ) {
      headerIdx = i;
      break;
    }
  }

  const headers = rows[headerIdx];
  const columnMap: Record<number, string> = {};
  headers.forEach((h, idx) => {
    const field = matchHeader(h);
    if (field) columnMap[idx] = field;
  });

  const mappedFields = new Set(Object.values(columnMap));
  const useFixedOrder = !mappedFields.has("customerName") && !mappedFields.has("productName");

  const result: ImportRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    // 跳过重复表头行
    const firstCellNorm = normalizeHeader(cells[0] || "");
    if (
      firstCellNorm === "客户姓名" ||
      firstCellNorm === "客户名称" ||
      firstCellNorm === "customername"
    ) {
      continue;
    }

    const data: Record<string, string> = {};
    if (useFixedOrder) {
      FIXED_IMPORT_FIELDS.forEach((field, idx) => {
        data[field] = cells[idx] || "";
      });
    } else {
      Object.entries(columnMap).forEach(([idx, field]) => {
        data[field] = cells[parseInt(idx, 10)] || "";
      });
      // 表头未识别到客户列时，尝试第 1 列兜底
      if (!data.customerName) {
        const first = cells[0] || "";
        if (first && !matchHeader(first)) data.customerName = first;
      }
    }

    const unitName = (data.salesUnitName || "").trim();
    const personName = (data.salesPersonName || "").trim();
    const productName = (data.productName || "").trim();
    const customerName = (data.customerName || "").trim();

    // 整行几乎为空则跳过
    if (!customerName && !productName && !unitName && !personName) continue;

    const matchedUnit = unitName
      ? salesUnits.find((u) => u.name === unitName || u.name.includes(unitName) || unitName.includes(u.name))
      : undefined;
    const matchedPerson = personName
      ? findMatchedPerson(personnel, personName, matchedUnit?.id)
      : undefined;
    const matchedProduct = productName
      ? products.find((p) => p.name === productName || p.name.includes(productName) || productName.includes(p.name))
      : undefined;

    result.push({
      rowIndex: result.length + 1,
      customerName,
      productCategory: (data.productCategory || "").trim(),
      productName,
      orderAmount: parseAmount(data.orderAmount || "0"),
      totalAmount: parseAmount(data.totalAmount || "0"),
      orderType: (data.orderType || "").trim(),
      salesUnitName: unitName,
      salesPersonName: personName,
      saleDate: parseDate(data.saleDate || ""),
      activityName: (data.activityName || "").trim(),
      matchedUnitId: matchedUnit?.id || "",
      matchedPersonId: matchedPerson?.id || "",
      matchedProductId: matchedProduct?.id || "",
      unitMatched: !!matchedUnit,
      personMatched: !!matchedPerson,
      productMatched: !!matchedProduct,
      selected: true,
    });
  }

  return result;
}

function textToMatrix(text: string): string[][] {
  const cleaned = text.replace(/^\ufeff/, "").trim();
  if (!cleaned) return [];
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const sampleLine = lines[0];
  const delimiter = sampleLine.includes("\t")
    ? "\t"
    : (sampleLine.split(",").length >= sampleLine.split("，").length ? "," : "，");

  return lines.map((line) => line.split(delimiter).map((c) => c.trim()));
}

export default function SalesRecords() {
  const {
    products, ensureProductByName, ensurePersonnelByName, addSalesRecord, updateSalesRecord, deleteSalesRecord,
    refreshSyncedOrders, syncedLoading, productPersonCommissions: ppcList,
  } = useData();
  const { user } = useAuth();
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords, canEditSales, isReadOnly } = usePermissions();
  const [search, setSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState("all");
  const [filterPerson, setFilterPerson] = useState("all");
  const [filterSync, setFilterSync] = useState("all"); // all | manual | synced
  const [filterDomain, setFilterDomain] = useState("all");
  const [filterDuplicate, setFilterDuplicate] = useState<"all" | "duplicate" | "unique">("all");
  const [importDupFilter, setImportDupFilter] = useState<"all" | "duplicate" | "unique">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SalesRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // 批量删除
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  // 批量导入状态
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importStep, setImportStep] = useState<"input" | "preview">("input");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableCardRef = useRef<HTMLDivElement>(null);
  const [highlightSynced, setHighlightSynced] = useState(false);
  const [uiScale, setUiScale] = useState<UiScale>(readUiScale);

  function handleChangeUiScale(next: UiScale) {
    setUiScale(next);
    try {
      localStorage.setItem(UI_SCALE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const [form, setForm] = useState({
    salesUnitId: "",
    personnelId: "",
    productId: "",
    quantity: 1,
    unitPrice: 0,
    saleDate: new Date().toISOString().slice(0, 10),
    remark: "",
    orderAmount: 0,
    orderType: "",
    customerName: "",
    activityName: "",
  });
  /** 是否开启订单分业绩（编辑对应订单时配置） */
  const [isSplitPerformance, setIsSplitPerformance] = useState(false);
  const [shareMode, setShareMode] = useState<SaleShareMode>("percent");
  const [collaborators, setCollaborators] = useState<SaleCollaborator[]>([]);
  const isEditingSynced = Boolean(editingRecord?.synced);

  const saleNameMaps = useMemo(
    () => buildSaleNameMaps(products, personnel, salesUnits),
    [products, personnel, salesUnits],
  );

  /** 系统中业务内容相同的销售记录 id（出现次数 > 1，忽略手动/生态圈来源） */
  const duplicateRecordIdSet = useMemo(() => {
    const keyCounts = new Map<string, number>();
    const idToKey = new Map<string, string>();
    for (const s of salesRecords) {
      const key = getSalesRecordFingerprint(s, saleNameMaps);
      idToKey.set(s.id, key);
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
    const set = new Set<string>();
    idToKey.forEach((key, id) => {
      if ((keyCounts.get(key) || 0) > 1) set.add(id);
    });
    return set;
  }, [salesRecords, saleNameMaps]);

  const domainOptions = useMemo(() => {
    const set = new Set<string>();
    let hasUncategorized = false;
    products.forEach((p) => {
      const key = getProductDomainKey(p);
      if (key === UNCATEGORIZED) hasUncategorized = true;
      else set.add(key);
    });
    // 销售记录里找不到产品时，也视作未分类
    salesRecords.forEach((s) => {
      const product = products.find((p) => p.id === s.productId);
      if (!product) hasUncategorized = true;
    });
    const list = Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (hasUncategorized) list.push(UNCATEGORIZED);
    return list;
  }, [products, salesRecords]);

  const baseFilteredRecords = useMemo(() => {
    return salesRecords
      .filter((s) => {
        const person = personnel.find((p) => p.id === s.personnelId);
        const product = products.find((p) => p.id === s.productId);
        const personName = person?.name || s.salesPersonName || "";
        const productName = product?.name || s.productName || "";
        const matchSearch =
          personName.toLowerCase().includes(search.toLowerCase()) ||
          productName.toLowerCase().includes(search.toLowerCase()) ||
          (s.customerName || "").toLowerCase().includes(search.toLowerCase()) ||
          (s.externalOrderId || "").toLowerCase().includes(search.toLowerCase());
        const matchUnit =
          filterUnit === "all" || saleMatchesUnitFilter(s, filterUnit);
        const matchPerson =
          filterPerson === "all"
          || s.personnelId === filterPerson
          || (s.collaborators || []).some((c) => c.personnelId === filterPerson);
        const matchSync = filterSync === "all" || (filterSync === "synced" ? s.synced : !s.synced);
        const domainKey = product ? getProductDomainKey(product) : UNCATEGORIZED;
        const matchDomain = filterDomain === "all" || domainKey === filterDomain;
        const saleDate = (s.saleDate || "").slice(0, 10);
        const matchFrom = !dateFrom || saleDate >= dateFrom;
        const matchTo = !dateTo || saleDate <= dateTo;
        return matchSearch && matchUnit && matchPerson && matchSync && matchDomain && matchFrom && matchTo;
      })
      .sort((a, b) => (b.saleDate || "").localeCompare(a.saleDate || ""));
  }, [
    salesRecords, personnel, products, search, filterUnit, filterPerson, filterSync,
    filterDomain, dateFrom, dateTo,
  ]);

  const duplicateCountInFilters = useMemo(
    () => baseFilteredRecords.filter((s) => duplicateRecordIdSet.has(s.id)).length,
    [baseFilteredRecords, duplicateRecordIdSet],
  );

  const filteredRecords = useMemo(() => {
    if (filterDuplicate === "duplicate") {
      return baseFilteredRecords.filter((s) => duplicateRecordIdSet.has(s.id));
    }
    if (filterDuplicate === "unique") {
      return baseFilteredRecords.filter((s) => !duplicateRecordIdSet.has(s.id));
    }
    return baseFilteredRecords;
  }, [baseFilteredRecords, filterDuplicate, duplicateRecordIdSet]);

  // 筛选条件变化时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [search, filterUnit, filterPerson, filterSync, filterDomain, filterDuplicate, dateFrom, dateTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRecords = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, safePage, pageSize]);

  // 统计
  const syncedCount = useMemo(() => salesRecords.filter((s) => s.synced).length, [salesRecords]);
  const manualCount = useMemo(() => salesRecords.filter((s) => !s.synced).length, [salesRecords]);

  // 可批量删除的记录（当前页，含同步订单）
  const selectableRecords = useMemo(() => pagedRecords, [pagedRecords]);
  /** 重复筛选下：每组保留 1 笔后，其余可删 id */
  const duplicateExtraDeletableIdSet = useMemo(
    () => new Set(pickDeletableDuplicateIds(filteredRecords, saleNameMaps)),
    [filteredRecords, saleNameMaps],
  );
  const pageSelectTargets = useMemo(
    () => (filterDuplicate === "duplicate"
      ? selectableRecords.filter((s) => duplicateExtraDeletableIdSet.has(s.id))
      : selectableRecords),
    [filterDuplicate, selectableRecords, duplicateExtraDeletableIdSet],
  );
  const allSelected = pageSelectTargets.length > 0
    && pageSelectTargets.every((s) => selectedIds.has(s.id));
  const someSelected = pageSelectTargets.some((s) => selectedIds.has(s.id));

  // 根据筛选单位过滤人员
  const availablePersonnel = useMemo(() => {
    if (filterUnit === "all") return personnel;
    return personnel.filter((p) => p.salesUnitId === filterUnit);
  }, [personnel, filterUnit]);

  // 表单中根据选择的单位 + 成交日归属过滤人员
  const formPersonnel = useMemo(() => {
    if (!form.salesUnitId) return personnel;
    return personnel.filter(
      (p) =>
        resolveUnitIdAt(p, form.saleDate) === form.salesUnitId
        || p.salesUnitId === form.salesUnitId,
    );
  }, [personnel, form.salesUnitId, form.saleDate]);

  const getUnitName = (s: SalesRecord) => {
    if (s.salesUnitId) return salesUnits.find((u) => u.id === s.salesUnitId)?.name || s.salesUnitName || "-";
    return s.salesUnitName || "（未匹配）";
  };
  const getPersonnelName = (s: SalesRecord) => {
    if (s.collaborators && s.collaborators.length > 1) {
      return s.collaborators
        .map((c) => {
          const person = personnel.find((p) => p.id === c.personnelId);
          const name = person?.name || "-";
          const unitId = c.salesUnitId
            || (person ? resolveUnitIdAt(person, s.saleDate) || person.salesUnitId : "");
          const unitName = salesUnits.find((u) => u.id === unitId)?.name;
          const label = unitName ? `${unitName}·${name}` : name;
          return formatShareLabel(s, c, label);
        })
        .join(" / ");
    }
    if (s.personnelId) return personnel.find((p) => p.id === s.personnelId)?.name || s.salesPersonName || "-";
    return s.salesPersonName || "（未匹配）";
  };

  function getShareUnitId(c: SaleCollaborator): string {
    if (c.salesUnitId) return c.salesUnitId;
    const person = personnel.find((p) => p.id === c.personnelId);
    if (!person) return "";
    return resolveUnitIdAt(person, form.saleDate) || person.salesUnitId || "";
  }

  function getPersonnelForShareUnit(unitId: string) {
    if (!unitId) return [];
    return personnel.filter(
      (p) =>
        resolveUnitIdAt(p, form.saleDate) === unitId
        || p.salesUnitId === unitId,
    );
  }

  function enrichShareRow(c: SaleCollaborator, saleDate: string): SaleCollaborator {
    if (c.salesUnitId || !c.personnelId) return { ...c };
    const person = personnel.find((p) => p.id === c.personnelId);
    if (!person) return { ...c };
    return {
      ...c,
      salesUnitId: resolveUnitIdAt(person, saleDate) || person.salesUnitId || undefined,
    };
  }

  function getRecorderPerson() {
    if (!user?.name) return undefined;
    return personnel.find((p) => (p.name || "").trim() === user.name.trim());
  }

  function ensureRecorderOnForm() {
    if (form.personnelId && form.salesUnitId) {
      return { personnelId: form.personnelId, salesUnitId: form.salesUnitId };
    }
    const me = getRecorderPerson();
    const salesUnitId = me
      ? (resolveUnitIdAt(me, form.saleDate) || me.salesUnitId || form.salesUnitId || salesUnits[0]?.id || "")
      : (form.salesUnitId || salesUnits[0]?.id || "");
    const personnelId = me?.id || form.personnelId || "";
    if (personnelId !== form.personnelId || salesUnitId !== form.salesUnitId) {
      setForm((prev) => ({ ...prev, personnelId, salesUnitId }));
    }
    return { personnelId, salesUnitId };
  }

  function getPrimaryShareLabel(c: SaleCollaborator) {
    const person = personnel.find((p) => p.id === c.personnelId)
      || personnel.find((p) => p.id === form.personnelId);
    const unitId = c.salesUnitId || form.salesUnitId || getShareUnitId(c);
    const unitName = salesUnits.find((u) => u.id === unitId)?.name || "-";
    const name = person?.name || "-";
    return `${unitName} · ${name}`;
  }

  const totalAmount = form.quantity * form.unitPrice;

  const openAdd = () => {
    setEditingRecord(null);
    setIsSplitPerformance(false);
    setShareMode("percent");
    setCollaborators([]);
    const saleDate = new Date().toISOString().slice(0, 10);
    const me = getRecorderPerson();
    const defaultUnitId = me
      ? (resolveUnitIdAt(me, saleDate) || me.salesUnitId || salesUnits[0]?.id || "")
      : (salesUnits[0]?.id || "");
    setForm({
      salesUnitId: defaultUnitId,
      personnelId: me?.id || "",
      productId: "",
      quantity: 1,
      unitPrice: 0,
      saleDate,
      remark: "",
      orderAmount: 0,
      orderType: "",
      customerName: "",
      activityName: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (record: SalesRecord) => {
    setEditingRecord(record);
    const cols = record.collaborators || [];
    const splitOn = cols.length >= 2;
    const mode = getSaleShareMode(record);
    setIsSplitPerformance(splitOn);
    setShareMode(mode);
    setCollaborators(
      splitOn
        ? cols.map((c, idx) => {
          const enriched = enrichShareRow(c, record.saleDate);
          if (idx === 0) {
            return {
              ...enriched,
              personnelId: record.personnelId || enriched.personnelId,
              salesUnitId: record.salesUnitId || enriched.salesUnitId,
            };
          }
          return enriched;
        })
        : buildDefaultShares(
          record.personnelId || "",
          mode,
          record.totalAmount || 0,
          "",
          record.salesUnitId || "",
          record.salesUnitId || "",
        ),
    );
    setForm({
      salesUnitId: record.salesUnitId,
      personnelId: record.personnelId,
      productId: record.productId,
      quantity: record.quantity,
      unitPrice: record.unitPrice,
      saleDate: record.saleDate,
      remark: record.remark,
      orderAmount: record.orderAmount || 0,
      orderType: record.orderType || "",
      customerName: record.customerName || "",
      activityName: record.activityName || "",
    });
    setDialogOpen(true);
  };

  /** 点击同步笔数：筛选仅同步订单并滚动到列表 */
  function handleJumpToSyncedOrders() {
    if (syncedCount <= 0) return;
    setSearch("");
    setFilterUnit("all");
    setFilterPerson("all");
    setFilterSync("synced");
    setFilterDomain("all");
    setFilterDuplicate("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setHighlightSynced(true);
    window.setTimeout(() => {
      tableCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    window.setTimeout(() => setHighlightSynced(false), 2500);
  }

  function handleChangeShareMode(nextMode: SaleShareMode) {
    if (nextMode === shareMode) return;
    const orderTotal = form.quantity * form.unitPrice;
    setShareMode(nextMode);
    setCollaborators((prev) => {
      if (prev.length < 2) {
        return buildDefaultShares(
          form.personnelId,
          nextMode,
          orderTotal,
          "",
          form.salesUnitId,
          form.salesUnitId,
        );
      }
      if (nextMode === "amount") {
        return prev.map((c) => {
          const pct = Number(c.sharePercent) || 0;
          const amount = Math.round(orderTotal * pct) / 100;
          return { ...c, shareAmount: amount, sharePercent: pct };
        });
      }
      return prev.map((c) => {
        const amount = Number(c.shareAmount) || 0;
        const pct = orderTotal > 0
          ? Math.round((amount / orderTotal) * 1000) / 10
          : 0;
        return { ...c, sharePercent: pct, shareAmount: amount };
      });
    });
  }
  const getProductName = (s: SalesRecord) => {
    if (s.productId) return products.find((p) => p.id === s.productId)?.name || s.productName || "-";
    return s.productName || "（未匹配）";
  };

  const handleProductChange = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    setForm({ ...form, productId, unitPrice: product?.unitPrice || 0 });
  };

  const handleUnitChange = (unitId: string) => {
    setForm({ ...form, salesUnitId: unitId, personnelId: "" });
  };

  const handleSubmit = async () => {
    if (!form.productId) return;
    if (!isSplitPerformance && (!form.salesUnitId || !form.personnelId)) return;
    const orderTotal = form.quantity * form.unitPrice;
    let payloadCollaborators: SaleCollaborator[] | undefined;
    let payloadShareMode: SaleShareMode | undefined;
    if (isSplitPerformance) {
      const list = collaborators.map((c, idx) => {
        if (idx === 0) {
          return {
            ...c,
            personnelId: form.personnelId || c.personnelId,
            salesUnitId: form.salesUnitId || c.salesUnitId || getShareUnitId(c) || undefined,
          };
        }
        return {
          ...c,
          salesUnitId: c.salesUnitId || getShareUnitId(c) || undefined,
        };
      });
      for (const c of list) {
        if (!c.salesUnitId) {
          alert("请为每一位分摊人选择销售单位");
          return;
        }
        if (!c.personnelId) {
          alert("请为每一位分摊人选择人员");
          return;
        }
      }
      const check = validatePerformanceSplit(shareMode, list, orderTotal);
      if (!check.ok) {
        alert(check.message);
        return;
      }
      payloadCollaborators = list;
      payloadShareMode = shareMode;
      const primary = list[0];
      try {
        const payload = {
          ...form,
          salesUnitId: primary.salesUnitId || form.salesUnitId,
          personnelId: primary.personnelId,
          collaborators: payloadCollaborators,
          shareMode: payloadShareMode,
        };
        if (editingRecord) {
          await updateSalesRecord(editingRecord.id, payload);
        } else {
          await addSalesRecord(payload);
        }
        setDialogOpen(false);
      } catch (error: any) {
        alert("操作失败: " + (error.message || "未知错误"));
      }
      return;
    } else {
      payloadCollaborators = [];
      payloadShareMode = undefined;
    }
    try {
      const payload = {
        ...form,
        collaborators: payloadCollaborators,
        shareMode: payloadShareMode,
      };
      if (editingRecord) {
        await updateSalesRecord(editingRecord.id, payload);
      } else {
        await addSalesRecord(payload);
      }
      setDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteSalesRecord(deleteId);
        setDeleteId(null);
      } catch (error: any) {
        alert("删除失败: " + (error.message || "未知错误"));
      }
    }
  };

  // 批量选择
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = (select: boolean) => {
    setSelectedIds(select ? new Set(pageSelectTargets.map((s) => s.id)) : new Set());
  };
  const clearSelection = () => setSelectedIds(new Set());

  /** 点击「重复 N 笔」：打开/关闭仅重复筛选，便于勾选后批量删除 */
  function handleToggleDuplicateFilter() {
    if (filterDuplicate === "duplicate") {
      setFilterDuplicate("all");
      return;
    }
    setFilterDuplicate("duplicate");
    setPage(1);
    clearSelection();
  }

  /** 自动勾选每组重复中的多余记录（每组留 1 笔，跨页；有同步单时优先保留 1 笔同步） */
  function handleSelectAllFilteredDeletable() {
    const ids = pickDeletableDuplicateIds(filteredRecords, saleNameMaps);
    if (ids.length === 0) {
      alert("没有可删除的多余重复（每组需至少保留 1 笔）");
      return;
    }
    setSelectedIds(new Set(ids));
  }

  // 批量删除（含同步订单；重复筛选下每组仍保留 1 笔）
  const handleBatchDelete = async () => {
    try {
      const extraSet = new Set(pickDeletableDuplicateIds(salesRecords, saleNameMaps));
      const ids = Array.from(selectedIds).filter((id) => {
        const r = salesRecords.find((s) => s.id === id);
        if (!r) return false;
        if (duplicateRecordIdSet.has(id) && !extraSet.has(id)) return false;
        return true;
      });
      if (ids.length === 0) {
        alert("已自动跳过每组需保留的 1 笔，没有可删除的记录");
        setBatchDeleteOpen(false);
        return;
      }
      for (const id of ids) {
        await deleteSalesRecord(id);
      }
      clearSelection();
      setBatchDeleteOpen(false);
    } catch (error: any) {
      alert("批量删除失败: " + (error.message || "未知错误"));
    }
  };

  const handleSyncRefresh = async () => {
    await refreshSyncedOrders();
  };

  function saleMatchesUnitFilter(s: SalesRecord, unitId: string): boolean {
    const shares = getSaleShares(s);
    if (shares.length >= 2) {
      return shares.some(
        (c) => resolveCollaboratorUnitId(c, s.saleDate || "", personnel) === unitId,
      );
    }
    return s.salesUnitId === unitId;
  }

  /** 当前筛选下该单计入的业绩（按分业绩归属单位份额，非整单） */
  function getFilteredShareAmount(s: SalesRecord): number {
    if (filterPerson !== "all") {
      return getPersonShareAmount(s, filterPerson);
    }
    if (filterUnit !== "all") {
      const shares = getSaleShares(s);
      if (shares.length >= 2) {
        return shares
          .filter(
            (c) => resolveCollaboratorUnitId(c, s.saleDate || "", personnel) === filterUnit,
          )
          .reduce((sum, c) => sum + getPersonShareAmount(s, c.personnelId), 0);
      }
      return s.salesUnitId === filterUnit ? (Number(s.totalAmount) || 0) : 0;
    }
    return Number(s.totalAmount) || 0;
  }

  /** 当前筛选下该单提成预估 */
  function getFilteredCommission(s: SalesRecord): number {
    if (filterPerson !== "all") {
      const amount = getPersonShareAmount(s, filterPerson);
      if (!(amount > 0)) return 0;
      const collab = getSaleShares(s).find((c) => c.personnelId === filterPerson);
      const person = personnel.find((x) => x.id === filterPerson);
      const unitCandidates = [
        collab?.salesUnitId,
        person ? (resolveUnitIdAt(person, s.saleDate) || person.salesUnitId) : "",
        s.salesUnitId,
      ].filter(Boolean) as string[];
      for (const unitId of unitCandidates) {
        const c = calcSalePersonCommissionPreview(
          {
            productId: s.productId,
            salesUnitId: unitId,
            personnelId: filterPerson,
            quantity: getPersonShareQuantity(s, filterPerson),
            totalAmount: amount,
            saleDate: s.saleDate,
          },
          ppcList,
        );
        if (c > 0) return c;
      }
      // 无该人专属配置时：按份额比例缩放整单预估
      const full = calcSalePersonCommissionPreview(s, ppcList);
      const total = Number(s.totalAmount) || 0;
      return total > 0 ? full * (amount / total) : 0;
    }
    if (filterUnit !== "all") {
      const shares = getSaleShares(s);
      if (shares.length >= 2) {
        return shares
          .filter(
            (c) => resolveCollaboratorUnitId(c, s.saleDate || "", personnel) === filterUnit,
          )
          .reduce((sum, c) => {
            const amount = getPersonShareAmount(s, c.personnelId);
            if (!(amount > 0)) return sum;
            const unitId = resolveCollaboratorUnitId(c, s.saleDate || "", personnel)
              || filterUnit;
            let part = calcSalePersonCommissionPreview(
              {
                productId: s.productId,
                salesUnitId: unitId,
                personnelId: c.personnelId,
                quantity: getPersonShareQuantity(s, c.personnelId),
                totalAmount: amount,
                saleDate: s.saleDate,
              },
              ppcList,
            );
            if (!(part > 0)) {
              const full = calcSalePersonCommissionPreview(s, ppcList);
              const total = Number(s.totalAmount) || 0;
              part = total > 0 ? full * (amount / total) : 0;
            }
            return sum + part;
          }, 0);
      }
    }
    return calcSalePersonCommissionPreview(s, ppcList);
  }

  const totalRevenue = filteredRecords.reduce((sum, s) => sum + getFilteredShareAmount(s), 0);
  const totalCommission = filteredRecords.reduce(
    (sum, s) => sum + getFilteredCommission(s),
    0,
  );

  // ===================== 批量导入逻辑 =====================

  const parseImportText = (text: string): ImportRow[] => {
    return parseImportMatrix(textToMatrix(text), salesUnits, personnel, products);
  };

  const handleParsePreview = () => {
    const rows = parseImportText(importText);
    if (rows.length === 0) {
      alert("未能解析出有效数据行，请检查格式。\n确保第一行为表头，包含：客户姓名、产品类别、购买产品、订单金额、实收金额、订单类型、销售单位、销售人员、成交日期、参加活动");
      return;
    }
    const emptyCustomer = rows.filter((r) => !r.customerName).length;
    if (emptyCustomer === rows.length) {
      alert("已解析到数据，但「客户姓名」列全部为空。请确认表头第一列是「客户姓名」或「客户名称」。");
    } else if (emptyCustomer > 0) {
      console.warn(`导入预览：${emptyCustomer} 行客户姓名为空`);
    }
    const marked = markDuplicateImportRows(
      rows, salesRecords, products, personnel, salesUnits,
    );
    const dupCount = marked.filter((r) => r.isDuplicate).length;
    setImportRows(marked);
    setImportDupFilter("all");
    setImportStep("preview");
    if (dupCount > 0) {
      alert(`检测到 ${dupCount} 条与系统已有记录或表内完全相同的数据，仍会默认勾选并可正常导入。可用上方「重复信息」筛选查看。`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith(".xls") || fileName.endsWith(".xlsx");
    const isCsv = fileName.endsWith(".csv");

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array", cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet) {
            alert("未能读取到有效工作表，请检查文件内容");
            return;
          }
          // 用二维数组解析，避免 sheet_to_txt 丢列/错位导致客户姓名读不到
          const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(worksheet, {
            header: 1,
            defval: "",
            raw: false,
          });
          const textMatrix = matrix.map((row) =>
            (row || []).map((cell) => cellToString(cell))
          );
          const tsv = textMatrix.map((r) => r.join("\t")).join("\n");
          setImportText(tsv);
        } catch (err: any) {
          alert("Excel 文件解析失败: " + (err.message || "未知错误"));
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (isCsv) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setImportText(text);
      };
      reader.readAsText(file, "UTF-8");
    } else {
      alert("不支持的文件格式，请上传 .xls、.xlsx 或 .csv 文件");
    }
    e.target.value = "";
  };

  const handleDownloadTemplate = () => {
    const headers = ["客户姓名", "产品类别", "购买产品", "订单金额", "实收金额", "订单类型", "销售单位", "销售人员", "成交日期", "参加活动"];
    const sampleData = [
      ["杭州科技有限公司", "智能硬件", "智能终端Pro", 50000, 48000, "新购", "华东销售部", "张三", "2026-08-03", "无活动"],
      ["深圳网络公司", "云服务", "云服务订阅", 12000, 12000, "续费", "华南销售部", "李四", "2026-08-03", "小游戏风月庆"],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
    // 设置列宽
    ws["!cols"] = [
      { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
      { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "销售记录导入模板");
    XLSX.writeFile(wb, "销售记录导入模板.xlsx");
  };

  const toggleRowSelection = (rowIndex: number) => {
    setImportRows((prev) =>
      prev.map((r) => (r.rowIndex === rowIndex ? { ...r, selected: !r.selected } : r))
    );
  };

  const toggleAllSelection = (select: boolean) => {
    setImportRows((prev) => prev.map((r) => ({ ...r, selected: select })));
  };

  const handleConfirmImport = async () => {
    const selectedRows = importRows.filter((r) => r.selected);
    if (selectedRows.length === 0) {
      alert("请至少选择一行数据导入");
      return;
    }

    setImporting(true);
    let successCount = 0;
    let failCount = 0;
    let createdProductCount = 0;
    let createdPersonCount = 0;
    let duplicateImportCount = 0;

    const nameToProductId = new Map<string, string>();
    products.forEach((p) => {
      const key = (p.name || "").trim().toLowerCase();
      if (key) nameToProductId.set(key, p.id);
    });

    const unitPersonKeyToId = new Map<string, string>();
    personnel.forEach((p) => {
      const n = (p.name || "").trim().toLowerCase();
      if (!n || !p.salesUnitId) return;
      unitPersonKeyToId.set(`${p.salesUnitId}::${n}`, p.id);
    });

    for (const row of selectedRows) {
      try {
        if (row.isDuplicate) duplicateImportCount++;

        let productId = row.matchedProductId;
        const productName = (row.productName || "").trim();
        if (productName) {
          const key = productName.toLowerCase();
          if (productId && nameToProductId.has(key)) {
            productId = nameToProductId.get(key)!;
          } else if (nameToProductId.has(key)) {
            productId = nameToProductId.get(key)!;
          } else {
            const created = await ensureProductByName(productName, {
              category: row.productCategory || "",
              unitPrice: row.totalAmount || row.orderAmount || 0,
              description: "由销售订单自动录入",
            });
            if (created) {
              productId = created.id;
              nameToProductId.set(key, created.id);
              createdProductCount++;
            }
          }
        }

        let personnelId = row.matchedPersonId || "";
        const personName = (row.salesPersonName || "").trim();
        const unitId = row.matchedUnitId || "";
        if (personName && unitId) {
          const personKey = `${unitId}::${personName.toLowerCase()}`;
          if (unitPersonKeyToId.has(personKey)) {
            personnelId = unitPersonKeyToId.get(personKey)!;
          } else {
            if (personnelId) {
              const existed = personnel.find((p) => p.id === personnelId);
              if (!existed || existed.salesUnitId !== unitId) personnelId = "";
            }
            if (!personnelId) {
              const ensured = await ensurePersonnelByName(personName, unitId);
              if (ensured) {
                const alreadyKnown = [...unitPersonKeyToId.values()].includes(ensured.id);
                personnelId = ensured.id;
                unitPersonKeyToId.set(personKey, ensured.id);
                unitPersonKeyToId.set(
                  `${unitId}::${(ensured.name || "").trim().toLowerCase()}`,
                  ensured.id,
                );
                if (!alreadyKnown) createdPersonCount++;
              }
            }
          }
        }

        const payload = {
          salesUnitId: row.matchedUnitId,
          personnelId,
          productId: productId || "",
          quantity: 1,
          unitPrice: row.totalAmount,
          saleDate: row.saleDate,
          remark: row.productCategory ? `产品类别: ${row.productCategory}` : "",
          customerName: (row.customerName || "").trim(),
          salesUnitName: row.salesUnitName,
          salesPersonName: row.salesPersonName,
          productName,
          orderAmount: row.orderAmount,
          orderType: row.orderType,
          activityName: row.activityName,
        };

        await addSalesRecord(payload);
        successCount++;
      } catch (err) {
        failCount++;
      }
    }

    setImporting(false);
    setImportOpen(false);
    setImportText("");
    setImportRows([]);
    setImportStep("input");
    const autoTips: string[] = [];
    if (createdProductCount > 0) {
      autoTips.push(`自动新建 ${createdProductCount} 个产品`);
    }
    if (createdPersonCount > 0) {
      autoTips.push(`自动新建 ${createdPersonCount} 名销售人员`);
    }
    const productTip = autoTips.length > 0
      ? `\n已${autoTips.join("，")}。请到「人员管理」完善岗位/薪资，到「产品结算设置」配置结算，到「成本管理」配置销售提成。`
      : "\n可在「产品结算设置」配置单位结算规则，在「成本管理」配置人员销售提成。";
    const extraTips = [
      duplicateImportCount > 0 ? `其中重复 ${duplicateImportCount} 条（已正常导入）` : "",
    ].filter(Boolean).join("，");
    alert(
      `导入完成：成功 ${successCount} 条` +
      `${failCount > 0 ? `，失败 ${failCount} 条` : ""}` +
      `${extraTips ? `（${extraTips}）` : ""}` +
      productTip
    );
  };

  const openImportDialog = () => {
    setImportText("");
    setImportRows([]);
    setImportStep("input");
    setImportDupFilter("all");
    setImportOpen(true);
  };

  // 导入预览统计
  const importStats = useMemo(() => {
    const selected = importRows.filter((r) => r.selected);
    const duplicates = importRows.filter((r) => r.isDuplicate);
    return {
      total: importRows.length,
      selected: selected.length,
      duplicates: duplicates.length,
      allMatched: selected.filter((r) => r.unitMatched && r.personMatched && r.productMatched).length,
      partialMatched: selected.filter((r) => !(r.unitMatched && r.personMatched && r.productMatched) && (r.unitMatched || r.personMatched || r.productMatched)).length,
      noMatch: selected.filter((r) => !r.unitMatched && !r.personMatched && !r.productMatched).length,
      totalAmount: selected.reduce((sum, r) => sum + r.totalAmount, 0),
    };
  }, [importRows]);

  const previewImportRows = useMemo(() => {
    if (importDupFilter === "duplicate") return importRows.filter((r) => r.isDuplicate);
    if (importDupFilter === "unique") return importRows.filter((r) => !r.isDuplicate);
    return importRows;
  }, [importRows, importDupFilter]);

  return (
    <div>
      <PageHeader
        title="销售记录管理"
        description="记录每笔销售：销售人员、销售产品、销售时间与金额（支持生态圈订单同步）"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
              <ZoomIn className="mx-1 h-4 w-4 text-muted-foreground" />
              {UI_SCALE_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={uiScale === opt.value ? "default" : "ghost"}
                  className="h-8 px-3"
                  onClick={() => handleChangeUiScale(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            {canEditSales && !isReadOnly && selectedIds.size > 0 && (
              <Button variant="destructive" onClick={() => setBatchDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />批量删除 ({selectedIds.size})
              </Button>
            )}
            <Button variant="outline" onClick={handleSyncRefresh} disabled={syncedLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${syncedLoading ? "animate-spin" : ""}`} />
              {syncedLoading ? "同步中..." : "刷新同步"}
            </Button>
            {canEditSales && !isReadOnly && (
              <>
                <Button variant="outline" onClick={openImportDialog}>
                  <Upload className="mr-2 h-4 w-4" />批量导入
                </Button>
                <Button onClick={openAdd}>
                  <Plus className="mr-2 h-4 w-4" />新增销售记录
                </Button>
              </>
            )}
          </div>
        }
      />

      <div
        className="origin-top-left"
        style={{ zoom: Number(uiScale) }}
      >
      {/* 同步状态卡片 */}
      {(syncedCount > 0 || syncedLoading) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-2.5">
          <CloudDownload className="h-5 w-5 text-blue-500" />
          <div className="flex flex-1 items-center gap-4 text-sm">
            <span className="text-muted-foreground">生态圈同步：</span>
            <button
              type="button"
              className="inline-flex"
              onClick={handleJumpToSyncedOrders}
              disabled={syncedCount <= 0}
              title="点击查看同步订单"
            >
              <Badge
                className={
                  syncedCount > 0
                    ? "cursor-pointer bg-blue-100 text-blue-700 hover:bg-blue-200"
                    : "bg-blue-100 text-blue-700"
                }
              >
                {syncedCount} 笔同步订单
              </Badge>
            </button>
            <Badge variant="secondary">{manualCount} 笔手动记录</Badge>
            {syncedLoading && <span className="text-blue-500">正在拉取最新订单...</span>}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索人员/产品/客户/订单号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-10 text-base"
          />
        </div>
        <Select value={filterUnit} onValueChange={(v) => { setFilterUnit(v); setFilterPerson("all"); }}>
          <SelectTrigger className="h-10 w-44 text-base">
            <SelectValue placeholder="筛选单位" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部单位</SelectItem>
            {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPerson} onValueChange={setFilterPerson}>
          <SelectTrigger className="h-10 w-40 text-base">
            <SelectValue placeholder="筛选人员" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部人员</SelectItem>
            {availablePersonnel.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSync} onValueChange={setFilterSync}>
          <SelectTrigger className="h-10 w-40 text-base">
            <SelectValue placeholder="数据来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部来源</SelectItem>
            <SelectItem value="synced">仅同步</SelectItem>
            <SelectItem value="manual">仅手动</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterDomain} onValueChange={setFilterDomain}>
          <SelectTrigger className="h-10 w-44 text-base">
            <SelectValue placeholder="业务域" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部业务域</SelectItem>
            {domainOptions.map((d) => (
              <SelectItem key={d} value={d}>
                {d === UNCATEGORIZED ? UNCATEGORIZED_LABEL : d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterDuplicate} onValueChange={(v) => setFilterDuplicate(v as "all" | "duplicate" | "unique")}>
          <SelectTrigger className="h-10 w-40 text-base">
            <SelectValue placeholder="重复信息" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部记录</SelectItem>
            <SelectItem value="duplicate">仅重复</SelectItem>
            <SelectItem value="unique">仅非重复</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground whitespace-nowrap">成交日期</span>
          <Input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 w-[150px] text-base"
          />
          <span className="text-sm text-muted-foreground">至</span>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 w-[150px] text-base"
          />
          {(dateFrom || dateTo) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 px-3 text-sm"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
            >
              清除
            </Button>
          )}
        </div>
        <Badge variant="secondary" className="h-8 px-3 text-sm">
          {filteredRecords.length} 笔
        </Badge>
        {duplicateCountInFilters > 0 && (
          <Button
            type="button"
            variant={filterDuplicate === "duplicate" ? "default" : "outline"}
            size="sm"
            className={
              filterDuplicate === "duplicate"
                ? "h-10 rounded-full bg-orange-500 hover:bg-orange-600 text-white border-orange-500 text-sm"
                : "h-10 rounded-full border-orange-300 bg-orange-100 text-orange-800 hover:bg-orange-200 cursor-pointer text-sm"
            }
            onClick={handleToggleDuplicateFilter}
            title={filterDuplicate === "duplicate" ? "点击取消重复筛选" : "点击筛选重复记录并批量操作"}
          >
            重复 {duplicateCountInFilters} 笔
            {filterDuplicate === "duplicate" ? " · 已筛选" : " · 点击筛选"}
          </Button>
        )}
        <Badge
          className="h-8 px-3 text-sm bg-blue-50 text-blue-700"
          title={
            filterPerson !== "all"
              ? "按当前人员份额合计（分业绩只计本人）"
              : filterUnit !== "all"
                ? "按当前单位份额合计（分业绩只计本单位，不含其他单位分摊）"
                : "当前列表实收合计"
          }
        >
          {filterPerson !== "all"
            ? "本人份额 "
            : filterUnit !== "all"
              ? "本单位份额 "
              : "合计 "}
          {formatCurrency(totalRevenue)}
        </Badge>
        <Badge
          className="h-8 px-3 text-sm bg-violet-50 text-violet-700"
          title="按人员管理「人×产品」个人提成+特殊奖励预估（比例不含月门槛）"
        >
          提成预估 {formatCurrency(totalCommission)}
        </Badge>
      </div>

      {filterDuplicate === "duplicate" && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/60 px-4 py-2.5">
          <Badge className="bg-orange-100 text-orange-800">重复记录筛选中</Badge>
          <span className="text-sm text-orange-900">
            当前 {filteredRecords.length} 笔重复，每组自动保留 1 笔，其余可勾选删除
          </span>
          <div className="flex-1" />
          {canEditSales && !isReadOnly && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-orange-300"
                onClick={handleSelectAllFilteredDeletable}
                title="每组完全相同的记录保留 1 笔，自动勾选其余可删项"
              >
                全选多余重复
              </Button>
              {selectedIds.size > 0 && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={clearSelection}
                  >
                    取消选择 ({selectedIds.size})
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8"
                    onClick={() => setBatchDeleteOpen(true)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    批量删除 ({selectedIds.size})
                  </Button>
                </>
              )}
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-orange-800"
            onClick={() => setFilterDuplicate("all")}
          >
            退出筛选
          </Button>
        </div>
      )}

      <Card ref={tableCardRef}>
        <CardContent className="p-0">
          <p className="border-b bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
            表格可左右滑动查看全部列；右侧「操作」已固定。字太小可点右上角「放大 / 更大」。
          </p>
          <Table className="min-w-[1780px] text-base [&_th]:text-base [&_td]:text-base">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-14 w-14 px-3 text-center text-base">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      className="h-5 w-5 cursor-pointer"
                      aria-label={
                        filterDuplicate === "duplicate" ? "全选本页多余重复" : "全选本页"
                      }
                    />
                  </TableHead>
                  <TableHead className="h-14 min-w-[10rem] px-3 text-base">客户姓名</TableHead>
                  <TableHead className="h-14 min-w-[12rem] px-3 text-base">购买产品</TableHead>
                  <TableHead className="h-14 min-w-[7rem] px-3 text-right text-base">订单金额</TableHead>
                  <TableHead className="h-14 min-w-[7rem] px-3 text-right text-base">实收金额</TableHead>
                  <TableHead className="h-14 min-w-[7rem] px-3 text-base">订单类型</TableHead>
                  <TableHead className="h-14 min-w-[8rem] px-3 text-base">销售单位</TableHead>
                  <TableHead className="h-14 min-w-[10rem] px-3 text-base">销售人员</TableHead>
                  <TableHead className="h-14 min-w-[8rem] px-3 text-base">成交日期</TableHead>
                  <TableHead className="h-14 min-w-[10rem] px-3 text-base">参加活动</TableHead>
                  <TableHead className="h-14 min-w-[7rem] px-3 text-right text-base">提成预估</TableHead>
                  <TableHead className="h-14 min-w-[6rem] px-3 text-base">来源</TableHead>
                  <TableHead
                    className={`h-14 min-w-[220px] px-3 text-right text-base bg-background ${SALE_STICKY_OPS}`}
                  >
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRecords.map((record) => {
                  const isDup = duplicateRecordIdSet.has(record.id);
                  const rowTone = isDup
                    ? "bg-orange-50"
                    : record.synced
                      ? (highlightSynced ? "bg-blue-100" : "bg-blue-50")
                      : "bg-background";
                  return (
                  <TableRow
                    key={record.id}
                    className={
                      isDup
                        ? "bg-orange-50"
                        : record.synced
                          ? (highlightSynced
                            ? "bg-blue-100 ring-1 ring-inset ring-blue-300"
                            : "bg-blue-50")
                          : ""
                    }
                  >
                    <TableCell className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                        className="h-5 w-5 cursor-pointer"
                        aria-label="选择该行"
                      />
                    </TableCell>
                    <TableCell className="max-w-[11rem] px-3 py-3">
                      <ExpandableCellText
                        text={record.customerName}
                        label="客户姓名"
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-3">
                      {getProductName(record)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right text-muted-foreground whitespace-nowrap">
                      {record.orderAmount ? formatCurrency(record.orderAmount) : "-"}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right font-bold text-blue-600 whitespace-nowrap">
                      {formatCurrency(
                        filterPerson !== "all" || filterUnit !== "all"
                          ? getFilteredShareAmount(record)
                          : record.totalAmount,
                      )}
                      {(filterPerson !== "all" || filterUnit !== "all")
                        && getSaleShares(record).length >= 2
                        && getFilteredShareAmount(record) !== record.totalAmount
                        && (
                          <div className="text-xs font-normal text-muted-foreground">
                            整单 {formatCurrency(record.totalAmount)}
                          </div>
                        )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      {record.orderType ? (
                        <Badge variant="outline" className="text-sm">{record.orderType}</Badge>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <Badge variant="outline" className="text-sm">{getUnitName(record)}</Badge>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                          {getPersonnelName(record)[0]}
                        </div>
                        {getPersonnelName(record)}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3 font-medium whitespace-nowrap">
                      {formatDate(record.saleDate)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                      {record.activityName && record.activityName !== "无活动" ? (
                        <Badge className="bg-amber-100 text-amber-700 text-sm">
                          {record.activityName}
                        </Badge>
                      ) : (
                        <span className="text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right text-violet-600 font-medium whitespace-nowrap">
                      {(() => {
                        const commission = getFilteredCommission(record);
                        return commission > 0 ? formatCurrency(commission) : "-";
                      })()}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        {record.synced ? (
                          <Badge className="bg-blue-100 text-blue-700 text-sm">生态圈</Badge>
                        ) : (
                          <Badge variant="outline" className="text-sm">手动</Badge>
                        )}
                        {record.collaborators && record.collaborators.length > 1 && (
                          <Badge className="bg-violet-100 text-violet-700 text-sm">分业绩</Badge>
                        )}
                        {isDup && (
                          <button
                            type="button"
                            className="inline-flex"
                            title="查看全部重复记录"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (filterDuplicate !== "duplicate") {
                                setFilterDuplicate("duplicate");
                                setPage(1);
                              }
                            }}
                          >
                            <Badge className="bg-orange-100 text-orange-700 text-sm cursor-pointer hover:bg-orange-200">
                              重复
                            </Badge>
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={`px-3 py-4 text-right ${SALE_STICKY_OPS} ${rowTone}`}>
                      {canEditSales && !isReadOnly ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 min-w-[4.75rem] px-3 text-base"
                            title={record.synced ? "编辑订单分业绩" : "编辑"}
                            onClick={() => openEdit(record)}
                          >
                            <Pencil className="mr-1 h-4 w-4" />
                            编辑
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 min-w-[4.75rem] px-3 text-base text-destructive hover:text-destructive"
                            title={record.synced ? "删除同步订单" : "删除"}
                            onClick={() => setDeleteId(record.id)}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            删除
                          </Button>
                        </div>
                      ) : (
                        <span className="text-base text-muted-foreground">仅查看</span>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          {filteredRecords.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p className="text-sm text-muted-foreground">
                第 {(safePage - 1) * pageSize + 1}
                –
                {Math.min(safePage * pageSize, filteredRecords.length)}
                {" "}条 / 共 {filteredRecords.length} 条（按当前筛选）
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => setPageSize(Number(v))}
                >
                  <SelectTrigger className="h-10 w-[110px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20">20 条/页</SelectItem>
                    <SelectItem value="50">50 条/页</SelectItem>
                    <SelectItem value="100">100 条/页</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-4"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </Button>
                <span className="text-base tabular-nums min-w-[4.5rem] text-center">
                  {safePage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-4"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一页
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRecord
                ? (isEditingSynced ? "编辑生态圈订单（分业绩）" : "编辑销售记录")
                : "新增销售记录"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {isEditingSynced && (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                生态圈订单：金额/产品/日期等由同步维护；可改主责人与订单分业绩，下次同步不会覆盖分摊。
              </p>
            )}
            <div className="space-y-2">
              <Label>客户姓名</Label>
              <Input
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                placeholder="客户名称"
                disabled={isEditingSynced}
              />
            </div>
            {!isSplitPerformance && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>销售单位 *</Label>
                  <Select
                    value={form.salesUnitId}
                    onValueChange={handleUnitChange}
                    disabled={isEditingSynced}
                  >
                    <SelectTrigger><SelectValue placeholder="选择单位" /></SelectTrigger>
                    <SelectContent>
                      {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>主责销售 *</Label>
                  <Select
                    value={form.personnelId}
                    onValueChange={(v) => {
                      const person = personnel.find((p) => p.id === v);
                      const unitId = person
                        ? resolveUnitIdAt(person, form.saleDate) || form.salesUnitId
                        : form.salesUnitId;
                      setForm({ ...form, personnelId: v, salesUnitId: unitId });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="选择人员" /></SelectTrigger>
                    <SelectContent>
                      {formPersonnel.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name} - {p.position}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-violet-600" />
                  <div>
                    <Label className="mb-0">订单分业绩</Label>
                    <p className="text-[11px] text-muted-foreground">
                      {isSplitPerformance
                        ? "主责固定为录单人，仅改比例/金额；其他人可选本单位或跨单位"
                        : "开启后主责默认为录单人，再添加其他人分摊"}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant={isSplitPerformance ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (isSplitPerformance) {
                      const first = collaborators[0];
                      if (first?.personnelId) {
                        setForm((prev) => ({
                          ...prev,
                          personnelId: first.personnelId,
                          salesUnitId:
                            first.salesUnitId || getShareUnitId(first) || prev.salesUnitId,
                        }));
                      }
                      setIsSplitPerformance(false);
                      return;
                    }
                    const primary = ensureRecorderOnForm();
                    if (!primary.personnelId) {
                      alert("未匹配到当前登录人对应的销售人员，请先在人员管理中维护同名人员");
                      return;
                    }
                    setIsSplitPerformance(true);
                    setCollaborators(
                      buildDefaultShares(
                        primary.personnelId,
                        shareMode,
                        form.quantity * form.unitPrice,
                        "",
                        primary.salesUnitId,
                        primary.salesUnitId,
                      ),
                    );
                  }}
                >
                  {isSplitPerformance ? "取消分业绩" : "开启分业绩"}
                </Button>
              </div>
              {isSplitPerformance && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">分摊方式</span>
                    <Button
                      type="button"
                      size="sm"
                      variant={shareMode === "percent" ? "default" : "outline"}
                      onClick={() => handleChangeShareMode("percent")}
                    >
                      按比例
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={shareMode === "amount" ? "default" : "outline"}
                      onClick={() => handleChangeShareMode("amount")}
                    >
                      固定金额
                    </Button>
                  </div>
                  {collaborators.map((c, idx) => {
                    const rowUnitId = getShareUnitId(c);
                    const peopleInUnit = getPersonnelForShareUnit(rowUnitId);
                    if (idx === 0) {
                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-[1fr_110px_auto] gap-2 items-center"
                        >
                          <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                            <span className="truncate">{getPrimaryShareLabel(c)}</span>
                            <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                              （录单主责，无需再选）
                            </span>
                          </div>
                          <div className="relative">
                            {shareMode === "percent" ? (
                              <>
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={c.sharePercent ?? ""}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setCollaborators((prev) => {
                                      const next = [...prev];
                                      next[0] = { ...next[0], sharePercent: val };
                                      return next;
                                    });
                                  }}
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                  %
                                </span>
                              </>
                            ) : (
                              <>
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  value={c.shareAmount ?? ""}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setCollaborators((prev) => {
                                      const next = [...prev];
                                      next[0] = { ...next[0], shareAmount: val };
                                      return next;
                                    });
                                  }}
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                  元
                                </span>
                              </>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground text-center">主责</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_1fr_110px_auto] gap-2 items-center"
                      >
                        <Select
                          value={rowUnitId || undefined}
                          onValueChange={(unitId) => {
                            setCollaborators((prev) => {
                              const next = [...prev];
                              const prevPersonOk = next[idx].personnelId
                                && getPersonnelForShareUnit(unitId)
                                  .some((p) => p.id === next[idx].personnelId);
                              next[idx] = {
                                ...next[idx],
                                salesUnitId: unitId,
                                personnelId: prevPersonOk ? next[idx].personnelId : "",
                              };
                              return next;
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="销售单位" />
                          </SelectTrigger>
                          <SelectContent>
                            {salesUnits.map((u) => (
                              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={c.personnelId || undefined}
                          onValueChange={(v) => {
                            setCollaborators((prev) => {
                              const next = [...prev];
                              next[idx] = {
                                ...next[idx],
                                personnelId: v,
                                salesUnitId: rowUnitId || next[idx].salesUnitId,
                              };
                              return next;
                            });
                          }}
                          disabled={!rowUnitId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择人员" />
                          </SelectTrigger>
                          <SelectContent>
                            {peopleInUnit.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="relative">
                          {shareMode === "percent" ? (
                            <>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={1}
                                value={c.sharePercent ?? ""}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setCollaborators((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], sharePercent: val };
                                    return next;
                                  });
                                }}
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                %
                              </span>
                            </>
                          ) : (
                            <>
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                value={c.shareAmount ?? ""}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setCollaborators((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], shareAmount: val };
                                    return next;
                                  });
                                }}
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                元
                              </span>
                            </>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setCollaborators((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCollaborators((prev) => [
                          ...prev,
                          shareMode === "amount"
                            ? {
                              personnelId: "",
                              salesUnitId: form.salesUnitId || "",
                              shareAmount: 0,
                            }
                            : {
                              personnelId: "",
                              salesUnitId: form.salesUnitId || "",
                              sharePercent: 0,
                            },
                        ])
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      添加人员
                    </Button>
                    {shareMode === "percent" ? (
                      <span
                        className={
                          `text-xs ${
                            Math.abs(getCollaboratorsShareSum(collaborators) - 100) < 0.01
                              ? "text-emerald-600"
                              : "text-amber-600"
                          }`
                        }
                      >
                        合计 {getCollaboratorsShareSum(collaborators).toFixed(1)}%
                      </span>
                    ) : (
                      <span
                        className={
                          `text-xs ${
                            Math.abs(
                              getCollaboratorsAmountSum(collaborators) - totalAmount,
                            ) < 0.05
                              ? "text-emerald-600"
                              : "text-amber-600"
                          }`
                        }
                      >
                        合计 {formatCurrency(getCollaboratorsAmountSum(collaborators))}
                        {" / "}
                        {formatCurrency(totalAmount)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>销售产品 *</Label>
              <Select
                value={form.productId}
                onValueChange={handleProductChange}
                disabled={isEditingSynced}
              >
                <SelectTrigger><SelectValue placeholder="选择产品" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} - {formatCurrency(p.unitPrice)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>数量</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  disabled={isEditingSynced}
                />
              </div>
              <div className="space-y-2">
                <Label>单价 (¥)</Label>
                <Input
                  type="number"
                  value={form.unitPrice}
                  onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })}
                  disabled={isEditingSynced}
                />
              </div>
              <div className="space-y-2">
                <Label>销售日期</Label>
                <Input
                  type="date"
                  value={form.saleDate}
                  onChange={(e) => {
                    const saleDate = e.target.value;
                    const person = personnel.find((p) => p.id === form.personnelId);
                    const salesUnitId = person
                      ? resolveUnitIdAt(person, saleDate) || form.salesUnitId
                      : form.salesUnitId;
                    setForm({ ...form, saleDate, salesUnitId });
                  }}
                  disabled={isEditingSynced}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>订单类型</Label>
                <Select
                  value={form.orderType}
                  onValueChange={(v) => setForm({ ...form, orderType: v })}
                  disabled={isEditingSynced}
                >
                  <SelectTrigger><SelectValue placeholder="选择类型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="新购">新购</SelectItem>
                    <SelectItem value="续费">续费</SelectItem>
                    <SelectItem value="升级">升级</SelectItem>
                    <SelectItem value="增购">增购</SelectItem>
                    <SelectItem value="退款">退款</SelectItem>
                    <SelectItem value="其他">其他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>参加活动</Label>
                <Input
                  value={form.activityName}
                  onChange={(e) => setForm({ ...form, activityName: e.target.value })}
                  placeholder="如：小游戏风月庆 / 无活动"
                  disabled={isEditingSynced}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>订单金额 (¥)</Label>
                <Input
                  type="number"
                  value={form.orderAmount}
                  onChange={(e) => setForm({ ...form, orderAmount: Number(e.target.value) })}
                  placeholder="原价"
                  disabled={isEditingSynced}
                />
              </div>
              <div className="rounded-lg bg-primary/5 p-3 flex flex-col justify-center">
                <span className="text-sm text-muted-foreground">实收金额</span>
                <span className="text-lg font-bold text-primary">{formatCurrency(totalAmount)}</span>
              </div>
              {(() => {
                const commission = calcSalePersonCommissionPreview(
                  {
                    productId: form.productId,
                    salesUnitId: form.salesUnitId,
                    personnelId: form.personnelId,
                    quantity: form.quantity,
                    totalAmount,
                    saleDate: form.saleDate,
                  },
                  ppcList,
                );
                const primaryShareAmt = isSplitPerformance
                  ? getPersonShareAmount(
                    {
                      personnelId: form.personnelId,
                      collaborators,
                      shareMode,
                      totalAmount,
                    },
                    form.personnelId,
                  )
                  : totalAmount;
                const primaryShare = totalAmount > 0 ? primaryShareAmt / totalAmount : 1;
                const shown = commission * primaryShare;
                return (
                  <div className="rounded-lg bg-violet-50 p-3 flex flex-col justify-center">
                    <span className="text-sm text-violet-700">
                      {isSplitPerformance ? "主责提成预估" : "提成预估"}
                    </span>
                    <span className="text-lg font-bold text-violet-700">{formatCurrency(shown)}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">按成本管理配置</span>
                  </div>
                );
              })()}
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="备注信息" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingRecord ? "保存" : "新增"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量导入 Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              批量导入销售记录
            </DialogTitle>
          </DialogHeader>

          {importStep === "input" && (
            <div className="flex-1 overflow-y-auto space-y-4 py-2">
              {/* 说明区 */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
                <p className="text-sm font-medium text-emerald-800">导入说明</p>
                <ul className="text-xs text-emerald-700 space-y-1 list-disc list-inside">
                  <li>支持从 Excel 直接粘贴（复制单元格后粘贴到文本框），或上传 .xls / .xlsx / .csv 文件</li>
                  <li>表头需包含以下10列（与你的表格一致，系统会自动识别）：</li>
                </ul>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {["客户姓名", "产品类别", "购买产品", "订单金额", "实收金额", "订单类型", "销售单位", "销售人员", "成交日期", "参加活动"].map((col) => (
                    <Badge key={col} className="bg-emerald-100 text-emerald-700 text-xs">{col}</Badge>
                  ))}
                </div>
                <p className="text-xs text-emerald-700 mt-2">
                  产品类别仅用于导入识别，列表中不展示。
                  系统会自动按名称匹配已有的销售单位、人员和产品。
                  <strong className="text-foreground">未匹配到的产品会自动建档；单位已匹配且填写了销售人员时，会自动创建销售人员并归属该单位</strong>，
                  随后可在「产品结算设置」配置结算规则，在「成本管理」配置销售提成。
                </p>
                <Button variant="link" size="sm" onClick={handleDownloadTemplate} className="p-0 h-auto text-emerald-700">
                  下载导入模板
                </Button>
              </div>

              {/* 输入区 */}
              <Tabs defaultValue="paste">
                <TabsList>
                  <TabsTrigger value="paste">粘贴数据</TabsTrigger>
                  <TabsTrigger value="upload">上传Excel/CSV文件</TabsTrigger>
                </TabsList>
                <TabsContent value="paste" className="space-y-2">
                  <Textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={"客户姓名\t产品类别\t购买产品\t订单金额\t实收金额\t订单类型\t销售单位\t销售人员\t成交日期\t参加活动\n杭州科技有限公司\t智能硬件\t智能终端Pro\t50000\t48000\t新购\t华东销售部\t张三\t2026-08-03\t无活动"}
                    className="min-h-[200px] font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">提示：在 Excel 中选中数据区域，Ctrl+C 复制后直接粘贴到上方文本框</p>
                </TabsContent>
                <TabsContent value="upload" className="space-y-2">
                  <div
                    className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-emerald-400 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium">点击选择 Excel 或 CSV 文件</p>
                    <p className="text-xs text-muted-foreground mt-1">支持 .xls / .xlsx / .csv 格式</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xls,.xlsx,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </div>
                  {importText && (
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <p className="text-muted-foreground mb-1">文件已加载，预览前3行：</p>
                      <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{importText.split("\n").slice(0, 3).join("\n")}</pre>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {importStep === "preview" && (
            <div className="flex-1 overflow-hidden flex flex-col space-y-3">
              {/* 预览统计 */}
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="secondary">共 {importStats.total} 行</Badge>
                <Badge className="bg-emerald-100 text-emerald-700">已选 {importStats.selected} 行</Badge>
                {importStats.duplicates > 0 && (
                  <Badge className="bg-orange-100 text-orange-700">
                    重复 {importStats.duplicates}（可正常导入）
                  </Badge>
                )}
                <Select
                  value={importDupFilter}
                  onValueChange={(v) => setImportDupFilter(v as "all" | "duplicate" | "unique")}
                >
                  <SelectTrigger className="w-36 h-8"><SelectValue placeholder="重复筛选" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部预览</SelectItem>
                    <SelectItem value="duplicate">仅重复</SelectItem>
                    <SelectItem value="unique">仅非重复</SelectItem>
                  </SelectContent>
                </Select>
                <Badge className="bg-green-100 text-green-700">全部匹配 {importStats.allMatched}</Badge>
                {importStats.partialMatched > 0 && (
                  <Badge className="bg-amber-100 text-amber-700">部分匹配 {importStats.partialMatched}</Badge>
                )}
                {importStats.noMatch > 0 && (
                  <Badge className="bg-red-100 text-red-700">未匹配 {importStats.noMatch}</Badge>
                )}
                <Badge className="bg-blue-100 text-blue-700">合计金额 {formatCurrency(importStats.totalAmount)}</Badge>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => toggleAllSelection(true)}>全选</Button>
                <Button variant="outline" size="sm" onClick={() => toggleAllSelection(false)}>全不选</Button>
                <Button variant="outline" size="sm" onClick={() => setImportStep("input")}>返回修改</Button>
              </div>

              {/* 预览表格 */}
              <div className="flex-1 overflow-auto border rounded-lg">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-10 text-center">选</TableHead>
                      <TableHead className="w-10 text-center">行</TableHead>
                      <TableHead>客户姓名</TableHead>
                      <TableHead>购买产品</TableHead>
                      <TableHead className="text-right">订单金额</TableHead>
                      <TableHead className="text-right">实收金额</TableHead>
                      <TableHead>订单类型</TableHead>
                      <TableHead>销售单位</TableHead>
                      <TableHead>销售人员</TableHead>
                      <TableHead>成交日期</TableHead>
                      <TableHead>参加活动</TableHead>
                      <TableHead>匹配状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewImportRows.map((row) => {
                      const allMatched = row.unitMatched && row.personMatched && row.productMatched;
                      const anyMatched = row.unitMatched || row.personMatched || row.productMatched;
                      return (
                        <TableRow
                          key={row.rowIndex}
                          className={
                            row.isDuplicate
                              ? "bg-orange-50/60"
                              : row.selected
                                ? ""
                                : "opacity-40"
                          }
                        >
                          <TableCell className="text-center">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              onChange={() => toggleRowSelection(row.rowIndex)}
                              className="h-4 w-4 cursor-pointer"
                            />
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">{row.rowIndex}</TableCell>
                          <TableCell className="max-w-[9.5rem]">
                            <ExpandableCellText
                              text={row.customerName}
                              label="客户姓名"
                            />
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.productName}
                            {row.productMatched ? (
                              <CheckCircle2 className="inline ml-1 h-3.5 w-3.5 text-green-500" />
                            ) : row.productName ? (
                              <Badge className="ml-1 bg-sky-100 text-sky-700 text-[10px]">将自动创建</Badge>
                            ) : (
                              <AlertCircle className="inline ml-1 h-3.5 w-3.5 text-red-400" />
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{row.orderAmount > 0 ? formatCurrency(row.orderAmount) : "-"}</TableCell>
                          <TableCell className="text-right text-sm font-medium text-blue-600">{formatCurrency(row.totalAmount)}</TableCell>
                          <TableCell className="text-sm">{row.orderType ? <Badge variant="outline" className="text-xs">{row.orderType}</Badge> : "-"}</TableCell>
                          <TableCell className="text-sm">
                            {row.salesUnitName}
                            {row.unitMatched ? (
                              <CheckCircle2 className="inline ml-1 h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <AlertCircle className="inline ml-1 h-3.5 w-3.5 text-red-400" />
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="flex flex-col gap-0.5">
                              <span>
                                {row.salesPersonName || "-"}
                                {row.personMatched ? (
                                  <CheckCircle2 className="inline ml-1 h-3.5 w-3.5 text-green-500" />
                                ) : row.salesPersonName && row.unitMatched ? (
                                  <CheckCircle2 className="inline ml-1 h-3.5 w-3.5 text-amber-500" />
                                ) : row.salesPersonName ? (
                                  <AlertCircle className="inline ml-1 h-3.5 w-3.5 text-red-400" />
                                ) : null}
                              </span>
                              {!row.personMatched && row.salesPersonName && row.unitMatched && (
                                <span className="text-[10px] text-amber-600">导入时自动创建</span>
                              )}
                              {!row.personMatched && row.salesPersonName && !row.unitMatched && (
                                <span className="text-[10px] text-red-500">需先匹配销售单位</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{row.saleDate}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.activityName || "-"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {row.isDuplicate && (
                                <Badge className="bg-orange-100 text-orange-700 text-xs w-fit">
                                  {row.duplicateReason || "完全相同"}
                                </Badge>
                              )}
                              {allMatched ? (
                                <Badge className="bg-green-100 text-green-700 text-xs w-fit">全部匹配</Badge>
                              ) : anyMatched ? (
                                <Badge className="bg-amber-100 text-amber-700 text-xs w-fit">部分匹配</Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-700 text-xs w-fit">未匹配</Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* 提示 */}
              {importStats.duplicates > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3 text-xs text-orange-800">
                  <p className="font-medium">检测到与系统或表内完全相同的数据：</p>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    <li>重复行默认仍勾选，确认后会作为新记录正常导入</li>
                    <li>可用上方「重复筛选」只看重复 / 非重复行</li>
                    <li>比对字段：客户、产品、订单/实收金额、订单类型、单位、人员、成交日期、活动</li>
                  </ul>
                </div>
              )}
              {(importStats.noMatch > 0 || importStats.partialMatched > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-700">
                  <p className="font-medium">部分数据未完全匹配，说明：</p>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    <li>带「将自动创建」的产品会在导入时自动建档</li>
                    <li>销售单位建议与系统名称一致；销售人员在单位匹配成功后会自动匹配或创建</li>
                    <li>导入后请到「产品结算设置」配置各单位结算规则，到「成本管理」配置人员销售提成</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {importStep === "input" ? (
              <>
                <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
                <Button onClick={handleParsePreview} disabled={!importText.trim()}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />解析预览
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setImportStep("input")}>返回修改</Button>
                <Button onClick={handleConfirmImport} disabled={importing || importStats.selected === 0}>
                  {importing ? (
                    <>导入中...</>
                  ) : (
                    <><CheckCircle2 className="mr-2 h-4 w-4" />确认导入 {importStats.selected} 条</>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除该销售记录吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 批量删除确认 */}
      <AlertDialog open={batchDeleteOpen} onOpenChange={(open) => !open && setBatchDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedIds.size} 条销售记录吗？此操作不可撤销。
              {filterDuplicate === "duplicate"
                ? "每组完全相同的记录会自动保留 1 笔。"
                : "包含生态圈同步订单时也将一并删除。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
