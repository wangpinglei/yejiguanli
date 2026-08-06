import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { calcSalePersonCommissionPreview } from "@/lib/commissionReward";
import type { SalesRecord } from "@/types";
import { Plus, Search, Pencil, Trash2, RefreshCw, CloudDownload, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
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

/** 长文本截断，点击展开查看全文 */
function ExpandableCellText({
  text,
  emptyText = "-",
  label = "完整内容",
  maxLen = 10,
  className = "max-w-[9rem]",
}: {
  text?: string;
  emptyText?: string;
  label?: string;
  maxLen?: number;
  className?: string;
}) {
  const value = (text || "").trim();
  if (!value) {
    return <span className="text-sm text-muted-foreground">{emptyText}</span>;
  }
  if (value.length <= maxLen) {
    return <span className="text-sm">{value}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            `block w-full truncate text-left text-sm text-primary hover:underline cursor-pointer ${className}`
          }
          title="点击查看完整内容"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[min(20rem,90vw)] p-3">
        <p className="mb-1 text-xs text-muted-foreground">{label}</p>
        <p className="text-sm break-all whitespace-pre-wrap">{value}</p>
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

/** 用于判断「全部一模一样」的指纹 */
function buildSalesImportFingerprint(r: {
  customerName?: string;
  productName?: string;
  productId?: string;
  orderAmount?: number;
  totalAmount?: number;
  orderType?: string;
  salesUnitId?: string;
  salesUnitName?: string;
  personnelId?: string;
  salesPersonName?: string;
  saleDate?: string;
  activityName?: string;
}): string {
  return [
    (r.customerName || "").trim().toLowerCase(),
    (r.productName || "").trim().toLowerCase() || (r.productId || ""),
    Number(r.orderAmount || 0).toFixed(2),
    Number(r.totalAmount || 0).toFixed(2),
    (r.orderType || "").trim().toLowerCase(),
    (r.salesUnitId || "").trim() || (r.salesUnitName || "").trim().toLowerCase(),
    (r.personnelId || "").trim() || (r.salesPersonName || "").trim().toLowerCase(),
    (r.saleDate || "").slice(0, 10),
    (r.activityName || "").trim().toLowerCase(),
  ].join("|");
}

function markDuplicateImportRows(
  rows: ImportRow[],
  existing: SalesRecord[],
  productList: { id: string; name: string }[]
): ImportRow[] {
  const idToProductName = new Map(productList.map((p) => [p.id, p.name || ""]));
  const existingByKey = new Map<string, string>();
  for (const s of existing) {
    const key = buildSalesImportFingerprint({
      customerName: s.customerName,
      productName: s.productName || idToProductName.get(s.productId || "") || "",
      productId: s.productId,
      orderAmount: s.orderAmount,
      totalAmount: s.totalAmount,
      orderType: s.orderType,
      salesUnitId: s.salesUnitId,
      salesUnitName: s.salesUnitName,
      personnelId: s.personnelId,
      salesPersonName: s.salesPersonName,
      saleDate: s.saleDate,
      activityName: s.activityName,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, s.id);
  }

  const seenInFile = new Set<string>();
  return rows.map((row) => {
    const key = buildSalesImportFingerprint({
      customerName: row.customerName,
      productName: row.productName,
      productId: row.matchedProductId,
      orderAmount: row.orderAmount,
      totalAmount: row.totalAmount,
      orderType: row.orderType,
      salesUnitId: row.matchedUnitId,
      salesUnitName: row.salesUnitName,
      personnelId: row.matchedPersonId,
      salesPersonName: row.salesPersonName,
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
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords, canEditSales, isReadOnly } = usePermissions();
  const [search, setSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState("all");
  const [filterPerson, setFilterPerson] = useState("all");
  const [filterSync, setFilterSync] = useState("all"); // all | manual | synced
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

  /** 系统中「内容完全相同」的销售记录 id（出现次数 > 1） */
  const duplicateRecordIdSet = useMemo(() => {
    const idToProductName = new Map(products.map((p) => [p.id, p.name || ""]));
    const keyCounts = new Map<string, number>();
    const idToKey = new Map<string, string>();
    for (const s of salesRecords) {
      const key = buildSalesImportFingerprint({
        customerName: s.customerName,
        productName: s.productName || idToProductName.get(s.productId || "") || "",
        productId: s.productId,
        orderAmount: s.orderAmount,
        totalAmount: s.totalAmount,
        orderType: s.orderType,
        salesUnitId: s.salesUnitId,
        salesUnitName: s.salesUnitName,
        personnelId: s.personnelId,
        salesPersonName: s.salesPersonName,
        saleDate: s.saleDate,
        activityName: s.activityName,
      });
      idToKey.set(s.id, key);
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
    const set = new Set<string>();
    idToKey.forEach((key, id) => {
      if ((keyCounts.get(key) || 0) > 1) set.add(id);
    });
    return set;
  }, [salesRecords, products]);

  const filteredRecords = useMemo(() => {
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
        const matchUnit = filterUnit === "all" || s.salesUnitId === filterUnit;
        const matchPerson = filterPerson === "all" || s.personnelId === filterPerson;
        const matchSync = filterSync === "all" || (filterSync === "synced" ? s.synced : !s.synced);
        const isDup = duplicateRecordIdSet.has(s.id);
        const matchDuplicate =
          filterDuplicate === "all"
          || (filterDuplicate === "duplicate" && isDup)
          || (filterDuplicate === "unique" && !isDup);
        const saleDate = (s.saleDate || "").slice(0, 10);
        const matchFrom = !dateFrom || saleDate >= dateFrom;
        const matchTo = !dateTo || saleDate <= dateTo;
        return matchSearch && matchUnit && matchPerson && matchSync && matchDuplicate && matchFrom && matchTo;
      })
      .sort((a, b) => (b.saleDate || "").localeCompare(a.saleDate || ""));
  }, [salesRecords, personnel, products, search, filterUnit, filterPerson, filterSync, filterDuplicate, duplicateRecordIdSet, dateFrom, dateTo]);

  // 筛选条件变化时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [search, filterUnit, filterPerson, filterSync, filterDuplicate, dateFrom, dateTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRecords = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, safePage, pageSize]);

  // 统计
  const syncedCount = useMemo(() => salesRecords.filter((s) => s.synced).length, [salesRecords]);
  const manualCount = useMemo(() => salesRecords.filter((s) => !s.synced).length, [salesRecords]);

  // 可批量删除的记录（当前页 + 非同步）
  const selectableRecords = useMemo(
    () => pagedRecords.filter((s) => !s.synced),
    [pagedRecords],
  );
  const allSelected = selectableRecords.length > 0 && selectableRecords.every((s) => selectedIds.has(s.id));
  const someSelected = selectableRecords.some((s) => selectedIds.has(s.id));

  // 根据筛选单位过滤人员
  const availablePersonnel = useMemo(() => {
    if (filterUnit === "all") return personnel;
    return personnel.filter((p) => p.salesUnitId === filterUnit);
  }, [personnel, filterUnit]);

  // 表单中根据选择的单位过滤人员
  const formPersonnel = useMemo(() => {
    if (!form.salesUnitId) return personnel;
    return personnel.filter((p) => p.salesUnitId === form.salesUnitId);
  }, [personnel, form.salesUnitId]);

  const getUnitName = (s: SalesRecord) => {
    if (s.salesUnitId) return salesUnits.find((u) => u.id === s.salesUnitId)?.name || s.salesUnitName || "-";
    return s.salesUnitName || "（未匹配）";
  };
  const getPersonnelName = (s: SalesRecord) => {
    if (s.personnelId) return personnel.find((p) => p.id === s.personnelId)?.name || s.salesPersonName || "-";
    return s.salesPersonName || "（未匹配）";
  };
  const getProductName = (s: SalesRecord) => {
    if (s.productId) return products.find((p) => p.id === s.productId)?.name || s.productName || "-";
    return s.productName || "（未匹配）";
  };

  const totalAmount = form.quantity * form.unitPrice;

  const openAdd = () => {
    setEditingRecord(null);
    setForm({
      salesUnitId: salesUnits[0]?.id || "",
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
    setDialogOpen(true);
  };

  const openEdit = (record: SalesRecord) => {
    if (record.synced) return; // 同步记录不可编辑
    setEditingRecord(record);
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

  const handleProductChange = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    setForm({ ...form, productId, unitPrice: product?.unitPrice || 0 });
  };

  const handleUnitChange = (unitId: string) => {
    setForm({ ...form, salesUnitId: unitId, personnelId: "" });
  };

  const handleSubmit = async () => {
    if (!form.salesUnitId || !form.personnelId || !form.productId) return;
    try {
      if (editingRecord) {
        await updateSalesRecord(editingRecord.id, form);
      } else {
        await addSalesRecord(form);
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
    setSelectedIds(select ? new Set(selectableRecords.map((s) => s.id)) : new Set());
  };
  const clearSelection = () => setSelectedIds(new Set());

  // 批量删除（同步记录跳过）
  const handleBatchDelete = async () => {
    try {
      const ids = Array.from(selectedIds).filter((id) => {
        const r = salesRecords.find((s) => s.id === id);
        return r && !r.synced;
      });
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

  const totalRevenue = filteredRecords.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCommission = filteredRecords.reduce(
    (sum, s) => sum + calcSalePersonCommissionPreview(s, ppcList),
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
    const marked = markDuplicateImportRows(rows, salesRecords, products);
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
          <div className="flex gap-2">
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

      {/* 同步状态卡片 */}
      {(syncedCount > 0 || syncedLoading) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-2.5">
          <CloudDownload className="h-5 w-5 text-blue-500" />
          <div className="flex flex-1 items-center gap-4 text-sm">
            <span className="text-muted-foreground">生态圈同步：</span>
            <Badge className="bg-blue-100 text-blue-700">{syncedCount} 笔同步订单</Badge>
            <Badge variant="secondary">{manualCount} 笔手动记录</Badge>
            {syncedLoading && <span className="text-blue-500">正在拉取最新订单...</span>}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜索人员/产品/客户/订单号..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterUnit} onValueChange={(v) => { setFilterUnit(v); setFilterPerson("all"); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="筛选单位" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部单位</SelectItem>
            {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPerson} onValueChange={setFilterPerson}>
          <SelectTrigger className="w-36"><SelectValue placeholder="筛选人员" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部人员</SelectItem>
            {availablePersonnel.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSync} onValueChange={setFilterSync}>
          <SelectTrigger className="w-36"><SelectValue placeholder="数据来源" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部来源</SelectItem>
            <SelectItem value="synced">仅同步</SelectItem>
            <SelectItem value="manual">仅手动</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterDuplicate} onValueChange={(v) => setFilterDuplicate(v as "all" | "duplicate" | "unique")}>
          <SelectTrigger className="w-36"><SelectValue placeholder="重复信息" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部记录</SelectItem>
            <SelectItem value="duplicate">仅重复</SelectItem>
            <SelectItem value="unique">仅非重复</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">成交日期</span>
          <Input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[140px]"
          />
          <span className="text-xs text-muted-foreground">至</span>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[140px]"
          />
          {(dateFrom || dateTo) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
            >
              清除
            </Button>
          )}
        </div>
        <Badge variant="secondary">{filteredRecords.length} 笔</Badge>
        {duplicateRecordIdSet.size > 0 && (
          <Badge className="bg-orange-100 text-orange-700">
            重复 {duplicateRecordIdSet.size} 笔
          </Badge>
        )}
        <Badge className="bg-blue-50 text-blue-700">合计 {formatCurrency(totalRevenue)}</Badge>
        <Badge className="bg-violet-50 text-violet-700" title="按成本管理「单位×人员」个人提成+特殊奖励预估（比例不含月门槛）">
          提成预估 {formatCurrency(totalCommission)}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      className="h-4 w-4 cursor-pointer"
                      aria-label="全选本页"
                    />
                  </TableHead>
                  <TableHead className="w-[9.5rem]">客户姓名</TableHead>
                  <TableHead>购买产品</TableHead>
                  <TableHead className="text-right">订单金额</TableHead>
                  <TableHead className="text-right">实收金额</TableHead>
                  <TableHead>订单类型</TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead>销售人员</TableHead>
                  <TableHead>成交日期</TableHead>
                  <TableHead>参加活动</TableHead>
                  <TableHead className="text-right">提成预估</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRecords.map((record) => (
                  <TableRow
                    key={record.id}
                    className={
                      duplicateRecordIdSet.has(record.id)
                        ? "bg-orange-50/40"
                        : record.synced
                          ? "bg-blue-50/30"
                          : ""
                    }
                  >
                    <TableCell className="text-center">
                      {record.synced ? (
                        <span className="text-xs text-muted-foreground">只读</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
                          className="h-4 w-4 cursor-pointer"
                          aria-label="选择该行"
                        />
                      )}
                    </TableCell>
                    <TableCell className="max-w-[9.5rem]">
                      <ExpandableCellText
                        text={record.customerName}
                        label="客户姓名"
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{getProductName(record)}</TableCell>
                    <TableCell className="text-right text-muted-foreground whitespace-nowrap">{record.orderAmount ? formatCurrency(record.orderAmount) : "-"}</TableCell>
                    <TableCell className="text-right font-bold text-blue-600 whitespace-nowrap">{formatCurrency(record.totalAmount)}</TableCell>
                    <TableCell>
                      {record.orderType ? (
                        <Badge variant="outline" className="text-xs">{record.orderType}</Badge>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getUnitName(record)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {getPersonnelName(record)[0]}
                        </div>
                        {getPersonnelName(record)}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{formatDate(record.saleDate)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {record.activityName && record.activityName !== "无活动" ? (
                        <Badge className="bg-amber-100 text-amber-700 text-xs">{record.activityName}</Badge>
                      ) : (
                        <span className="text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-violet-600 font-medium whitespace-nowrap">
                      {(() => {
                        const commission = calcSalePersonCommissionPreview(record, ppcList);
                        return commission > 0 ? formatCurrency(commission) : "-";
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        {record.synced ? (
                          <Badge className="bg-blue-100 text-blue-700 text-xs">生态圈</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">手动</Badge>
                        )}
                        {duplicateRecordIdSet.has(record.id) && (
                          <Badge className="bg-orange-100 text-orange-700 text-xs">重复</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {record.synced ? (
                        <span className="text-xs text-muted-foreground">只读</span>
                      ) : canEditSales && !isReadOnly ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(record)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteId(record.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">仅查看</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">暂无数据</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {filteredRecords.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
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
                  <SelectTrigger className="h-8 w-[100px]">
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
                  size="sm"
                  className="h-8"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </Button>
                <span className="text-sm tabular-nums min-w-[4.5rem] text-center">
                  {safePage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
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

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRecord ? "编辑销售记录" : "新增销售记录"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>客户姓名</Label>
              <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="客户名称" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>销售单位 *</Label>
                <Select value={form.salesUnitId} onValueChange={handleUnitChange}>
                  <SelectTrigger><SelectValue placeholder="选择单位" /></SelectTrigger>
                  <SelectContent>
                    {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>销售人员 *</Label>
                <Select value={form.personnelId} onValueChange={(v) => setForm({ ...form, personnelId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择人员" /></SelectTrigger>
                  <SelectContent>
                    {formPersonnel.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} - {p.position}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>销售产品 *</Label>
              <Select value={form.productId} onValueChange={handleProductChange}>
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
                <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>单价 (¥)</Label>
                <Input type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>销售日期</Label>
                <Input type="date" value={form.saleDate} onChange={(e) => setForm({ ...form, saleDate: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>订单类型</Label>
                <Select value={form.orderType} onValueChange={(v) => setForm({ ...form, orderType: v })}>
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
                <Input value={form.activityName} onChange={(e) => setForm({ ...form, activityName: e.target.value })} placeholder="如：小游戏风月庆 / 无活动" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>订单金额 (¥)</Label>
                <Input type="number" value={form.orderAmount} onChange={(e) => setForm({ ...form, orderAmount: Number(e.target.value) })} placeholder="原价" />
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
                return (
                  <div className="rounded-lg bg-violet-50 p-3 flex flex-col justify-center">
                    <span className="text-sm text-violet-700">提成预估</span>
                    <span className="text-lg font-bold text-violet-700">{formatCurrency(commission)}</span>
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
              确定要删除选中的 {selectedIds.size} 条销售记录吗？此操作不可撤销。（生态圈同步记录不可删除）
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
