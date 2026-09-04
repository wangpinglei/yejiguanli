import { useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/format";
import { filterByMonth, getTotalSalaryCost } from "@/lib/salary";
import {
  calcSaleSettlementIncome,
  formatSettlementPeriod,
} from "@/lib/settlement";
import type { Product, SalesUnit } from "@/types";
import {
  Building2, Package, Pencil, Trash2, Search, Calculator, Layers,
  ChevronDown, ChevronRight, Percent, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import MBusinessDomainSection, {
  MProductDomainSelect,
  UNCATEGORIZED,
  getProductDomainKey,
} from "./ProductSettlement/components/m-business-domain-section";
import MUnitSettlementList from "./ProductSettlement/components/m-unit-settlement-list";
import MProductMergeDialog from "./ProductSettlement/components/m-product-merge-dialog";
import { groupSimilarProducts } from "@/lib/productMerge";

function toggleIdInSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

const EMPTY_SETTLE_FORM = {
  settlementType: "percentage" as "percentage" | "fixed",
  settlementRate: 100,
  settlementAmount: 0,
  effectiveFrom: "",
  effectiveTo: "",
  rewardAmount: 0,
  rewardFrom: "",
  rewardTo: "",
  excludeFromTeamMgmt: false,
  excludeFromPerformance: false,
  note: "",
};

export default function ProductSettlement() {
  const {
    products, allSalesRecords: salesRecords,
    unitProductSettlements: upsList,
    productPersonCommissions: ppcList,
    personnel,
    teamMgmtCommissionRules,
    performanceTargets,
    upsertUnitProductSettlement, deleteUnitProductSettlement,
    batchUpsertUnitProductSettlements,
    updateProduct,
  } = useData();
  const teamMgmtContext = useMemo(() => ({
    rules: teamMgmtCommissionRules,
    targets: performanceTargets,
    upsList,
  }), [teamMgmtCommissionRules, performanceTargets, upsList]);
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
  const [settleForm, setSettleForm] = useState({ ...EMPTY_SETTLE_FORM });

  // ---- 批量结算：null=关闭；'all'=所选业务域产品；string=单个产品 id ----
  const [batchSettleTarget, setBatchSettleTarget] = useState<string | "all" | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);

  // ---- 折叠：默认全部收起，点击再展开 ----
  const [expandedSettleProductIds, setExpandedSettleProductIds] = useState<Set<string>>(new Set());
  const [selectedDomainKeys, setSelectedDomainKeys] = useState<string[]>([]);
  const [settleConfigExpanded, setSettleConfigExpanded] = useState(true);
  /** 配置缺口速查：未设结算 / 未设个人提成 */
  const [configGapFilter, setConfigGapFilter] = useState<'all' | 'noSettle' | 'noCommission'>('all');
  /** 结算列表视角：按单位（默认）| 按产品 */
  const [settleViewMode, setSettleViewMode] = useState<'unit' | 'product'>('unit');
  const [mergeOpen, setMergeOpen] = useState(false);

  // 按月过滤销售记录
  const monthlySales = useMemo(() => filterByMonth(salesRecords, selectedMonth), [salesRecords, selectedMonth]);

  // 仅展示销售记录里出现过的产品（配置来源 = 销售）
  const productsFromSales = useMemo(() => {
    const idSet = new Set(salesRecords.map((s) => s.productId).filter(Boolean));
    return products.filter((p) => idSet.has(p.id));
  }, [products, salesRecords]);

  const similarGroups = useMemo(() => groupSimilarProducts(products), [products]);

  // 产品列表（搜索过滤）
  const filteredProducts = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return productsFromSales.filter(
      (p) => !kw || p.name.toLowerCase().includes(kw) || (p.category || "").toLowerCase().includes(kw)
    );
  }, [productsFromSales, search]);

  const productsMissingSettle = useMemo(() => {
    const configuredIds = new Set(upsList.map((x) => x.productId));
    return filteredProducts.filter((p) => !configuredIds.has(p.id));
  }, [filteredProducts, upsList]);

  const productsMissingCommission = useMemo(() => {
    const configuredIds = new Set(ppcList.map((x) => x.productId));
    return filteredProducts.filter((p) => !configuredIds.has(p.id));
  }, [filteredProducts, ppcList]);

  // 按上方勾选的业务域过滤结算配置产品；缺口速查可绕过业务域勾选
  const settleConfigProducts = useMemo(() => {
    let list = filteredProducts;
    if (configGapFilter === 'noSettle') {
      const ids = new Set(productsMissingSettle.map((p) => p.id));
      list = list.filter((p) => ids.has(p.id));
    } else if (configGapFilter === 'noCommission') {
      const ids = new Set(productsMissingCommission.map((p) => p.id));
      list = list.filter((p) => ids.has(p.id));
    } else if (selectedDomainKeys.length === 0) {
      return [];
    } else {
      list = list.filter((p) =>
        selectedDomainKeys.includes(getProductDomainKey(p)),
      );
    }
    return list;
  }, [
    filteredProducts, selectedDomainKeys, configGapFilter,
    productsMissingSettle, productsMissingCommission,
  ]);

  // 按单位视角始终可看；按产品需勾选业务域或走缺口速查
  const showProductSettleList =
    configGapFilter !== 'all' || selectedDomainKeys.length > 0;

  function handleToggleGapFilter(next: 'noSettle' | 'noCommission') {
    setConfigGapFilter((prev) => {
      const value = prev === next ? 'all' : next;
      if (value !== 'all') {
        setSettleConfigExpanded(true);
        const gapList = value === 'noSettle' ? productsMissingSettle : productsMissingCommission;
        const keys = Array.from(
          new Set(gapList.map((p) => getProductDomainKey(p))),
        );
        if (keys.length > 0) setSelectedDomainKeys(keys);
      }
      return value;
    });
  }

  const selectedDomainLabel = useMemo(() => {
    if (selectedDomainKeys.length === 0) return "";
    return selectedDomainKeys
      .map((k) => (k === UNCATEGORIZED ? "未分类" : k))
      .join("、");
  }, [selectedDomainKeys]);

  // 某产品×某单位的已配置结算
  const findUps = (productId: string, unitId: string) =>
    upsList.find((x) => x.salesUnitId === unitId && x.productId === productId);

  function getUnitsForProduct(_productId: string): SalesUnit[] {
    return units;
  }

  // 某产品×某单位的本月结算收入预览（按销售日匹配生效区间 + 奖励）
  const calcUnitIncome = (productId: string, unitId: string): number => {
    return monthlySales
      .filter((s) => s.productId === productId && s.salesUnitId === unitId)
      .reduce((sum, s) => sum + calcSaleSettlementIncome(s, upsList), 0);
  };

  // 全产品本月结算收入合计
  const totalMonthIncome = useMemo(() => {
    let total = 0;
    filteredProducts.forEach((p) => {
      getUnitsForProduct(p.id).forEach((u) => { total += calcUnitIncome(p.id, u.id); });
    });
    return total;
  }, [filteredProducts, units, monthlySales, upsList, salesRecords]);

  // 当月销售提成合计（管理+个人，按单位×人员配置，与成本/利润页一致）
  const totalMonthSalesCommission = useMemo(() => {
    return getTotalSalaryCost(
      units.map((u) => u.id),
      personnel,
      salesRecords,
      products,
      selectedMonth,
      [],
      ppcList,
      teamMgmtContext,
    ).grandSalesCommission;
  }, [units, personnel, salesRecords, products, selectedMonth, ppcList, teamMgmtContext]);


  // ---- 结算编辑 ----
  const openSettleEdit = (productId: string, unitId: string) => {
    const ups = findUps(productId, unitId);
    setSettleForm({
      settlementType: ups?.settlementType || "percentage",
      settlementRate: ups?.settlementRate ?? 100,
      settlementAmount: ups?.settlementAmount || 0,
      effectiveFrom: ups?.effectiveFrom || "",
      effectiveTo: ups?.effectiveTo || "",
      rewardAmount: ups?.rewardAmount || 0,
      rewardFrom: ups?.rewardFrom || "",
      rewardTo: ups?.rewardTo || "",
      excludeFromTeamMgmt: !!ups?.excludeFromTeamMgmt,
      excludeFromPerformance: !!ups?.excludeFromPerformance,
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
        effectiveFrom: settleForm.effectiveFrom || "",
        effectiveTo: settleForm.effectiveTo || "",
        rewardAmount: settleForm.rewardAmount || 0,
        rewardFrom: settleForm.rewardFrom || "",
        rewardTo: settleForm.rewardTo || "",
        excludeFromTeamMgmt: !!settleForm.excludeFromTeamMgmt,
        excludeFromPerformance: !!settleForm.excludeFromPerformance,
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
    setSettleForm({ ...EMPTY_SETTLE_FORM });
    setBatchSettleTarget(target);
  };

  const handleBatchSettleSave = async () => {
    if (!batchSettleTarget) return;
    const productIds =
      batchSettleTarget === "all"
        ? settleConfigProducts.map((p) => p.id)
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
        effectiveFrom: settleForm.effectiveFrom || "",
        effectiveTo: settleForm.effectiveTo || "",
        rewardAmount: settleForm.rewardAmount || 0,
        rewardFrom: settleForm.rewardFrom || "",
        rewardTo: settleForm.rewardTo || "",
        excludeFromTeamMgmt: !!settleForm.excludeFromTeamMgmt,
        excludeFromPerformance: !!settleForm.excludeFromPerformance,
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

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      options.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
    }
    return options;
  }, []);

  const [extraDomains, setExtraDomains] = useState<string[]>([]);

  const domainOptions = useMemo(() => {
    const set = new Set<string>();
    productsFromSales.forEach((p) => {
      const c = (p.category || '').trim();
      if (c) set.add(c);
    });
    extraDomains.forEach((d) => {
      const c = d.trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [productsFromSales, extraDomains]);

  function handleAddDomain(name: string) {
    const c = name.trim();
    if (!c) return;
    setExtraDomains((prev) => (prev.includes(c) ? prev : [...prev, c]));
  }

  async function handleRemoveDomain(name: string) {
    const c = name.trim();
    if (!c) return;
    setExtraDomains((prev) => prev.filter((d) => d !== c));
    const targets = productsFromSales.filter((p) => (p.category || '').trim() === c);
    for (const p of targets) {
      await updateProduct(p.id, { category: '' });
    }
  }

  async function handleClearAllDomains() {
    setExtraDomains([]);
    const targets = productsFromSales.filter((p) => (p.category || '').trim());
    for (const p of targets) {
      await updateProduct(p.id, { category: '' });
    }
  }

  async function handleUpdateProductCategory(productId: string, category: string) {
    await updateProduct(productId, { category });
  }

  const canEdit = canEditProduct && !isReadOnly;
  const editTarget = editKey
    ? { product: products.find((p) => p.id === editKey.productId), unit: units.find((u) => u.id === editKey.unitId) }
    : null;
  return (
    <div>
      <PageHeader
        title="业务域产品结算和分类"
        description="为产品设置业务域分类并查看汇总；同时配置单位×产品结算比例、生效期与特殊奖励。"
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
            暂无来自销售的产品。请先到「销售记录」导入或录入订单，产品会按名称自动出现后再配置单位结算。
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
        <Card className="hover:shadow-md transition-shadow">
          <Link to="/personnel" className="block">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50">
                <Percent className="h-6 w-6 text-violet-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{selectedMonth} 销售提成合计</p>
                <p className="text-xl font-bold text-violet-600">{formatCurrency(totalMonthSalesCommission)}</p>
                <p className="text-[10px] text-muted-foreground">个人提成请到人员管理配置</p>
              </div>
            </CardContent>
          </Link>
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
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
              <Building2 className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">销售单位</p>
              <p className="text-xl font-bold text-indigo-600">{units.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索 + 配置缺口速查 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜索产品名称或分类..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Badge variant="secondary">共 {filteredProducts.length} 个产品</Badge>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300 text-amber-800 hover:bg-amber-50"
          onClick={() => setMergeOpen(true)}
        >
          <Layers className="mr-1.5 h-3.5 w-3.5" />
          {similarGroups.length > 0
            ? `疑似重复（${similarGroups.length} 组）`
            : "合并相同产品"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={configGapFilter === 'noSettle' ? 'default' : 'outline'}
          className={configGapFilter === 'noSettle'
            ? ''
            : 'border-amber-300 text-amber-800 hover:bg-amber-50'}
          onClick={() => handleToggleGapFilter('noSettle')}
        >
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
          未设结算（{productsMissingSettle.length}）
        </Button>
        <Button
          type="button"
          size="sm"
          variant={configGapFilter === 'noCommission' ? 'default' : 'outline'}
          className={configGapFilter === 'noCommission'
            ? ''
            : 'border-violet-300 text-violet-800 hover:bg-violet-50'}
          onClick={() => handleToggleGapFilter('noCommission')}
        >
          <Percent className="mr-1.5 h-3.5 w-3.5" />
          未设提成（{productsMissingCommission.length}）
        </Button>
        {configGapFilter !== 'all' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfigGapFilter('all')}
          >
            清除缺口筛选
          </Button>
        )}
      </div>

      <MBusinessDomainSection
        products={filteredProducts}
        monthlySales={monthlySales}
        upsList={upsList}
        selectedMonth={selectedMonth}
        canEdit={canEdit}
        domainOptions={domainOptions}
        selectedDomainKeys={selectedDomainKeys}
        onSelectedDomainKeysChange={setSelectedDomainKeys}
        onAddDomain={handleAddDomain}
        onRemoveDomain={handleRemoveDomain}
        onClearAllDomains={handleClearAllDomains}
        onUpdateCategory={handleUpdateProductCategory}
      />

      {/* ==================== 结算配置：按单位（默认）/ 按产品 ==================== */}
      <div className="mb-8 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            className="flex items-start gap-2 text-left min-w-0"
            onClick={() => setSettleConfigExpanded((v) => !v)}
          >
            {settleConfigExpanded
              ? <ChevronDown className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
            <div className="min-w-0">
              <h3 className="text-base font-semibold">
                {configGapFilter === 'noSettle'
                  ? '未设置结算比例的产品'
                  : configGapFilter === 'noCommission'
                    ? '未设置销售提成的产品'
                    : '产品结算配置'}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {configGapFilter === 'noSettle' && (
                  <>共 {productsMissingSettle.length} 个产品尚无任意单位结算配置</>
                )}
                {configGapFilter === 'noCommission' && (
                  <>
                    共 {productsMissingCommission.length} 个产品尚无「人员×产品」个人提成；
                    请到
                    <Link to="/personnel" className="mx-1 text-violet-700 underline">
                      人员管理
                    </Link>
                    按人配置。下方仍可查看/补全结算。
                  </>
                )}
                {configGapFilter === 'all' && settleViewMode === 'unit' && (
                  <>按销售单位查看各业务域产品的结算比例；未配置项高亮提示</>
                )}
                {configGapFilter === 'all' && settleViewMode === 'product' && (
                  <>
                    当前业务域：{selectedDomainLabel || '（未勾选，请先勾选）'}
                    （{settleConfigProducts.length} 个产品）
                  </>
                )}
              </p>
              {configGapFilter === 'all' && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  可设置结算比例/金额、生效时间、特殊时段按件结算奖励，以及是否不参与团队管理提成基数
                </p>
              )}
            </div>
          </button>
          <div className="flex flex-wrap gap-2 shrink-0 items-center">
            <div className="flex rounded-md border p-0.5 bg-muted/30">
              <Button
                type="button"
                size="sm"
                variant={settleViewMode === 'unit' ? 'default' : 'ghost'}
                className="h-8"
                onClick={() => setSettleViewMode('unit')}
              >
                <Building2 className="mr-1.5 h-3.5 w-3.5" />
                按单位
              </Button>
              <Button
                type="button"
                size="sm"
                variant={settleViewMode === 'product' ? 'default' : 'ghost'}
                className="h-8"
                onClick={() => setSettleViewMode('product')}
              >
                <Package className="mr-1.5 h-3.5 w-3.5" />
                按产品
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettleConfigExpanded((v) => !v)}
            >
              {settleConfigExpanded ? "折叠" : "展开"}
            </Button>
            {canEdit && settleConfigExpanded && settleViewMode === 'product'
              && settleConfigProducts.length > 0 && units.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => openBatchSettle("all")}>
                <Layers className="mr-2 h-4 w-4" />
                批量设置所选业务域产品
              </Button>
            )}
          </div>
        </div>

        {settleConfigExpanded && settleViewMode === 'unit' && (
          <MUnitSettlementList
            units={units}
            products={filteredProducts}
            upsList={upsList}
            ppcList={ppcList}
            monthlySales={monthlySales}
            selectedMonth={selectedMonth}
            canEdit={canEdit}
            selectedDomainKeys={
              configGapFilter === 'all' ? selectedDomainKeys : []
            }
            search={search}
            gapFilter={configGapFilter}
            onEdit={openSettleEdit}
            onClear={handleSettleClear}
          />
        )}

        {settleConfigExpanded && settleViewMode === 'product' && !showProductSettleList && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              请先在上方勾选业务域，或点击「未设结算 / 未设提成」速查配置缺口
            </CardContent>
          </Card>
        )}

        {settleConfigExpanded && settleViewMode === 'product' && showProductSettleList && settleConfigProducts.map((product: Product) => {
          const productUnits = getUnitsForProduct(product.id);
          const isExpanded = expandedSettleProductIds.has(product.id);
          const configuredCount = productUnits.filter((u) => findUps(product.id, u.id)).length;
          const hasCommission = ppcList.some((x) => x.productId === product.id);
          return (
            <Card key={product.id}>
              <CardContent className="p-0">
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <button
                    type="button"
                    className="flex flex-1 min-w-0 items-center gap-3 text-left"
                    onClick={() => setExpandedSettleProductIds((prev) => toggleIdInSet(prev, product.id))}
                  >
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{product.name}</p>
                      <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>
                          {productUnits.length} 个单位
                          · 结算已配 {configuredCount}
                        </span>
                        {configuredCount === 0 && (
                          <Badge variant="outline" className="border-amber-300 text-amber-800 text-[10px] px-1.5 py-0">
                            未设结算
                          </Badge>
                        )}
                        {!hasCommission && (
                          <Badge variant="outline" className="border-violet-300 text-violet-800 text-[10px] px-1.5 py-0">
                            未设提成
                          </Badge>
                        )}
                      </p>
                    </div>
                  </button>
                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MProductDomainSelect
                      product={product}
                      domainOptions={domainOptions}
                      canEdit={canEdit}
                      onChange={(category) =>
                        handleUpdateProductCategory(product.id, category)
                      }
                    />
                  </div>
                  {canEdit && productUnits.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        openBatchSettle(product.id);
                      }}
                    >
                      <Layers className="mr-1.5 h-3.5 w-3.5" />批量设置全部单位</Button>
                  )}
                </div>
                {isExpanded && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead>销售单位</TableHead>
                          <TableHead className="text-right">结算方式</TableHead>
                          <TableHead className="text-right">结算比例 / 金额</TableHead>
                          <TableHead>生效时间</TableHead>
                          <TableHead className="text-right">结算奖励</TableHead>
                          <TableHead>管理/业绩</TableHead>
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
                              <TableCell className="text-xs text-muted-foreground">
                                {ups ? formatSettlementPeriod(ups) : "-"}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {ups && (ups.rewardAmount || 0) > 0 ? (
                                  <span className="text-amber-600">
                                    +{formatCurrency(ups.rewardAmount || 0)}/件
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1 items-start">
                                  {ups?.excludeFromTeamMgmt ? (
                                    <Badge className="bg-slate-100 text-slate-700 text-[10px]">不参与管理提成</Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">管理提成·参与</span>
                                  )}
                                  {ups?.excludeFromPerformance ? (
                                    <Badge className="bg-orange-100 text-orange-800 text-[10px]">不参与业绩汇入</Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">业绩汇入·参与</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium text-cyan-600">
                                {income > 0 ? formatCurrency(income) : "-"}
                              </TableCell>
                              <TableCell className="text-right">
                                {canEdit ? (
                                  <div className="flex justify-end gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => {
                                      setExpandedSettleProductIds((prev) => new Set(prev).add(product.id));
                                      openSettleEdit(product.id, unit.id);
                                    }}>
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
                            <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                              暂无销售单位，请先在「销售单位」中录入
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {settleConfigExpanded && settleViewMode === 'product' && showProductSettleList
          && settleConfigProducts.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              {configGapFilter === 'noSettle'
                ? '当前筛选下没有未设置结算的产品'
                : configGapFilter === 'noCommission'
                  ? '当前筛选下没有未设置销售提成的产品'
                  : '所选业务域下暂无匹配产品（可调整搜索，或先为产品设置业务域）'}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ===== 编辑结算弹窗 ===== */}
      <Dialog open={!!editKey} onOpenChange={(open) => !open && setEditKey(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>产品结算设置</DialogTitle>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>生效开始日期</Label>
                <Input type="date" value={settleForm.effectiveFrom}
                  onChange={(e) => setSettleForm({ ...settleForm, effectiveFrom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>生效结束日期</Label>
                <Input type="date" value={settleForm.effectiveTo}
                  onChange={(e) => setSettleForm({ ...settleForm, effectiveTo: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">留空表示长期有效；销售日不在区间内则按全额结算</p>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-3">
              <p className="text-sm font-medium text-amber-800">特殊时段结算奖励（可选）</p>
              <div className="space-y-2">
                <Label>每件奖励金额 (¥)</Label>
                <Input type="number" value={settleForm.rewardAmount}
                  onChange={(e) => setSettleForm({ ...settleForm, rewardAmount: Number(e.target.value) })} placeholder="0 表示无奖励" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>奖励开始日期</Label>
                  <Input type="date" value={settleForm.rewardFrom}
                    onChange={(e) => setSettleForm({ ...settleForm, rewardFrom: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>奖励结束日期</Label>
                  <Input type="date" value={settleForm.rewardTo}
                    onChange={(e) => setSettleForm({ ...settleForm, rewardTo: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">奖励区间留空时，与上方结算生效时间相同</p>
            </div>
            <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
              <Checkbox
                checked={settleForm.excludeFromTeamMgmt}
                onCheckedChange={(v) =>
                  setSettleForm({ ...settleForm, excludeFromTeamMgmt: v === true })
                }
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                不参与团队管理提成基数
                <span className="block text-xs text-muted-foreground mt-0.5">
                  勾选后，该单位此产品的实收不计入团队管理提成池
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
              <Checkbox
                checked={settleForm.excludeFromPerformance}
                onCheckedChange={(v) =>
                  setSettleForm({ ...settleForm, excludeFromPerformance: v === true })
                }
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                不参与业绩汇入
                <span className="block text-xs text-muted-foreground mt-0.5">
                  勾选后，该单位此产品不计入战报个人/团队业绩
                </span>
              </span>
            </label>
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
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>一键批量设置产品结算</DialogTitle>
          </DialogHeader>
          <div className="mb-2 rounded-lg bg-cyan-50 border border-cyan-200 px-3 py-2 text-sm space-y-1">
            {batchSettleTarget === "all" ? (
              <>
                <p>将应用到所选业务域 <strong>{settleConfigProducts.length}</strong> 个产品</p>
                <p>× 全部 <strong>{units.length}</strong> 个销售单位</p>
                <p className="text-xs text-muted-foreground">
                  共 {settleConfigProducts.length * units.length} 条配置（覆盖已有规则）
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>生效开始日期</Label>
                <Input type="date" value={settleForm.effectiveFrom}
                  onChange={(e) => setSettleForm({ ...settleForm, effectiveFrom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>生效结束日期</Label>
                <Input type="date" value={settleForm.effectiveTo}
                  onChange={(e) => setSettleForm({ ...settleForm, effectiveTo: e.target.value })} />
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-3">
              <p className="text-sm font-medium text-amber-800">特殊时段结算奖励（可选）</p>
              <div className="space-y-2">
                <Label>每件奖励金额 (¥)</Label>
                <Input type="number" value={settleForm.rewardAmount}
                  onChange={(e) => setSettleForm({ ...settleForm, rewardAmount: Number(e.target.value) })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>奖励开始</Label>
                  <Input type="date" value={settleForm.rewardFrom}
                    onChange={(e) => setSettleForm({ ...settleForm, rewardFrom: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>奖励结束</Label>
                  <Input type="date" value={settleForm.rewardTo}
                    onChange={(e) => setSettleForm({ ...settleForm, rewardTo: e.target.value })} />
                </div>
              </div>
            </div>
            <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
              <Checkbox
                checked={settleForm.excludeFromTeamMgmt}
                onCheckedChange={(v) =>
                  setSettleForm({ ...settleForm, excludeFromTeamMgmt: v === true })
                }
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                不参与团队管理提成基数
                <span className="block text-xs text-muted-foreground mt-0.5">
                  批量应用到所选产品×单位
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
              <Checkbox
                checked={settleForm.excludeFromPerformance}
                onCheckedChange={(v) =>
                  setSettleForm({ ...settleForm, excludeFromPerformance: v === true })
                }
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                不参与业绩汇入
                <span className="block text-xs text-muted-foreground mt-0.5">
                  批量应用到所选产品×单位；不计入战报业绩
                </span>
              </span>
            </label>
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

      <MProductMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        canEdit={canEdit}
      />

    </div>
  );
}
