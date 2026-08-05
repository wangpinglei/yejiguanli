import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/format";
import { getTotalSalaryCost, filterByMonth, calcUnitCost } from "@/lib/salary";
import type { Product, SalesRecord, UnitProductSettlement } from "@/types";
import {
  Plus, Search, Pencil, Trash2, Package, Percent,
  ChevronDown, ChevronRight, TrendingUp, DollarSign,
  Calculator, Users, Wallet, Download,
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const defaultForm = {
  name: "",
  category: "",
  salesUnitId: "",
  unitPrice: 0,
  costType: "percentage" as "percentage" | "fixed",
  unitCost: 0,
  costRate: 0,
  description: "",
  commissionType: "percentage" as "percentage" | "fixed",
  commissionRate: 0,
  commissionAmount: 0,
  commissionNote: "",
};

export default function Products() {
  const { products, addProduct, updateProduct, deleteProduct, monthlyAdjustments, upsertUnitProductSettlement } = useData();
  const {
    visibleSalesRecords: salesRecords,
    visibleSalesUnits: salesUnits,
    visiblePersonnel: personnel,
    visibleUnitProductSettlements: unitProductSettlements,
    canEditProduct, isReadOnly,
  } = usePermissions();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // 批量删除
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  const [form, setForm] = useState(defaultForm);

  // 结算比例编辑弹窗状态
  const [settleEdit, setSettleEdit] = useState<{
    productId: string;
    unitId: string;
    unitName: string;
    productName: string;
  } | null>(null);
  const [settleType, setSettleType] = useState<"percentage" | "fixed">("percentage");
  const [settleRate, setSettleRate] = useState<number>(100);
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleNote, setSettleNote] = useState<string>("");

  // 从销售记录导入结果提示
  const [importMsg, setImportMsg] = useState<string>("");

  // 矩阵显示模式：有数据 / 全部
  const [showAllMatrixRows, setShowAllMatrixRows] = useState(false);

  const filteredProducts = useMemo(() => {
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase())
    );
  }, [products, search]);

  // 按月过滤销售记录
  const monthlySales = useMemo(() => filterByMonth(salesRecords, selectedMonth), [salesRecords, selectedMonth]);

  // 获取某产品的所有销售记录
  const getProductSales = (productId: string, records: SalesRecord[]) => {
    return records.filter((s) => s.productId === productId);
  };

  // 计算单笔销售的结算金额
  const calcSaleSettlement = (sale: SalesRecord): number => {
    const ups = unitProductSettlements.find(
      (x) => x.salesUnitId === sale.salesUnitId && x.productId === sale.productId
    );
    if (!ups) return sale.totalAmount; // 未配置结算则按全额计入
    if (ups.settlementType === "fixed") return (ups.settlementAmount || 0) * sale.quantity;
    return sale.totalAmount * ((ups.settlementRate || 0) / 100);
  };

  // 计算单笔销售的提成
  const calcSaleCommission = (sale: SalesRecord): number => {
    const product = products.find((p) => p.id === sale.productId);
    if (!product) return 0;
    if (product.commissionType === "fixed") return (product.commissionAmount || 0) * sale.quantity;
    return sale.totalAmount * ((product.commissionRate || 0) / 100);
  };

  // 产品汇总数据
  const productStats = useMemo(() => {
    return filteredProducts.map((product) => {
      const allSales = getProductSales(product.id, salesRecords);
      const monthSales = getProductSales(product.id, monthlySales);
      // 全部销售统计
      const totalAmount = allSales.reduce((sum, s) => sum + s.totalAmount, 0);
      const totalQty = allSales.reduce((sum, s) => sum + s.quantity, 0);
      const totalSettlement = allSales.reduce((sum, s) => sum + calcSaleSettlement(s), 0);
      const totalCost = allSales.reduce((sum, s) => sum + calcUnitCost(product) * s.quantity, 0);
      const totalProfit = totalSettlement - totalCost;
      // 本月销售统计
      const monthAmount = monthSales.reduce((sum, s) => sum + s.totalAmount, 0);
      const monthSettlement = monthSales.reduce((sum, s) => sum + calcSaleSettlement(s), 0);
      const monthCost = monthSales.reduce((sum, s) => sum + calcUnitCost(product) * s.quantity, 0);
      const monthProfit = monthSettlement - monthCost;
      // 分单位明细
      const unitBreakdown = salesUnits.map((unit) => {
        const unitSales = allSales.filter((s) => s.salesUnitId === unit.id);
        const unitAmount = unitSales.reduce((sum, s) => sum + s.totalAmount, 0);
        const unitSettlement = unitSales.reduce((sum, s) => sum + calcSaleSettlement(s), 0);
        const unitCost = unitSales.reduce((sum, s) => sum + calcUnitCost(product) * s.quantity, 0);
        const unitProfit = unitSettlement - unitCost;
        // 该单位对该产品的结算设置
        const settlement = unitProductSettlements.find(
          (ups) => ups.salesUnitId === unit.id && ups.productId === product.id
        );
        return {
          unit,
          salesCount: unitSales.length,
          amount: unitAmount,
          settlement,
          settlementIncome: unitSettlement,
          cost: unitCost,
          profit: unitProfit,
        };
      }).filter((u) => u.salesCount > 0 || u.settlement);
      return {
        product,
        allSales,
        monthSales,
        totalAmount, totalQty, totalSettlement, totalCost, totalProfit,
        monthAmount, monthSettlement, monthProfit,
        unitBreakdown,
      };
    });
  }, [filteredProducts, salesRecords, monthlySales, salesUnits, unitProductSettlements, products]);

  // 运营中心工资测算
  const unitSalaryCalc = useMemo(() => {
    return salesUnits.map((unit) => {
      const unitSales = monthlySales.filter((s) => s.salesUnitId === unit.id);
      const salesAmount = unitSales.reduce((sum, s) => sum + s.totalAmount, 0);
      const settlementIncome = unitSales.reduce((sum, s) => sum + calcSaleSettlement(s), 0);
      const commission = unitSales.reduce((sum, s) => sum + calcSaleCommission(s), 0);
      const productProfit = settlementIncome - commission;
      const salaryData = getTotalSalaryCost([unit.id], personnel, salesRecords, products, selectedMonth, monthlyAdjustments);
      const salaryCost = salaryData.grandTotal;
      const fixedSalary = salaryData.grandSalary - salaryData.grandProductCommission; // 固定薪酬（不含产品提成）
      const productCommission = salaryData.grandProductCommission;
      const socialInsurance = salaryData.grandSocialInsurance;
      const housingFund = salaryData.grandHousingFund;
      const netProfit = settlementIncome - salaryCost;
      const activeCount = personnel.filter((p) => p.salesUnitId === unit.id && p.status === "active").length;
      return {
        unit, activeCount, salesAmount, settlementIncome, commission, productProfit,
        fixedSalary, productCommission, socialInsurance, housingFund, salaryCost, netProfit,
        salesCount: unitSales.length,
      };
    }).filter((u) => u.salesCount > 0 || u.activeCount > 0)
      .sort((a, b) => b.settlementIncome - a.settlementIncome);
  }, [salesUnits, monthlySales, personnel, salesRecords, products, selectedMonth, monthlyAdjustments, unitProductSettlements]);

  const openAdd = () => {
    setEditingProduct(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      category: product.category,
      salesUnitId: product.salesUnitId || "",
      unitPrice: product.unitPrice,
      costType: product.costType || "percentage",
      unitCost: product.unitCost || 0,
      costRate: product.costRate || 0,
      description: product.description,
      commissionType: product.commissionType || "percentage",
      commissionRate: product.commissionRate || 0,
      commissionAmount: product.commissionAmount || 0,
      commissionNote: product.commissionNote || "",
    });
    setDialogOpen(true);
  };

  // 打开结算比例编辑（产品 × 单位）
  const openSettleEdit = (
    product: Product,
    unit: { id: string; name: string },
    existing?: UnitProductSettlement
  ) => {
    setSettleEdit({
      productId: product.id,
      unitId: unit.id,
      unitName: unit.name,
      productName: product.name,
    });
    setSettleType(existing?.settlementType ?? "percentage");
    setSettleRate(existing?.settlementRate ?? 100);
    setSettleAmount(existing?.settlementAmount ?? 0);
    setSettleNote(existing?.note ?? "");
  };

  const handleSettleSave = async () => {
    if (!settleEdit) return;
    try {
      await upsertUnitProductSettlement({
        salesUnitId: settleEdit.unitId,
        productId: settleEdit.productId,
        settlementType: settleType,
        settlementRate: settleType === "percentage" ? settleRate : undefined,
        settlementAmount: settleType === "fixed" ? settleAmount : undefined,
        note: settleNote,
      });
      setSettleEdit(null);
    } catch (error: any) {
      alert("保存结算比例失败: " + (error.message || "未知错误"));
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, form);
      } else {
        await addProduct(form);
      }
      setDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteProduct(deleteId);
        setDeleteId(null);
      } catch (error: any) {
        alert("删除失败: " + (error.message || "未知错误"));
      }
    }
  };

  // 从销售记录自动导入产品：扫描所有销售记录中出现、但尚未建立的产品名，自动建产品
  const handleImportFromSales = async () => {
    if (!canEditProduct || isReadOnly) return;
    setImportMsg("");

    const existingNames = new Set(
      products.map((p) => (p.name || "").trim().toLowerCase()).filter(Boolean)
    );

    // 候选：销售记录里出现、但产品列表还没有的产品名（去重，按名称）
    type Cand = { name: string; unitSales: Map<string, number>; prices: number[] };
    const candidates = new Map<string, Cand>();

    for (const s of salesRecords) {
      let name = "";
      if (s.productId) {
        const matched = products.find((p) => p.id === s.productId);
        if (matched) continue; // 已关联到现有产品，跳过
        name = s.productName || ""; // 脏数据：productId 失效，用名称兜底
      } else {
        name = s.productName || "";
      }
      name = (name || "").trim();
      if (!name) continue;
      if (existingNames.has(name.toLowerCase())) continue;

      const key = name.toLowerCase();
      if (!candidates.has(key)) {
        candidates.set(key, { name, unitSales: new Map(), prices: [] });
      }
      const c = candidates.get(key)!;
      if (s.salesUnitId) {
        c.unitSales.set(s.salesUnitId, (c.unitSales.get(s.salesUnitId) || 0) + 1);
      }
      if (s.unitPrice > 0) c.prices.push(s.unitPrice);
    }

    if (candidates.size === 0) {
      setImportMsg("没有需要导入的新产品——销售记录中的产品都已在产品列表中。");
      return;
    }

    let count = 0;
    for (const c of candidates.values()) {
      // 默认归属单位：销量最多的销售单位（仅作分组提示，可在编辑中修改）
      let defaultUnit = "";
      let max = -1;
      c.unitSales.forEach((v, k) => {
        if (v > max) {
          max = v;
          defaultUnit = k;
        }
      });
      // 单价：取有效单价的平均值（取整）
      const avgPrice = c.prices.length
        ? Math.round(c.prices.reduce((a, b) => a + b, 0) / c.prices.length)
        : 0;

      await addProduct({
        name: c.name,
        category: "",
        salesUnitId: defaultUnit,
        unitPrice: avgPrice,
        costType: "percentage",
        unitCost: 0,
        costRate: 0,
        description: "",
        commissionType: "percentage",
        commissionRate: 0,
        commissionAmount: 0,
        commissionNote: "",
      });
      count++;
    }

    setImportMsg(
      `已自动从销售记录导入 ${count} 个新产品（售价/成本/提成已置 0，请在对应产品行补充后保存；默认归属单位已按销量最多的单位预填）。`
    );
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
    setSelectedIds(select ? new Set(filteredProducts.map((p) => p.id)) : new Set());
  };
  const clearSelection = () => setSelectedIds(new Set());

  const allSelected = filteredProducts.length > 0 && filteredProducts.every((p) => selectedIds.has(p.id));
  const someSelected = filteredProducts.some((p) => selectedIds.has(p.id));

  // 批量删除
  const handleBatchDelete = async () => {
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await deleteProduct(id);
      }
      clearSelection();
      setBatchDeleteOpen(false);
    } catch (error: any) {
      alert("批量删除失败: " + (error.message || "未知错误"));
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 汇总
  const grandTotal = useMemo(() => {
    const totalSales = productStats.reduce((sum, p) => sum + p.totalAmount, 0);
    const totalSettlement = productStats.reduce((sum, p) => sum + p.totalSettlement, 0);
      const totalCost = productStats.reduce((sum, p) => sum + p.totalCost, 0);
      const totalProfit = totalSettlement - totalCost;
      return { totalSales, totalSettlement, totalCost, totalProfit };
  }, [productStats]);

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      options.push({ value, label });
    }
    return options;
  }, []);

  return (
    <div>
      <PageHeader
        title="产品管理"
        description="管理产品信息与售价成本，自动匹配销售记录并测算各运营中心结算收入与毛利。"
        action={
          <div className="flex gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {canEditProduct && !isReadOnly && selectedIds.size > 0 && (
              <Button variant="destructive" onClick={() => setBatchDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />批量删除 ({selectedIds.size})
              </Button>
            )}
            {canEditProduct && !isReadOnly && (
              <Button variant="outline" onClick={handleImportFromSales} title="根据销售记录中各单位实际销售过的产品，自动创建产品，免去手工逐条录入">
                <Download className="mr-2 h-4 w-4" />从销售记录导入
              </Button>
            )}
            {canEditProduct && !isReadOnly && (
              <Button onClick={openAdd}>
                <Plus className="mr-2 h-4 w-4" />新增产品
              </Button>
            )}
          </div>
        }
      />

      {/* 汇总卡片 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">累计实收金额</p>
              <p className="text-xl font-bold text-blue-600">{formatCurrency(grandTotal.totalSales)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50">
              <DollarSign className="h-6 w-6 text-cyan-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">累计结算收入</p>
              <p className="text-xl font-bold text-cyan-600">{formatCurrency(grandTotal.totalSettlement)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50">
              <Percent className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">累计产品成本</p>
              <p className="text-xl font-bold text-violet-600">{formatCurrency(grandTotal.totalCost)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
              <Calculator className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">累计产品利润</p>
              <p className={`text-xl font-bold ${grandTotal.totalProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {formatCurrency(grandTotal.totalProfit)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 产品列表 */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜索产品名称或分类..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Badge variant="secondary">共 {filteredProducts.length} 个产品</Badge>
      </div>

      {importMsg && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          {importMsg}
        </div>
      )}

      <Card className="mb-6">
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
                      aria-label="全选"
                    />
                  </TableHead>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>产品名称</TableHead>
                  <TableHead className="text-right">售价</TableHead>
                  <TableHead className="text-right">销售笔数</TableHead>
                  <TableHead className="text-right">实收金额</TableHead>
                  <TableHead className="text-right">结算收入</TableHead>
                  <TableHead className="text-right">产品利润</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productStats.map(({ product, totalAmount, totalQty, totalSettlement, totalProfit, unitBreakdown, monthAmount, monthSettlement, monthProfit }) => {
                  const isExp = expandedRows.has(product.id);
                  return (
                    <>
                      <TableRow key={product.id} className="cursor-pointer hover:bg-accent/50" onClick={() => toggleRow(product.id)}>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(product.id)}
                            onChange={() => toggleSelect(product.id)}
                            className="h-4 w-4 cursor-pointer"
                            aria-label="选择该产品"
                          />
                        </TableCell>
                        <TableCell>
                          <button className="flex h-6 w-6 items-center justify-center rounded">
                            {isExp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                              <Package className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {product.category}
                                {product.description && ` · ${product.description}`}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium text-blue-600">{formatCurrency(product.unitPrice)}</TableCell>
                        <TableCell className="text-right">{totalQty > 0 ? `${totalQty}件` : "-"}</TableCell>
                        <TableCell className="text-right text-blue-600">{totalAmount > 0 ? formatCurrency(totalAmount) : "-"}</TableCell>
                        <TableCell className="text-right text-cyan-600 font-medium">{totalSettlement > 0 ? formatCurrency(totalSettlement) : "-"}</TableCell>
                        <TableCell className={`text-right font-semibold ${totalProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {totalSettlement > 0 ? formatCurrency(totalProfit) : "-"}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {canEditProduct && !isReadOnly ? (
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openEdit(product)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteId(product.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">仅查看</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {/* 展开行：分单位明细 */}
                      {isExp && (
                        <TableRow key={product.id + "-detail"} className="bg-cyan-50/20">
                          <TableCell colSpan={9} className="py-3">
                            <div className="ml-4 space-y-3">
                              {/* 本月速览 */}
                              <div className="flex items-center gap-4 rounded-lg bg-muted/50 px-4 py-2 text-sm">
                                <span className="text-muted-foreground">{selectedMonth} 本月：</span>
                                <span className="text-blue-600">实收 {formatCurrency(monthAmount)}</span>
                                <span className="text-cyan-600">结算 {formatCurrency(monthSettlement)}</span>
                                <span className={`font-semibold ${monthProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                  利润 {formatCurrency(monthProfit)}
                                </span>
                              </div>
                              {/* 分单位明细表 */}
                              {unitBreakdown.length > 0 ? (
                                <div className="overflow-hidden rounded-lg border">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="bg-muted/50">
                                        <TableHead>运营中心</TableHead>
                                        <TableHead className="text-right">销售笔数</TableHead>
                                        <TableHead className="text-right">实收金额</TableHead>
                                        <TableHead>结算比例</TableHead>
                                        <TableHead className="text-right">结算收入</TableHead>
                                        <TableHead className="text-right">成本</TableHead>
                                        <TableHead className="text-right">毛利</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {unitBreakdown.map(({ unit, salesCount, amount, settlement, settlementIncome, cost, profit }) => (
                                        <TableRow key={unit.id}>
                                          <TableCell className="text-sm font-medium">{unit.name}</TableCell>
                                          <TableCell className="text-right text-sm">{salesCount}</TableCell>
                                          <TableCell className="text-right text-sm text-blue-600">{formatCurrency(amount)}</TableCell>
                                          <TableCell className="text-sm">
                                            <div className="flex items-center gap-2">
                                              {settlement ? (
                                                <Badge className={
                                                  settlement.settlementType === "percentage"
                                                    ? "bg-cyan-100 text-cyan-700"
                                                    : "bg-teal-100 text-teal-700"
                                                }>
                                                  {settlement.settlementType === "percentage"
                                                    ? `${settlement.settlementRate}%`
                                                    : `${formatCurrency(settlement.settlementAmount || 0)}/件`}
                                                </Badge>
                                              ) : (
                                                <span className="text-xs text-muted-foreground">未配置（按全额）</span>
                                              )}
                                              {canEditProduct && !isReadOnly && (
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-6 px-2 text-xs"
                                                  onClick={() => openSettleEdit(product, unit, settlement || undefined)}
                                                >
                                                  <Pencil className="mr-1 h-3 w-3" />编辑
                                                </Button>
                                              )}
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-right text-sm font-medium text-cyan-600">{formatCurrency(settlementIncome)}</TableCell>
                                          <TableCell className="text-right text-sm text-muted-foreground">{formatCurrency(cost)}</TableCell>
                                          <TableCell className={`text-right text-sm font-semibold ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                            {formatCurrency(profit)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground py-2">暂无销售记录</p>
                              )}
                              {/* 利润公式提示 */}
                              <div className="rounded-lg bg-cyan-50 border border-cyan-200 px-3 py-2 text-xs text-muted-foreground">
                                毛利 = 结算收入 - 产品成本（销售人员提成按「产品 × 单位 × 人员」另行核算）
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">暂无数据</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ===================== 运营中心工资测算 ===================== */}
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 text-orange-600" />
        <h3 className="text-base font-semibold">运营中心工资测算</h3>
        <Badge variant="outline" className="ml-1 border-orange-200 text-orange-700">
          {selectedMonth} · {unitSalaryCalc.length} 个单位
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>运营中心</TableHead>
                  <TableHead className="text-right">在职人数</TableHead>
                  <TableHead className="text-right">本月实收</TableHead>
                  <TableHead className="text-right">结算收入</TableHead>
                  <TableHead className="text-right">产品提成</TableHead>
                  <TableHead className="text-right">产品利润</TableHead>
                  <TableHead className="text-right">固定薪酬</TableHead>
                  <TableHead className="text-right">社保公积金</TableHead>
                  <TableHead className="text-right">工资总额</TableHead>
                  <TableHead className="text-right">净利润</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unitSalaryCalc.map((u) => (
                  <TableRow key={u.unit.id}>
                    <TableCell className="font-medium">{u.unit.name}</TableCell>
                    <TableCell className="text-right">{u.activeCount}人</TableCell>
                    <TableCell className="text-right text-blue-600">{formatCurrency(u.salesAmount)}</TableCell>
                    <TableCell className="text-right text-cyan-600 font-medium">{formatCurrency(u.settlementIncome)}</TableCell>
                    <TableCell className="text-right text-violet-600">{formatCurrency(u.commission)}</TableCell>
                    <TableCell className={`text-right font-semibold ${u.productProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatCurrency(u.productProfit)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">{formatCurrency(u.fixedSalary)}</TableCell>
                    <TableCell className="text-right text-amber-600">{formatCurrency(u.socialInsurance + u.housingFund)}</TableCell>
                    <TableCell className="text-right text-orange-600 font-medium">{formatCurrency(u.salaryCost)}</TableCell>
                    <TableCell className={`text-right font-bold ${u.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatCurrency(u.netProfit)}
                    </TableCell>
                  </TableRow>
                ))}
                {/* 合计行 */}
                {unitSalaryCalc.length > 0 && (
                  <TableRow className="border-t-2 bg-muted/30 font-bold">
                    <TableCell>合计</TableCell>
                    <TableCell className="text-right">{unitSalaryCalc.reduce((s, u) => s + u.activeCount, 0)}人</TableCell>
                    <TableCell className="text-right text-blue-600">{formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.salesAmount, 0))}</TableCell>
                    <TableCell className="text-right text-cyan-600">{formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.settlementIncome, 0))}</TableCell>
                    <TableCell className="text-right text-violet-600">{formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.commission, 0))}</TableCell>
                    <TableCell className="text-right text-emerald-600">{formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.productProfit, 0))}</TableCell>
                    <TableCell className="text-right text-orange-600">{formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.fixedSalary, 0))}</TableCell>
                    <TableCell className="text-right text-amber-600">{formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.socialInsurance + u.housingFund, 0))}</TableCell>
                    <TableCell className="text-right text-orange-600">{formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.salaryCost, 0))}</TableCell>
                    <TableCell className={`text-right ${unitSalaryCalc.reduce((s, u) => s + u.netProfit, 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatCurrency(unitSalaryCalc.reduce((s, u) => s + u.netProfit, 0))}
                    </TableCell>
                  </TableRow>
                )}
                {unitSalaryCalc.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">暂无数据</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 工资测算说明 */}
      <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50/50 p-4 text-sm space-y-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-orange-600" />
          <span className="font-semibold text-orange-700">工资测算逻辑</span>
        </div>
        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground md:grid-cols-2">
          <div>结算收入 = 实收金额 × 结算比例（成本管理中按单位×产品配置）</div>
          <div>产品提成 = 实收金额 × 提成比例（产品管理中设置）</div>
          <div>产品利润 = 结算收入 - 产品提成</div>
          <div>固定薪酬 = 底薪 + 绩效 + 岗位补贴 + 管理提成 + 个人提成</div>
          <div>工资总额 = 固定薪酬 + 产品提成 + 社保 + 公积金 - 请假扣款 + 其他调整</div>
          <div className="font-medium text-orange-700">净利润 = 结算收入 - 工资总额</div>
        </div>
      </div>

      {/* ===================== 提成与结算矩阵（产品 × 销售单位） ===================== */}
      <div className="mb-4 flex items-center gap-2">
        <Calculator className="h-5 w-5 text-violet-600" />
        <h3 className="text-base font-semibold">提成与结算矩阵（产品 × 销售单位）</h3>
        <Badge variant="outline" className="border-violet-200 text-violet-700">
          {selectedMonth} · 一处配齐提成与结算
        </Badge>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAllMatrixRows}
            onChange={(e) => setShowAllMatrixRows(e.target.checked)}
            className="h-3.5 w-3.5 rounded"
          />
          显示全部组合（含无销售记录的）
        </label>
      </div>

      <Card className="mb-6">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-violet-50/60">
                  <TableHead>产品名称</TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead className="text-right">本月销量</TableHead>
                  <TableHead className="text-right">实收金额</TableHead>
                  <TableHead className="text-center">单位结算比例</TableHead>
                  <TableHead className="text-right">预估毛利/件</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.flatMap((product) =>
                  salesUnits.map((unit) => {
                    const allPSales = getProductSales(product.id, salesRecords);
                    const monthPSales = getProductSales(product.id, monthlySales);
                    const uSales = allPSales.filter((s) => s.salesUnitId === unit.id);
                    const mUSales = monthPSales.filter((s) => s.salesUnitId === unit.id);
                    const qty = uSales.reduce((s, r) => s + r.quantity, 0);
                    const amount = uSales.reduce((s, r) => s + r.totalAmount, 0);
                    const mAmount = mUSales.reduce((s, r) => s + r.totalAmount, 0);
                    const ups = unitProductSettlements.find(
                      (x) => x.salesUnitId === unit.id && x.productId === product.id
                    );
                    // 结算收入：有配置按配置算，否则全额
                    let settleIncome = amount;
                    if (ups) {
                      if (ups.settlementType === "fixed") settleIncome = (ups.settlementAmount || 0) * qty;
                      else settleIncome = amount * ((ups.settlementRate || 100) / 100);
                    }
                    // 单位毛利 = 结算收入 - 产品成本（个人提成按人另算，不计入产品级）
                    const costIncome = calcUnitCost(product) * qty;
                    const profitPerPiece = qty > 0 ? (settleIncome - costIncome) / qty : 0;

                    if (!showAllMatrixRows && qty === 0 && !ups) return null;

                    return (
                      <TableRow key={`${product.id}-${unit.id}`} className={qty > 0 ? "" : "opacity-60"}>
                        <TableCell className="font-medium text-sm">{product.name}</TableCell>
                        <TableCell className="text-sm">{unit.name}</TableCell>
                        <TableCell className="text-right text-sm">{qty > 0 ? `${qty}件` : "-"}</TableCell>
                        <TableCell className="text-right text-sm text-blue-600">{mAmount > 0 ? formatCurrency(mAmount) : "-"}</TableCell>


                        {/* 单位结算比例 */}
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {ups ? (
                              <Badge className={
                                ups.settlementType === "percentage"
                                  ? "bg-cyan-100 text-cyan-700"
                                  : "bg-teal-100 text-teal-700"
                              }>
                                {ups.settlementType === "percentage"
                                  ? `${ups.settlementRate}%`
                                  : `${formatCurrency(ups.settlementAmount || 0)}/件`}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">100%（全额）</span>
                            )}
                            {canEditProduct && !isReadOnly && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-xs"
                                onClick={() => openSettleEdit(product, unit, ups || undefined)}
                              >
                                <Pencil className="mr-1 h-3 w-3" />编辑
                              </Button>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className={`text-right text-sm font-semibold ${
                          profitPerPiece >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}>
                          {qty > 0 ? formatCurrency(profitPerPiece) : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ).filter(Boolean)}
                {products.length === 0 || salesUnits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      暂无数据（请先添加销售单位或从销售记录导入产品）
                    </TableCell>
                  </TableRow>
                ) : (
                  !showAllMatrixRows &&
                  products.flatMap((p) => salesUnits.map((u) => {
                    const us = getProductSales(p.id, salesRecords).filter((s) => s.salesUnitId === u.id);
                    return us.length > 0 || unitProductSettlements.find(x => x.salesUnitId === u.id && x.productId === p.id);
                  })).filter(Boolean).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                        本月暂无销售记录且未配置结算比例。勾选「显示全部组合」可预览所有产品×单位。
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "编辑产品" : "新增产品"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>产品名称 *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="产品名称" />
              </div>
              <div className="space-y-2">
                <Label>分类</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="如：软件产品" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>默认销售单位</Label>
              <Select
                value={form.salesUnitId || "__none__"}
                onValueChange={(v) => setForm({ ...form, salesUnitId: v === "__none__" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="选择归属销售单位（可选）" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未指定</SelectItem>
                  {salesUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">设定后便于在「产品结算比例（按销售单位）」中按单位分组管理与测算结算收入。</p>
              {editingProduct && (
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/product-settlement?product=${editingProduct.id}`)}
                  >
                    <Calculator className="mr-1 h-3.5 w-3.5" />配置各销售单位结算比例
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>售价 (¥)</Label>
              <Input type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} placeholder="售价" />
            </div>
            <div className="space-y-2">
              <Label>产品描述</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="产品描述" rows={2} />
            </div>

            {/* 销售提成不在产品维度设置：提成按「产品 × 销售单位 × 销售人员」在「产品结算比例（按销售单位）」页配置 */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingProduct ? "保存" : "新增"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除该产品吗？此操作不可撤销。</AlertDialogDescription>
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
              确定要删除选中的 {selectedIds.size} 个产品吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 结算比例编辑弹窗（产品 × 单位） */}
      <Dialog open={!!settleEdit} onOpenChange={(open) => !open && setSettleEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>配置结算比例</DialogTitle>
          </DialogHeader>
          {settleEdit && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">产品：</span>
                <span className="font-medium">{settleEdit.productName}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-muted-foreground">销售单位：</span>
                <span className="font-medium">{settleEdit.unitName}</span>
              </div>
              <div className="space-y-2">
                <Label>结算方式</Label>
                <Select value={settleType} onValueChange={(v) => setSettleType(v as "percentage" | "fixed")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">按售价百分比</SelectItem>
                    <SelectItem value="fixed">按件固定金额</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {settleType === "percentage" ? (
                <div className="space-y-2">
                  <Label>结算比例 (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={settleRate}
                    onChange={(e) => setSettleRate(Number(e.target.value))}
                    placeholder="如：45 表示 45%"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>每件结算金额 (¥)</Label>
                  <Input
                    type="number"
                    value={settleAmount}
                    onChange={(e) => setSettleAmount(Number(e.target.value))}
                    placeholder="如：500"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>结算说明（可选）</Label>
                <Input
                  value={settleNote}
                  onChange={(e) => setSettleNote(e.target.value)}
                  placeholder="如：特殊结算政策"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleEdit(null)}>取消</Button>
            <Button onClick={handleSettleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
