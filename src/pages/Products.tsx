import { useState, useMemo } from "react";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatPercent } from "@/lib/format";
import { getTotalSalaryCost, filterByMonth } from "@/lib/salary";
import type { Product, SalesRecord } from "@/types";
import {
  Plus, Search, Pencil, Trash2, Package, Percent,
  ChevronDown, ChevronRight, TrendingUp, DollarSign,
  Calculator, Users, Wallet,
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
  const { products, addProduct, updateProduct, deleteProduct, monthlyAdjustments } = useData();
  const {
    visibleSalesRecords: salesRecords,
    visibleSalesUnits: salesUnits,
    visiblePersonnel: personnel,
    visibleUnitProductSettlements: unitProductSettlements,
    canEditProduct, isReadOnly,
  } = usePermissions();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  const [form, setForm] = useState(defaultForm);

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
      const totalCommission = allSales.reduce((sum, s) => sum + calcSaleCommission(s), 0);
      const totalProfit = totalSettlement - totalCommission;
      // 本月销售统计
      const monthAmount = monthSales.reduce((sum, s) => sum + s.totalAmount, 0);
      const monthSettlement = monthSales.reduce((sum, s) => sum + calcSaleSettlement(s), 0);
      const monthCommission = monthSales.reduce((sum, s) => sum + calcSaleCommission(s), 0);
      const monthProfit = monthSettlement - monthCommission;
      // 分单位明细
      const unitBreakdown = salesUnits.map((unit) => {
        const unitSales = allSales.filter((s) => s.salesUnitId === unit.id);
        const unitAmount = unitSales.reduce((sum, s) => sum + s.totalAmount, 0);
        const unitSettlement = unitSales.reduce((sum, s) => sum + calcSaleSettlement(s), 0);
        const unitCommission = unitSales.reduce((sum, s) => sum + calcSaleCommission(s), 0);
        const unitProfit = unitSettlement - unitCommission;
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
          commission: unitCommission,
          profit: unitProfit,
        };
      }).filter((u) => u.salesCount > 0 || u.settlement);
      return {
        product,
        allSales,
        monthSales,
        totalAmount, totalQty, totalSettlement, totalCommission, totalProfit,
        monthAmount, monthSettlement, monthCommission, monthProfit,
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

  // 表单中预估提成（假设销售1件）
  const previewCommission = useMemo(() => {
    if (form.commissionType === "fixed") {
      return form.commissionAmount || 0;
    }
    return form.unitPrice * ((form.commissionRate || 0) / 100);
  }, [form.commissionType, form.commissionAmount, form.commissionRate, form.unitPrice]);

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

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatCommission = (p: Product) => {
    if (p.commissionType === "fixed") {
      return `${formatCurrency(p.commissionAmount)}/件`;
    }
    return `${p.commissionRate}%`;
  };

  // 汇总
  const grandTotal = useMemo(() => {
    const totalSales = productStats.reduce((sum, p) => sum + p.totalAmount, 0);
    const totalSettlement = productStats.reduce((sum, p) => sum + p.totalSettlement, 0);
    const totalCommission = productStats.reduce((sum, p) => sum + p.totalCommission, 0);
    const totalProfit = totalSettlement - totalCommission;
    return { totalSales, totalSettlement, totalCommission, totalProfit };
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
        description="管理产品信息、销售提成设置，自动匹配销售记录数据并测算各运营中心结算收入与工资成本。"
        action={
          <div className="flex gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {canEditProduct && !isReadOnly && (
              <Button onClick={openAdd}>
                <Plus className="mr-2 h-4 w-4" />新增产品
              </Button>
            )}
          </div>
        }
      />

      {/* 汇总卡片 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <p className="text-sm text-muted-foreground">累计销售提成</p>
              <p className="text-xl font-bold text-violet-600">{formatCurrency(grandTotal.totalCommission)}</p>
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

      <Card className="mb-6">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>产品名称</TableHead>
                  <TableHead className="text-right">售价</TableHead>
                  <TableHead className="text-right">销售提成</TableHead>
                  <TableHead className="text-right">销售笔数</TableHead>
                  <TableHead className="text-right">实收金额</TableHead>
                  <TableHead className="text-right">结算收入</TableHead>
                  <TableHead className="text-right">销售提成额</TableHead>
                  <TableHead className="text-right">产品利润</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productStats.map(({ product, totalAmount, totalQty, totalSettlement, totalCommission, totalProfit, unitBreakdown, monthAmount, monthSettlement, monthCommission, monthProfit }) => {
                  const isExp = expandedRows.has(product.id);
                  const hasCommission = product.commissionType === "fixed"
                    ? (product.commissionAmount || 0) > 0
                    : (product.commissionRate || 0) > 0;
                  return (
                    <>
                      <TableRow key={product.id} className="cursor-pointer hover:bg-accent/50" onClick={() => toggleRow(product.id)}>
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
                        <TableCell className="text-right">
                          {hasCommission ? (
                            <Badge className="bg-violet-50 text-violet-700">
                              <Percent className="mr-1 h-3 w-3" />
                              {formatCommission(product)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">未设置</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{totalQty > 0 ? `${totalQty}件` : "-"}</TableCell>
                        <TableCell className="text-right text-blue-600">{totalAmount > 0 ? formatCurrency(totalAmount) : "-"}</TableCell>
                        <TableCell className="text-right text-cyan-600 font-medium">{totalSettlement > 0 ? formatCurrency(totalSettlement) : "-"}</TableCell>
                        <TableCell className="text-right text-violet-600">{totalCommission > 0 ? formatCurrency(totalCommission) : "-"}</TableCell>
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
                          <TableCell colSpan={10} className="py-3">
                            <div className="ml-4 space-y-3">
                              {/* 本月速览 */}
                              <div className="flex items-center gap-4 rounded-lg bg-muted/50 px-4 py-2 text-sm">
                                <span className="text-muted-foreground">{selectedMonth} 本月：</span>
                                <span className="text-blue-600">实收 {formatCurrency(monthAmount)}</span>
                                <span className="text-cyan-600">结算 {formatCurrency(monthSettlement)}</span>
                                <span className="text-violet-600">提成 {formatCurrency(monthCommission)}</span>
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
                                        <TableHead className="text-right">提成</TableHead>
                                        <TableHead className="text-right">利润</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {unitBreakdown.map(({ unit, salesCount, amount, settlement, settlementIncome, commission, profit }) => (
                                        <TableRow key={unit.id}>
                                          <TableCell className="text-sm font-medium">{unit.name}</TableCell>
                                          <TableCell className="text-right text-sm">{salesCount}</TableCell>
                                          <TableCell className="text-right text-sm text-blue-600">{formatCurrency(amount)}</TableCell>
                                          <TableCell className="text-sm">
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
                                          </TableCell>
                                          <TableCell className="text-right text-sm font-medium text-cyan-600">{formatCurrency(settlementIncome)}</TableCell>
                                          <TableCell className="text-right text-sm text-violet-600">{formatCurrency(commission)}</TableCell>
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
                                利润 = 实收金额 × 结算比例 - 实收金额 × 提成比例
                                {product.unitPrice > 0 && hasCommission && (
                                  <span className="ml-2">
                                    示例：{formatCurrency(product.unitPrice)} × 结算比例% - {formatCurrency(product.unitPrice)} × {formatCommission(product)} = 
                                    <span className="font-semibold text-emerald-600 ml-1">
                                      利润/件
                                    </span>
                                  </span>
                                )}
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
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">暂无数据</TableCell>
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
              <Label>售价 (¥)</Label>
              <Input type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} placeholder="售价" />
            </div>
            <div className="space-y-2">
              <Label>产品描述</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="产品描述" rows={2} />
            </div>

            {/* 销售提成设置 */}
            <div className="rounded-lg border-2 border-violet-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Percent className="h-4 w-4 text-violet-600" />
                <Label className="text-sm font-semibold text-violet-700">销售提成设置</Label>
                <span className="text-xs text-muted-foreground">（用于薪资核算，利润 = 实收 × 结算比例 - 实收 × 提成比例）</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>提成方式</Label>
                  <Select
                    value={form.commissionType}
                    onValueChange={(v) => setForm({ ...form, commissionType: v as "percentage" | "fixed" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">按销售额百分比</SelectItem>
                      <SelectItem value="fixed">按件固定金额</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  {form.commissionType === "percentage" ? (
                    <>
                      <Label>提成比例 (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={form.commissionRate}
                        onChange={(e) => setForm({ ...form, commissionRate: Number(e.target.value) })}
                        placeholder="如：10 表示 10%"
                      />
                    </>
                  ) : (
                    <>
                      <Label>每件提成 (¥)</Label>
                      <Input
                        type="number"
                        value={form.commissionAmount}
                        onChange={(e) => setForm({ ...form, commissionAmount: Number(e.target.value) })}
                        placeholder="如：500"
                      />
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>提成条件说明</Label>
                <Input
                  value={form.commissionNote}
                  onChange={(e) => setForm({ ...form, commissionNote: e.target.value })}
                  placeholder="如：达到月度目标后发放，试用期不享受提成等"
                />
              </div>
              {/* 预估提成 */}
              {form.unitPrice > 0 && (
                <div className="rounded-lg bg-violet-50 p-2 text-sm">
                  <span className="text-muted-foreground">单件预估提成：</span>
                  <span className="font-semibold text-violet-700">{formatCurrency(previewCommission)}</span>
                  {form.commissionType === "percentage" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      （占售价 {formatPercent(form.commissionRate || 0)}）
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 利润计算说明 */}
            {form.unitPrice > 0 && form.commissionRate > 0 && (
              <div className="rounded-lg bg-cyan-50 border border-cyan-200 p-3 text-sm space-y-1">
                <p className="font-semibold text-cyan-700">利润计算公式</p>
                <p className="text-muted-foreground">
                  单位利润 = 实收金额 × 结算比例 - 实收金额 × 提成比例
                </p>
                <p className="text-xs text-muted-foreground">
                  示例：售价 ¥{form.unitPrice.toLocaleString()}，结算比例 45%，提成 {form.commissionRate}% →
                  利润 = {formatCurrency(form.unitPrice * 0.45)} - {formatCurrency(form.unitPrice * (form.commissionRate / 100))} =
                  <span className="font-semibold text-emerald-600 ml-1">
                    {formatCurrency(form.unitPrice * 0.45 - form.unitPrice * (form.commissionRate / 100))}
                  </span>
                  <span className="ml-1">（结算比例在「成本管理」按单位配置）</span>
                </p>
              </div>
            )}
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
    </div>
  );
}
