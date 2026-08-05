import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/format";
import { filterByMonth } from "@/lib/salary";
import type { Product, SalesUnit, UnitProductSettlement, ProductPersonCommission, Personnel } from "@/types";
import {
  Building2, Package, Pencil, Trash2, Search, Calculator, Users, UserCog, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// 单笔销售结算金额
const calcSaleSettlement = (
  sale: { totalAmount: number; quantity: number },
  ups?: UnitProductSettlement
): number => {
  if (!ups) return sale.totalAmount;
  if (ups.settlementType === "fixed") return (ups.settlementAmount || 0) * sale.quantity;
  return sale.totalAmount * ((ups.settlementRate || 0) / 100);
};

// 默认空提成配置
const EMPTY_PERSON_COMMISSION = {
  managementCommissionRate: 0,
  managementCommissionThreshold: 0,
  managementCommissionCondition: "",
  personalCommissionRate: 0,
  personalCommissionThreshold: 0,
  personalCommissionCondition: "",
};

export default function ProductSettlement() {
  const {
    products, allSalesRecords: salesRecords,
    unitProductSettlements: upsList,
    productPersonCommissions: ppcList,
    personnel,
    upsertUnitProductSettlement, deleteUnitProductSettlement,
    upsertProductPersonCommission, deleteProductPersonCommission,
    batchUpsertUnitProductSettlements,
  } = useData();
  const {
    visibleSalesUnits: units, visibleUnitProductSettlements: _upsVisible,
    canEditProduct, isReadOnly,
  } = usePermissions();

  const [searchParams] = useSearchParams();
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  // 从旧链接或销售记录跳转过来时，按产品名预筛（?product=<id>）
  const [search, setSearch] = useState(() => {
    const pid = searchParams.get("product");
    if (!pid) return "";
    const p = products.find((x) => x.id === pid);
    return p ? p.name : "";
  });

  // ---- 结算编辑弹窗状态 ----
  const [editKey, setEditKey] = useState<{ productId: string; unitId: string } | null>(null);
  const [settleForm, setSettleForm] = useState({
    settlementType: "percentage" as "percentage" | "fixed",
    settlementRate: 0,
    settlementAmount: 0,
    note: "",
  });

  // ---- 批量结算：null=关闭；'all'=当前列表全部产品；string=单个产品 id ----
  const [batchSettleTarget, setBatchSettleTarget] = useState<string | "all" | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);

  // ---- 人员提成编辑弹窗状态 ----
  const [ppcEditKey, setPpcEditKey] = useState<{ productId: string; unitId: string; personnelId: string } | null>(null);
  const [ppcForm, setPpcForm] = useState(EMPTY_PERSON_COMMISSION);

  // 按月过滤销售记录
  const monthlySales = useMemo(() => filterByMonth(salesRecords, selectedMonth), [salesRecords, selectedMonth]);

  // 仅展示销售记录里出现过的产品（配置来源 = 销售）
  const productsFromSales = useMemo(() => {
    const idSet = new Set(salesRecords.map((s) => s.productId).filter(Boolean));
    return products.filter((p) => idSet.has(p.id));
  }, [products, salesRecords]);

  // 产品列表（搜索过滤）
  const filteredProducts = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return productsFromSales.filter(
      (p) => !kw || p.name.toLowerCase().includes(kw) || (p.category || "").toLowerCase().includes(kw)
    );
  }, [productsFromSales, search]);

  // 某产品×某单位的已配置结算
  const findUps = (productId: string, unitId: string) =>
    upsList.find((x) => x.salesUnitId === unitId && x.productId === productId);

  // 某产品×某单位×某人员的已配置提成
  const findPpc = (productId: string, unitId: string, personnelId: string) =>
    ppcList.find((x) => x.salesUnitId === unitId && x.productId === productId && x.personnelId === personnelId);

  // 方案 A：每个产品下列出权限内全部销售单位，便于提前配置结算
  function getUnitsForProduct(_productId: string): SalesUnit[] {
    return units;
  }

  // 某产品×单位：列出该单位全部在职人员，便于提前配置提成
  function getPeopleForProductUnit(_productId: string, unitId: string): Personnel[] {
    return personnel.filter((p) => p.salesUnitId === unitId && p.status === "active");
  }

  // 某产品×某单位的本月结算收入预览
  const calcUnitIncome = (productId: string, unitId: string): number => {
    const ups = findUps(productId, unitId);
    return monthlySales
      .filter((s) => s.productId === productId && s.salesUnitId === unitId)
      .reduce((sum, s) => sum + calcSaleSettlement(s, ups), 0);
  };

  // 某人员在本月某产品的销售额
  const calcPersonProductSales = (personId: string, productId: string): number =>
    monthlySales
      .filter((s) => s.personnelId === personId && s.productId === productId)
      .reduce((sum, s) => sum + s.totalAmount, 0);

  // 某单位在本月的团队销售额
  const calcTeamSales = (unitId: string): number =>
    monthlySales
      .filter((s) => s.salesUnitId === unitId)
      .reduce((sum, s) => sum + s.totalAmount, 0);

  // 全产品本月结算收入合计
  const totalMonthIncome = useMemo(() => {
    let total = 0;
    filteredProducts.forEach((p) => {
      getUnitsForProduct(p.id).forEach((u) => { total += calcUnitIncome(p.id, u.id); });
    });
    return total;
  }, [filteredProducts, units, monthlySales, upsList, salesRecords]);

  // 按产品分组的人员提成配置（用于展示）
  const productPersonGroups = useMemo(() =>
    filteredProducts.map((product) => {
      const rows: {
        unit: SalesUnit;
        person: Personnel;
        ppc: ProductPersonCommission | undefined;
        personSales: number;
        teamSales: number;
      }[] = [];
      getUnitsForProduct(product.id).forEach((unit) => {
        const unitPeople = getPeopleForProductUnit(product.id, unit.id);
        const teamSales = calcTeamSales(unit.id);
        unitPeople.forEach((person) => {
          const ppc = findPpc(product.id, unit.id, person.id);
          const personSales = calcPersonProductSales(person.id, product.id);
          rows.push({ unit, person, ppc, personSales, teamSales });
        });
      });
      return { product, rows };
    }),
  [filteredProducts, units, personnel, ppcList, monthlySales, salesRecords, upsList]);

  // ---- 结算编辑 ----
  const openSettleEdit = (productId: string, unitId: string) => {
    const ups = findUps(productId, unitId);
    setSettleForm({
      settlementType: ups?.settlementType || "percentage",
      // 未配置时默认 100%，表示按实收全额结算
      settlementRate: ups?.settlementRate ?? 100,
      settlementAmount: ups?.settlementAmount || 0,
      note: ups?.note || "",
    });
    setEditKey({ productId, unitId });
  };

  const handleSettleSave = async () => {
    if (!editKey) return;
    try {
      await upsertUnitProductSettlement({
        salesUnitId: editKey.unitId,
        productId: editKey.productId,
        settlementType: settleForm.settlementType,
        settlementRate: settleForm.settlementRate || 0,
        settlementAmount: settleForm.settlementAmount || 0,
        note: settleForm.note,
      });
      setEditKey(null);
    } catch (error: any) {
      alert("保存失败: " + (error.message || "未知错误"));
    }
  };

  const handleSettleClear = async (productId?: string, unitId?: string) => {
    const pid = productId || editKey?.productId;
    const uid = unitId || editKey?.unitId;
    if (!pid || !uid) return;
    const ups = findUps(pid, uid);
    if (ups?.id) {
      try { await deleteUnitProductSettlement(ups.id); }
      catch (error: any) { alert("清除失败: " + (error.message || "未知错误")); }
    }
    setEditKey(null);
  };

  const openBatchSettle = (target: string | "all") => {
    setSettleForm({
      settlementType: "percentage",
      settlementRate: 100,
      settlementAmount: 0,
      note: "",
    });
    setBatchSettleTarget(target);
  };

  const handleBatchSettleSave = async () => {
    if (!batchSettleTarget) return;
    const productIds =
      batchSettleTarget === "all"
        ? filteredProducts.map((p) => p.id)
        : [batchSettleTarget];
    if (productIds.length === 0 || units.length === 0) {
      alert("没有可配置的产品或销售单位");
      return;
    }
    const items = productIds.flatMap((productId) =>
      units.map((unit) => ({
        salesUnitId: unit.id,
        productId,
        settlementType: settleForm.settlementType,
        settlementRate: settleForm.settlementRate || 0,
        settlementAmount: settleForm.settlementAmount || 0,
        note: settleForm.note,
      }))
    );
    if (!confirm(`将把相同结算规则应用到 ${productIds.length} 个产品 × ${units.length} 个单位（共 ${items.length} 条），是否继续？`)) {
      return;
    }
    setBatchSaving(true);
    try {
      await batchUpsertUnitProductSettlements(items);
      setBatchSettleTarget(null);
    } catch (error: any) {
      alert("批量保存失败: " + (error.message || "未知错误"));
    } finally {
      setBatchSaving(false);
    }
  };

  // ---- 人员提成编辑 ----
  const openPpcEdit = (productId: string, unitId: string, personnelId: string) => {
    const ppc = findPpc(productId, unitId, personnelId);
    setPpcForm(ppc ? { ...EMPTY_PERSON_COMMISSION, ...ppc } : { ...EMPTY_PERSON_COMMISSION });
    setPpcEditKey({ productId, unitId, personnelId });
  };

  const handlePpcSave = async () => {
    if (!ppcEditKey) return;
    try {
      await upsertProductPersonCommission({
        salesUnitId: ppcEditKey.unitId,
        productId: ppcEditKey.productId,
        personnelId: ppcEditKey.personnelId,
        managementCommissionRate: ppcForm.managementCommissionRate || 0,
        managementCommissionThreshold: ppcForm.managementCommissionThreshold || 0,
        managementCommissionCondition: ppcForm.managementCommissionCondition,
        personalCommissionRate: ppcForm.personalCommissionRate || 0,
        personalCommissionThreshold: ppcForm.personalCommissionThreshold || 0,
        personalCommissionCondition: ppcForm.personalCommissionCondition,
      });
      setPpcEditKey(null);
    } catch (error: any) {
      alert("保存失败: " + (error.message || "未知错误"));
    }
  };

  const handlePpcClear = async () => {
    if (!ppcEditKey) return;
    const ppc = findPpc(ppcEditKey.productId, ppcEditKey.unitId, ppcEditKey.personnelId);
    if (ppc?.id) {
      try { await deleteProductPersonCommission(ppc.id); }
      catch (error: any) { alert("删除失败: " + (error.message || "未知错误")); }
    }
    setPpcEditKey(null);
  };

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      options.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
    }
    return options;
  }, []);

  const canEdit = canEditProduct && !isReadOnly;
  const editTarget = editKey
    ? { product: products.find((p) => p.id === editKey.productId), unit: units.find((u) => u.id === editKey.unitId) }
    : null;
  const ppcTarget = ppcEditKey
    ? {
        product: products.find((p) => p.id === ppcEditKey.productId),
        unit: units.find((u) => u.id === ppcEditKey.unitId),
        person: personnel.find((p) => p.id === ppcEditKey.personnelId),
      }
    : null;

  // 统计已配置的人员提成数
  const configuredPpcCount = ppcList.length;

  return (
    <div>
      <PageHeader
        title="结算与提成"
        description="产品来自销售记录。可按单位单独配置，或一键批量设置全部单位的结算比例；人员提成可提前按单位内在职人员配置。"
        action={
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {productsFromSales.length === 0 && (
        <Card className="mb-6 border-dashed">
          <CardContent className="p-6 text-sm text-muted-foreground">
            暂无来自销售的产品。请先到「销售记录」导入或录入订单，产品会按名称自动出现后再配置结算与提成。
          </CardContent>
        </Card>
      )}

      {/* 汇总卡片 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50">
              <Calculator className="h-6 w-6 text-cyan-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{selectedMonth} 结算收入合计</p>
              <p className="text-xl font-bold text-cyan-600">{formatCurrency(totalMonthIncome)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <Package className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">销售中的产品</p>
              <p className="text-xl font-bold text-blue-600">{filteredProducts.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50">
              <Building2 className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">销售单位</p>
              <p className="text-xl font-bold text-violet-600">{units.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
              <UserCog className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">已配置人员提成</p>
              <p className="text-xl font-bold text-emerald-600">{configuredPpcCount} 条</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜索产品名称或分类..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Badge variant="secondary">共 {filteredProducts.length} 个产品</Badge>
        {canEdit && filteredProducts.length > 0 && units.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => openBatchSettle("all")}>
            <Layers className="mr-2 h-4 w-4" />
            批量设置全部产品×单位
          </Button>
        )}
      </div>

      {/* ==================== 第一部分：产品 × 单位 结算配置 ==================== */}
      <div className="mb-8 space-y-4">
        {filteredProducts.map((product: Product) => {
          const productUnits = getUnitsForProduct(product.id);
          return (
            <Card key={product.id}>
              <CardContent className="p-0">
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Package className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.category || "未分类"}
                      <span className="ml-2 text-muted-foreground">
                        · {productUnits.length} 个销售单位
                      </span>
                    </p>
                  </div>
                  {canEdit && productUnits.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => openBatchSettle(product.id)}
                    >
                      <Layers className="mr-1.5 h-3.5 w-3.5" />
                      批量设置全部单位
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>销售单位</TableHead>
                        <TableHead className="text-right">结算方式</TableHead>
                        <TableHead className="text-right">结算比例 / 金额</TableHead>
                        <TableHead className="text-right">{selectedMonth} 结算收入</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productUnits.map((unit: SalesUnit) => {
                        const ups = findUps(product.id, unit.id);
                        const income = calcUnitIncome(product.id, unit.id);
                        return (
                          <TableRow key={unit.id}>
                            <TableCell className="text-sm font-medium">{unit.name}</TableCell>
                            <TableCell className="text-right">
                              {ups ? (
                                <Badge className={ups.settlementType === "percentage" ? "bg-cyan-100 text-cyan-700" : "bg-teal-100 text-teal-700"}>
                                  {ups.settlementType === "percentage" ? "按比例" : "按件固定"}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">未配置（按全额）</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {ups ? (
                                ups.settlementType === "percentage"
                                  ? `${ups.settlementRate}%`
                                  : `${formatCurrency(ups.settlementAmount || 0)}/件`
                              ) : (
                                <span className="text-muted-foreground">100%</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium text-cyan-600">
                              {income > 0 ? formatCurrency(income) : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {canEdit ? (
                                <div className="flex justify-end gap-1">
                                  <Button variant="ghost" size="icon" onClick={() => openSettleEdit(product.id, unit.id)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {ups?.id && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleSettleClear(product.id, unit.id)}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">仅查看</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {productUnits.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                            暂无销售单位，请先在「销售单位」中录入
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filteredProducts.length === 0 && productsFromSales.length > 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              没有匹配的产品，请调整搜索条件。
            </CardContent>
          </Card>
        )}
      </div>

      {/* ==================== 第二部分：人员提成配置（按产品×单位×人员） ==================== */}
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 text-emerald-600" />
        <h3 className="text-base font-semibold">人员提成配置（按产品 × 单位 × 人员）</h3>
        <Badge variant="outline" className="border-emerald-200 text-emerald-700">
          选择单位 → 选择产品 → 选择人 → 设定管理/个人提成 → 自动计算
        </Badge>
      </div>

      <div className="space-y-4">
        {productPersonGroups.map(({ product, rows }) => (
          <Card key={"ppc-" + product.id}>
            <CardContent className="p-0">
              <div className="flex items-center gap-3 border-b px-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <Package className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.category} · 人员提成矩阵</p>
                </div>
                <Badge variant="secondary">{rows.length} 人</Badge>
              </div>
              {rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-emerald-50/50">
                        <TableHead>销售单位</TableHead>
                        <TableHead>销售人员</TableHead>
                        <TableHead className="text-right">管理提成比例</TableHead>
                        <TableHead className="text-right">管理起算门槛</TableHead>
                        <TableHead className="text-right">个人提成比例</TableHead>
                        <TableHead className="text-right">个人起算门槛</TableHead>
                        <TableHead className="text-right">本月该产品销售额</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(({ unit, person, ppc, personSales, teamSales: _teamSales }) => {
                        const hasMgmt = (ppc?.managementCommissionRate || 0) > 0;
                        const hasPersonal = (ppc?.personalCommissionRate || 0) > 0;
                        return (
                          <TableRow key={`${unit.id}-${person.id}`}>
                            <TableCell className="text-sm font-medium">{unit.name}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                                  <Users className="h-3 w-3 text-primary" />
                                </div>
                                <span className="text-sm">{person.name}</span>
                                <span className="text-xs text-muted-foreground">({person.position})</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {hasMgmt ? (
                                <Badge className="bg-emerald-100 text-emerald-700">{ppc!.managementCommissionRate}%</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">未设置</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {ppc?.managementCommissionThreshold
                                ? formatCurrency(ppc.managementCommissionThreshold)
                                : <span className="text-xs text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {hasPersonal ? (
                                <Badge className="bg-orange-100 text-orange-700">{ppc!.personalCommissionRate}%</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">未设置</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {ppc?.personalCommissionThreshold
                                ? formatCurrency(ppc.personalCommissionThreshold)
                                : <span className="text-xs text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium text-blue-600">
                              {personSales > 0 ? formatCurrency(personSales) : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {canEdit ? (
                                <Button variant="ghost" size="icon" onClick={() => openPpcEdit(product.id, unit.id, person.id)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">仅查看</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  该产品下各单位暂无在职人员，请先在「人员管理」中录入。
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {productPersonGroups.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">暂无产品。</CardContent></Card>
        )}
      </div>

      {/* 公式说明 */}
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 text-sm space-y-2">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-emerald-600" />
          <span className="font-semibold text-emerald-700">提成计算公式</span>
        </div>
        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground md:grid-cols-2">
          <div><strong>管理提成</strong> = max(0, 团队销售额 - 起算门槛) × 管理提成比例%</div>
          <div><strong>个人提成</strong> = max(0, 个人该产品销售额 - 起算门槛) × 个人提成比例%</div>
          <div>未在此处配置提成的人员，将沿用「人员管理」中设置的默认提成参数（如有）</div>
          <div>此处配置的优先级高于人员默认设置，可实现"同一人不同产品不同提成率"</div>
        </div>
      </div>

      {/* ===== 编辑结算弹窗 ===== */}
      <Dialog open={!!editKey} onOpenChange={(open) => !open && setEditKey(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>配置结算比例</DialogTitle>
          </DialogHeader>
          {editTarget?.product && editTarget?.unit && (
            <div className="mb-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <p><span className="text-muted-foreground">产品：</span>{editTarget.product.name}</p>
              <p><span className="text-muted-foreground">销售单位：</span>{editTarget.unit.name}</p>
            </div>
          )}
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>结算方式</Label>
              <Select value={settleForm.settlementType} onValueChange={(v) => setSettleForm({ ...settleForm, settlementType: v as "percentage" | "fixed" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">按售价百分比</SelectItem>
                  <SelectItem value="fixed">按件固定金额</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settleForm.settlementType === "percentage" ? (
              <div className="space-y-2">
                <Label>结算比例 (%)</Label>
                <Input type="number" step="0.1" value={settleForm.settlementRate}
                  onChange={(e) => setSettleForm({ ...settleForm, settlementRate: Number(e.target.value) })} placeholder="如：80 表示结算为售价的 80%" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>每件结算金额 (¥)</Label>
                <Input type="number" value={settleForm.settlementAmount}
                  onChange={(e) => setSettleForm({ ...settleForm, settlementAmount: Number(e.target.value) })} placeholder="如：500" />
              </div>
            )}
            <div className="space-y-2">
              <Label>结算说明</Label>
              <Input value={settleForm.note} onChange={(e) => setSettleForm({ ...settleForm, note: e.target.value })} placeholder="如：该单位特殊结算政策" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditKey(null)}>取消</Button>
            <Button onClick={handleSettleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 批量结算弹窗 ===== */}
      <Dialog open={!!batchSettleTarget} onOpenChange={(open) => !open && !batchSaving && setBatchSettleTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>一键批量设置结算</DialogTitle>
          </DialogHeader>
          <div className="mb-2 rounded-lg bg-cyan-50 border border-cyan-200 px-3 py-2 text-sm space-y-1">
            {batchSettleTarget === "all" ? (
              <>
                <p>将应用到当前列表 <strong>{filteredProducts.length}</strong> 个产品</p>
                <p>× 全部 <strong>{units.length}</strong> 个销售单位</p>
                <p className="text-xs text-muted-foreground">
                  共 {filteredProducts.length * units.length} 条配置（覆盖已有规则）
                </p>
              </>
            ) : (
              <>
                <p>
                  产品：
                  <strong>
                    {products.find((p) => p.id === batchSettleTarget)?.name || "-"}
                  </strong>
                </p>
                <p>× 全部 <strong>{units.length}</strong> 个销售单位（覆盖已有规则）</p>
              </>
            )}
          </div>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>结算方式</Label>
              <Select
                value={settleForm.settlementType}
                onValueChange={(v) => setSettleForm({
                  ...settleForm,
                  settlementType: v as "percentage" | "fixed",
                })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">按售价百分比</SelectItem>
                  <SelectItem value="fixed">按件固定金额</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settleForm.settlementType === "percentage" ? (
              <div className="space-y-2">
                <Label>结算比例 (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={settleForm.settlementRate}
                  onChange={(e) => setSettleForm({
                    ...settleForm,
                    settlementRate: Number(e.target.value),
                  })}
                  placeholder="如：80"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>每件结算金额 (¥)</Label>
                <Input
                  type="number"
                  value={settleForm.settlementAmount}
                  onChange={(e) => setSettleForm({
                    ...settleForm,
                    settlementAmount: Number(e.target.value),
                  })}
                  placeholder="如：500"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>结算说明</Label>
              <Input
                value={settleForm.note}
                onChange={(e) => setSettleForm({ ...settleForm, note: e.target.value })}
                placeholder="可选"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={batchSaving} onClick={() => setBatchSettleTarget(null)}>
              取消
            </Button>
            <Button disabled={batchSaving} onClick={handleBatchSettleSave}>
              {batchSaving ? "保存中…" : "一键应用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 编辑人员提成弹窗 ===== */}
      <Dialog open={!!ppcEditKey} onOpenChange={(open) => !open && setPpcEditKey(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>配置人员提成</DialogTitle>
          </DialogHeader>
          {ppcTarget?.product && ppcTarget?.unit && ppcTarget?.person && (
            <div className="mb-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm space-y-1">
              <p><span className="text-muted-foreground">产品：</span>{ppcTarget.product.name}</p>
              <p><span className="text-muted-foreground">销售单位：</span>{ppcTarget.unit.name}</p>
              <p><span className="text-muted-foreground">销售人员：</span>{ppcTarget.person.name}（{ppcTarget.person.position}）</p>
            </div>
          )}
          <div className="space-y-4 py-2">
            {/* 管理提成 */}
            <div className="rounded-lg border-2 border-emerald-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-700">管理提成</Badge>
                <span className="text-xs text-muted-foreground">按团队销售额计算</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">提成比例 (%)</Label>
                  <Input type="number" step="0.1" value={ppcForm.managementCommissionRate}
                    onChange={(e) => setPpcForm({ ...ppcForm, managementCommissionRate: Number(e.target.value) })} placeholder="如：2" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">起算门槛 (¥)</Label>
                  <Input type="number" value={ppcForm.managementCommissionThreshold}
                    onChange={(e) => setPpcForm({ ...ppcForm, managementCommissionThreshold: Number(e.target.value) })} placeholder="如：100000" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">发放条件</Label>
                <Input value={ppcForm.managementCommissionCondition}
                  onChange={(e) => setPpcForm({ ...ppcForm, managementCommissionCondition: e.target.value })} placeholder="如：团队达标后发放" />
              </div>
              <p className="text-xs text-muted-foreground">
                计算公式：(团队销售额 - 起算门槛) × 提成比例%
              </p>
            </div>

            {/* 个人提成 */}
            <div className="rounded-lg border-2 border-orange-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-orange-100 text-orange-700">个人提成</Badge>
                <span className="text-xs text-muted-foreground">按个人该产品销售额计算</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">提成比例 (%)</Label>
                  <Input type="number" step="0.1" value={ppcForm.personalCommissionRate}
                    onChange={(e) => setPpcForm({ ...ppcForm, personalCommissionRate: Number(e.target.value) })} placeholder="如：3" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">起算门槛 (¥)</Label>
                  <Input type="number" value={ppcForm.personalCommissionThreshold}
                    onChange={(e) => setPpcForm({ ...ppcForm, personalCommissionThreshold: Number(e.target.value) })} placeholder="如：50000" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">发放条件</Label>
                <Input value={ppcForm.personalCommissionCondition}
                  onChange={(e) => setPpcForm({ ...ppcForm, personalCommissionCondition: e.target.value })} placeholder="如：个人达标后发放" />
              </div>
              <p className="text-xs text-muted-foreground">
                计算公式：(个人该产品销售额 - 起算门槛) × 提成比例%
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            {ppcEditKey && findPpc(ppcEditKey.productId, ppcEditKey.unitId, ppcEditKey.personnelId)?.id && (
              <Button variant="destructive" onClick={handlePpcClear}>删除配置</Button>
            )}
            <Button variant="outline" onClick={() => setPpcEditKey(null)}>取消</Button>
            <Button onClick={handlePpcSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
