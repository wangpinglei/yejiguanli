import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate, getYearMonth } from "@/lib/format";
import { getTotalSalaryCost, filterByMonth } from "@/lib/salary";
import { calcSaleSettlementIncome } from "@/lib/settlement";
import {
  listRecurringYearMonths,
  matchesRecurringYearMonth,
} from "@/utils/recurringRecord";
import type { RevenueSettlement } from "@/types";
import {
  TrendingUp, DollarSign, Award, AlertTriangle,
  ChevronDown, ChevronRight, Pencil, Receipt, CheckCircle2, Clock,
  Calculator,
} from "lucide-react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";

import MPerformanceEstimateSheet from "./ProfitAnalysis/components/m-performance-estimate-sheet";

const COLORS = ["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#eab308"];

export default function ProfitAnalysis() {
  const { products, monthlyAdjustments, upsertRevenueSettlement, productPersonCommissions, teamMgmtCommissionRules, performanceTargets } = useData();
  const { user } = useAuth();
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords, visibleCostRecords: costRecords, visibleIncomeRecords: incomeRecords, visibleRevenueSettlements: revenueSettlements, visibleUnitProductSettlements, canEditCost, isReadOnly } = usePermissions();
  const teamMgmtContext = useMemo(() => ({
    rules: teamMgmtCommissionRules,
    targets: performanceTargets,
    upsList: visibleUnitProductSettlements,
  }), [teamMgmtCommissionRules, performanceTargets, visibleUnitProductSettlements]);

  /** 空数组 = 全部单位 */
  const [filterUnitIds, setFilterUnitIds] = useState<string[]>([]);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  // 收入明细展开状态
  const [expandedIncomeRows, setExpandedIncomeRows] = useState<Set<string>>(new Set());
  // 结算调整弹窗
  const [settlementDialog, setSettlementDialog] = useState<{ unitId: string; unitName: string; estimated: number } | null>(null);
  const [settlementForm, setSettlementForm] = useState({ actualAmount: 0, remark: "" });
  const [estimateOpen, setEstimateOpen] = useState(false);

  const isAllFilterUnits = filterUnitIds.length === 0;
  function matchFilterUnit(unitId: string): boolean {
    return isAllFilterUnits || filterUnitIds.includes(unitId);
  }
  const resolvedFilterUnitIds = useMemo(
    () => (isAllFilterUnits ? salesUnits.map((u) => u.id) : filterUnitIds),
    [isAllFilterUnits, salesUnits, filterUnitIds],
  );
  const filterUnitLabel = useMemo(() => {
    if (isAllFilterUnits) return "全部单位";
    if (filterUnitIds.length === 1) {
      return salesUnits.find((u) => u.id === filterUnitIds[0])?.name || "已选 1 个单位";
    }
    return `已选 ${filterUnitIds.length} 个单位`;
  }, [isAllFilterUnits, filterUnitIds, salesUnits]);

  function handleSelectAllFilterUnits() {
    setFilterUnitIds([]);
  }

  function handleToggleFilterUnit(unitId: string, checked: boolean) {
    // 全部模式下勾选某一单位 → 只选该单位（支持单选）
    if (isAllFilterUnits) {
      if (checked) setFilterUnitIds([unitId]);
      return;
    }
    let next = checked
      ? Array.from(new Set([...filterUnitIds, unitId]))
      : filterUnitIds.filter((id) => id !== unitId);
    // 取消到空或勾满全部 → 回到全部
    if (next.length === 0 || next.length === salesUnits.length) {
      next = [];
    }
    setFilterUnitIds(next);
  }

  // 按月过滤
  const monthlySales = useMemo(() => filterByMonth(salesRecords, selectedMonth), [salesRecords, selectedMonth]);
  const monthlyCosts = useMemo(
    () => costRecords.filter((c) => matchesRecurringYearMonth(c, selectedMonth)),
    [costRecords, selectedMonth],
  );

  // 筛选数据
  const filteredSales = useMemo(() => {
    return monthlySales.filter((s) => matchFilterUnit(s.salesUnitId));
  }, [monthlySales, filterUnitIds, isAllFilterUnits]);

  const filteredCosts = useMemo(() => {
    return monthlyCosts.filter((c) => matchFilterUnit(c.salesUnitId));
  }, [monthlyCosts, filterUnitIds, isAllFilterUnits]);

  // 结算收入（按单位×产品结算规则：生效区间 + 特殊奖励）
  const calcSettlementIncome = (sales: typeof filteredSales) => {
    return sales.reduce(
      (sum, s) => sum + calcSaleSettlementIncome(s, visibleUnitProductSettlements),
      0,
    );
  };

  // 销售提成 = 单位×人员的管理提成 + 个人提成（来自成本管理配置，计入成本）
  function getSalesCommission(unitIds: string[], yearMonth: string): number {
    return getTotalSalaryCost(
unitIds,
      personnel,
      salesRecords,
      products,
      yearMonth,
      monthlyAdjustments,productPersonCommissions,
      teamMgmtContext,
    ).grandSalesCommission;
  }

  // 其他收入（录入侧）按月过滤，提前供盈亏汇总使用
  const monthlyIncomeRecords = useMemo(() => {
    const targetM = parseInt(selectedMonth.slice(5, 7), 10);
    return incomeRecords
      .filter((r) => {
        if (!matchFilterUnit(r.salesUnitId)) return false;
        if (r.isRecurring) {
          const months = r.recurringMonths || [1,2,3,4,5,6,7,8,9,10,11,12];
          if (!months.includes(targetM)) return false;
          if (r.recurringStartDate && selectedMonth < r.recurringStartDate.slice(0, 7)) return false;
          if (r.recurringEndDate && selectedMonth > r.recurringEndDate.slice(0, 7)) return false;
          return true;
        }
        return getYearMonth(r.date) === selectedMonth;
      })
      .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  }, [incomeRecords, filterUnitIds, isAllFilterUnits, selectedMonth]);

  // 汇总（按月度）
  const summary = useMemo(() => {
    const totalSalesAmount = filteredSales.reduce((sum, s) => sum + s.totalAmount, 0); // 实收总额
    const totalSettlementIncome = calcSettlementIncome(filteredSales); // 结算收入
    const unitIds = resolvedFilterUnitIds;
    const salaryData = getTotalSalaryCost(
unitIds,
      personnel,
      salesRecords,
      products,
      selectedMonth,
      monthlyAdjustments,productPersonCommissions,
      teamMgmtContext,
    );
    const totalCommission = salaryData.grandSalesCommission; // 销售提成（按人）
    const totalOtherIncome = monthlyIncomeRecords.reduce((sum, r) => sum + r.totalAmount, 0)
    const totalRevenue = totalSettlementIncome + totalOtherIncome
    const productProfit = totalSettlementIncome - totalCommission; // 产品利润 = 结算收入 - 提成
    const manualCost = filteredCosts.reduce((sum, c) => sum + c.totalCost, 0);
    const salaryCost = salaryData.grandTotal;
    const totalCost = manualCost + salaryCost;
    // 净利润 =（结算收入 + 其他收入）- 总成本（总成本已含人员提成）
    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    return {
      totalSalesAmount,
      totalSettlementIncome,
      totalOtherIncome,
      totalRevenue,
      totalCommission,
      productProfit,
      totalCost,
      manualCost,
      salaryCost,
      totalProfit,
      profitMargin,
    };
  }, [
    filteredSales,
    filteredCosts,
    resolvedFilterUnitIds,
    personnel,
    salesRecords,
    products,
    selectedMonth,
    monthlyAdjustments,
    visibleUnitProductSettlements,
    productPersonCommissions,
    teamMgmtContext,
    monthlyIncomeRecords,
  ]);

  // 月度趋势
  const monthlyData = useMemo(() => {
    const monthMap = new Map<string, { salesAmount: number; settlementIncome: number; otherIncome: number; cost: number }>();
    salesRecords.forEach((s) => {
      if (!matchFilterUnit(s.salesUnitId)) return;
      const ym = getYearMonth(s.saleDate);
      const existing = monthMap.get(ym) || { salesAmount: 0, settlementIncome: 0, otherIncome: 0, cost: 0 };
      existing.salesAmount += s.totalAmount;
      existing.settlementIncome += calcSaleSettlementIncome(s, visibleUnitProductSettlements);
      monthMap.set(ym, existing);
    });
    costRecords.forEach((c) => {
      if (!matchFilterUnit(c.salesUnitId)) return;
      const yearMonths = listRecurringYearMonths(c, selectedMonth);
      yearMonths.forEach((ym) => {
        const existing = monthMap.get(ym) || { salesAmount: 0, settlementIncome: 0, otherIncome: 0, cost: 0 };
        existing.cost += c.totalCost;
        monthMap.set(ym, existing);
      });
    });
    incomeRecords.forEach((r) => {
      if (!matchFilterUnit(r.salesUnitId)) return;
      const months = r.isRecurring
        ? listRecurringYearMonths(r, selectedMonth)
        : [getYearMonth(r.date)]
      months.forEach((ym) => {
        if (!ym) return
        const existing = monthMap.get(ym) || {
          salesAmount: 0,
          settlementIncome: 0,
          otherIncome: 0,
          cost: 0,
        }
        existing.otherIncome += r.totalAmount || 0
        monthMap.set(ym, existing)
      })
    })
    const unitIds = resolvedFilterUnitIds;
    return Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => {
        const monthSalaryData = getTotalSalaryCost(
unitIds,
          personnel,
          salesRecords,
          products,
          month,
          monthlyAdjustments,productPersonCommissions,
      teamMgmtContext,
    );
        const monthSalary = monthSalaryData.grandTotal;
        const revenue = data.settlementIncome + data.otherIncome
        const cost = data.cost + monthSalary
        const profit = revenue - cost
        return {
          month: month.split("-")[1] + "月",
          revenue,
          cost,
          profit,
          margin: revenue > 0 ? (profit / revenue) * 100 : 0,
        };
      });
  }, [filterUnitIds, isAllFilterUnits, resolvedFilterUnitIds, salesUnits, personnel, salesRecords, products, costRecords, incomeRecords, monthlyAdjustments, visibleUnitProductSettlements, productPersonCommissions, teamMgmtContext, selectedMonth]);

  // 各单位对比（按月度；跟随顶部单位筛选）
  const unitComparison = useMemo(() => {
    const unitsToShow =
      isAllFilterUnits
        ? salesUnits
        : salesUnits.filter((u) => filterUnitIds.includes(u.id));
    return unitsToShow.map((unit) => {
      const unitSales = monthlySales.filter((s) => s.salesUnitId === unit.id);
      const salesAmount = unitSales.reduce((sum, s) => sum + s.totalAmount, 0);
      const settlementIncome = calcSettlementIncome(unitSales);
      const unitSalary = getTotalSalaryCost(
        [unit.id],
        personnel,
        salesRecords,
        products,
        selectedMonth,
        monthlyAdjustments,
        productPersonCommissions,
        teamMgmtContext,
      );
      const commission = unitSalary.grandSalesCommission;
      const productProfit = settlementIncome - commission;
      const otherIncome = monthlyIncomeRecords
        .filter((r) => r.salesUnitId === unit.id)
        .reduce((sum, r) => sum + r.totalAmount, 0)
      const manualCost = monthlyCosts
        .filter((c) => c.salesUnitId === unit.id)
        .reduce((sum, c) => sum + c.totalCost, 0);
      const salaryCost = unitSalary.grandTotal;
      const cost = manualCost + salaryCost;
      const revenue = settlementIncome + otherIncome
      const profit = revenue - cost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return {
        id: unit.id,
        name: unit.name,
        salesAmount,
        settlementIncome,
        otherIncome,
        commission,
        productProfit,
        cost,
        profit,
        margin,
      };
    }).sort((a, b) => b.profit - a.profit);
  }, [
    salesUnits, filterUnitIds, isAllFilterUnits, monthlySales, monthlyCosts, monthlyIncomeRecords, personnel, salesRecords,
    products, selectedMonth, monthlyAdjustments, visibleUnitProductSettlements,
    productPersonCommissions, teamMgmtContext,
  ]);

  // 成本结构（按月度）
  const costStructure = useMemo(() => {
    const catMap = new Map<string, number>();
    filteredCosts.forEach((c) => {
      (c.items || []).forEach((item) => {
        catMap.set(item.category, (catMap.get(item.category) || 0) + item.amount);
      });
    });
    // 添加自动薪酬成本
    const salaryData = getTotalSalaryCost(
      resolvedFilterUnitIds,
      personnel,
      salesRecords,
      products,
      selectedMonth,
      monthlyAdjustments,
      productPersonCommissions
    );
    if (salaryData.grandTotal > 0) {
      catMap.set("人力成本（薪酬+社保+公积金）", salaryData.grandTotal);
    }
    // 销售提成（管理+个人，按单位×人员配置）单独展示便于核对
    if (salaryData.grandSalesCommission > 0) {
      catMap.set("销售提成（单位×人员）", salaryData.grandSalesCommission);
    }
    return Array.from(catMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredCosts, resolvedFilterUnitIds, personnel, salesRecords, products, selectedMonth, monthlyAdjustments, productPersonCommissions, teamMgmtContext]);

  // 人员业绩排行
  const personnelRanking = useMemo(() => {
    return personnel
      .map((p) => {
        const records = filteredSales.filter((s) => s.personnelId === p.id);
        const totalRevenue = records.reduce((sum, s) => sum + s.totalAmount, 0);
        return { name: p.name, unit: salesUnits.find((u) => u.id === p.salesUnitId)?.name || "-", count: records.length, revenue: totalRevenue };
      })
      .filter((p) => p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [personnel, filteredSales, salesUnits]);

  // 产品销售占比
  const productSales = useMemo(() => {
    const prodMap = new Map<string, number>();
    filteredSales.forEach((s) => {
      prodMap.set(s.productId, (prodMap.get(s.productId) || 0) + s.totalAmount);
    });
    return Array.from(prodMap.entries())
      .map(([pid, value]) => ({ name: products.find((p) => p.id === pid)?.name || "-", value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [filteredSales, products]);

  // ===================== 收入明细与结算 =====================
  // 按月过滤收入记录（含月度固定）

  // 按单位计算收入明细
  const incomeDetail = useMemo(() => {
    const unitsToShow = isAllFilterUnits
      ? salesUnits
      : salesUnits.filter((u) => filterUnitIds.includes(u.id));
    return unitsToShow.map((unit) => {
      // 预估业绩收入：根据单位×产品结算规则（含生效期与奖励）
      const unitSales = monthlySales.filter((s) => s.salesUnitId === unit.id);
      const estimatedAmount = unitSales.reduce(
        (sum, s) => sum + calcSaleSettlementIncome(s, visibleUnitProductSettlements),
        0,
      );
      // 查找收入结算记录
      const settlement = revenueSettlements.find((r) => r.salesUnitId === unit.id && r.yearMonth === selectedMonth);
      const isAdjusted = settlement?.isAdjusted || false;
      const actualAmount = isAdjusted && settlement?.actualAmount != null ? settlement.actualAmount : estimatedAmount;
      // 其他收入
      const unitIncomeRecords = monthlyIncomeRecords.filter((r) => r.salesUnitId === unit.id);
      const otherIncome = unitIncomeRecords.reduce((sum, r) => sum + r.totalAmount, 0);
      const totalIncome = actualAmount + otherIncome;
      const diff = actualAmount - estimatedAmount;
      return {
        unit, estimatedAmount, actualAmount, isAdjusted, settlement,
        unitSales, unitIncomeRecords, otherIncome, totalIncome, diff,
      };
    });
  }, [salesUnits, filterUnitIds, isAllFilterUnits, monthlySales, revenueSettlements, selectedMonth, monthlyIncomeRecords, visibleUnitProductSettlements]);

  // 收入合计
  const incomeTotals = useMemo(() => {
    const totalEstimated = incomeDetail.reduce((sum, d) => sum + d.estimatedAmount, 0);
    const totalActual = incomeDetail.reduce((sum, d) => sum + d.actualAmount, 0);
    const totalOther = incomeDetail.reduce((sum, d) => sum + d.otherIncome, 0);
    const grandTotal = incomeDetail.reduce((sum, d) => sum + d.totalIncome, 0);
    const adjustedCount = incomeDetail.filter((d) => d.isAdjusted).length;
    return { totalEstimated, totalActual, totalOther, grandTotal, adjustedCount };
  }, [incomeDetail]);

  // 展开/折叠收入明细行
  const toggleIncomeRow = (unitId: string) => {
    setExpandedIncomeRows((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  // 打开结算调整弹窗
  const openSettlement = (unitId: string, unitName: string, estimated: number, existing?: RevenueSettlement) => {
    setSettlementDialog({ unitId, unitName, estimated });
    setSettlementForm({
      actualAmount: existing?.actualAmount ?? estimated,
      remark: existing?.remark || "",
    });
  };

  // 保存结算调整
  const handleSettlementSubmit = async () => {
    if (!settlementDialog) return;
    const isAdjusted = settlementForm.actualAmount !== settlementDialog.estimated;
    await upsertRevenueSettlement({
      salesUnitId: settlementDialog.unitId,
      yearMonth: selectedMonth,
      estimatedAmount: settlementDialog.estimated,
      actualAmount: settlementForm.actualAmount,
      isAdjusted,
      remark: settlementForm.remark || (isAdjusted ? "手动调整实际结算金额" : ""),
      adjustedBy: user?.name,
      adjustedAt: new Date().toISOString(),
    });
    setSettlementDialog(null);
  };

  const summaryCards = [
    {
      title: "结算收入",
      value: formatCurrency(summary.totalSettlementIncome),
      icon: DollarSign,
      color: "text-cyan-600",
      bg: "bg-cyan-50",
      hint: `实收 ${formatCurrency(summary.totalSalesAmount)}`,
    },
    {
      title: "其他收入",
      value: formatCurrency(summary.totalOtherIncome),
      icon: Receipt,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      hint: "来自成本与收入录入",
    },
    {
      title: "总成本",
      value: formatCurrency(summary.totalCost),
      icon: Award,
      color: "text-orange-600",
      bg: "bg-orange-50",
      hint: `含提成 ${formatCurrency(summary.totalCommission)}`,
    },
    {
      title: "净利润",
      value: formatCurrency(summary.totalProfit),
      icon: summary.totalProfit >= 0 ? Award : AlertTriangle,
      color: summary.totalProfit >= 0 ? "text-emerald-600" : "text-red-600",
      bg: summary.totalProfit >= 0 ? "bg-emerald-50" : "bg-red-50",
      hint: "结算收入+其他收入-总成本",
    },
  ];

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

  /** 业绩测算：按弹窗内所选月份/单位汇总（unitIds 为空表示全部单位） */
  const getEstimateSummary = useCallback(
    (months: string[], unitIds: string[]) => {
      const monthList = months.length > 0
        ? months
        : monthOptions.map((m) => m.value);
      const unitIdSet = unitIds.length > 0 ? new Set(unitIds) : null;
      const matchUnit = (salesUnitId: string) =>
        !unitIdSet || unitIdSet.has(salesUnitId);

      let salesAmount = 0;
      let settlementIncome = 0;
      let otherIncome = 0;
      let manualCost = 0;
      let salaryCost = 0;
      let totalCommission = 0;
      const resolvedUnitIds =
        unitIds.length > 0 ? unitIds : salesUnits.map((u) => u.id);

      for (const month of monthList) {
        const monthSales = filterByMonth(salesRecords, month).filter((s) =>
          matchUnit(s.salesUnitId),
        );
        const monthCosts = costRecords.filter(
          (c) =>
            matchesRecurringYearMonth(c, month) && matchUnit(c.salesUnitId),
        );
        const targetM = parseInt(month.slice(5, 7), 10);
        const monthIncomes = incomeRecords.filter((r) => {
          if (!matchUnit(r.salesUnitId)) return false;
          if (r.isRecurring) {
            const monthsCfg = r.recurringMonths || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            if (!monthsCfg.includes(targetM)) return false;
            if (r.recurringStartDate && month < r.recurringStartDate.slice(0, 7)) {
              return false;
            }
            if (r.recurringEndDate && month > r.recurringEndDate.slice(0, 7)) {
              return false;
            }
            return true;
          }
          return getYearMonth(r.date) === month;
        });

        salesAmount += monthSales.reduce((sum, s) => sum + s.totalAmount, 0);
        settlementIncome += monthSales.reduce(
          (sum, s) =>
            sum + calcSaleSettlementIncome(s, visibleUnitProductSettlements),
          0,
        );
        otherIncome += monthIncomes.reduce((sum, r) => sum + r.totalAmount, 0);
        manualCost += monthCosts.reduce((sum, c) => sum + c.totalCost, 0);

        const salaryData = getTotalSalaryCost(
          resolvedUnitIds,
          personnel,
          salesRecords,
          products,
          month,
          monthlyAdjustments,
          productPersonCommissions,
          teamMgmtContext,
        );
        salaryCost += salaryData.grandTotal;
        totalCommission += salaryData.grandSalesCommission;
      }

      return {
        salesAmount,
        settlementIncome,
        otherIncome,
        totalCost: manualCost + salaryCost,
        manualCost,
        salaryCost,
        totalCommission,
      };
    },
    [
      salesRecords,
      costRecords,
      incomeRecords,
      salesUnits,
      personnel,
      products,
      monthlyAdjustments,
      productPersonCommissions,
      teamMgmtContext,
      visibleUnitProductSettlements,
      monthOptions,
    ],
  );

  return (
    <div>
      <PageHeader
        title="盈亏分析"
        description="本页负责看账：利润、趋势、结构与单位对比。成本/其他收入请到「成本与收入录入」。"
        action={
          <div className="flex gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-48 justify-between font-normal"
                >
                  <span className="truncate">{filterUnitLabel}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="end">
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  <p className="px-2 pb-1 text-xs text-muted-foreground">
                    点选单位可单选；可继续勾选多个
                  </p>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={handleSelectAllFilterUnits}
                  >
                    <Checkbox checked={isAllFilterUnits} />
                    <span>全部单位</span>
                  </button>
                  <div className="my-1 border-t" />
                  {salesUnits.map((u) => {
                    const checked =
                      !isAllFilterUnits && filterUnitIds.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            handleToggleFilterUnit(u.id, v === true)
                          }
                        />
                        <span className="truncate">{u.name}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        }
      />

            <div className="mb-4 rounded-lg border border-cyan-200 bg-cyan-50/60 px-3 py-2 text-sm text-cyan-950">
        <span className="font-medium">本页 = 盈亏分析</span>
        <span className="mx-1 text-cyan-800/70">·</span>
        净利润已含「其他收入」；录入成本/其他收入请到
        <Link
          to="/cost-management"
          className="mx-1 font-medium text-cyan-800 underline-offset-2 hover:underline"
        >
          成本与收入录入
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          { id: 'section-profit-overview', label: '盈亏总览' },
          { id: 'section-profit-trend', label: '月度趋势' },
          { id: 'section-profit-units', label: '单位对比' },
          { id: 'section-profit-income', label: '收入构成' },
        ].map((item) => (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() =>
              document.getElementById(item.id)?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          >
            {item.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={() => setEstimateOpen(true)}
        >
          <Calculator className="mr-1.5 h-4 w-4" />
          业绩测算
        </Button>
      </div>

      {/* Summary Cards */}
      <div id="section-profit-overview" className="mb-6 grid scroll-mt-20 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.bg}`}>
                  <Icon className={`h-6 w-6 ${card.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{card.title}</p>
                  <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                  {"hint" in card && card.hint ? (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{card.hint}</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Monthly Trend */}
      <Card id="section-profit-trend" className="mb-6 scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">营收·成本·利润月度趋势</CardTitle>
          <CardDescription>营收=结算收入+其他收入；成本含人力与录入支出</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip
                formatter={(value: number, name: string) => name === "利润率" ? `${value.toFixed(1)}%` : formatCurrency(value)}
                contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="revenue" name="营收" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar yAxisId="left" dataKey="cost" name="成本" fill="#f97316" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar yAxisId="left" dataKey="profit" name="利润" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
              <Line yAxisId="right" type="monotone" dataKey="margin" name="利润率" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Two Column Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Cost Structure */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">成本结构分析</CardTitle>
            <CardDescription>各类成本占比分布</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={costStructure} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 11 }}>
                  {costStructure.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Product Sales */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">产品销售占比</CardTitle>
            <CardDescription>各产品营收贡献占比</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={productSales} cx="50%" cy="50%" innerRadius={50} outerRadius={100} paddingAngle={2} dataKey="value">
                  {productSales.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Unit Comparison Table */}
      <Card id="section-profit-units" className="mb-6 scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">各单位盈亏明细</CardTitle>
          <CardDescription>
            {isAllFilterUnits
              ? "按销售单位对比营收、成本与利润（当前：全部单位）"
              : `仅显示所选单位：${filterUnitLabel}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>排名</TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead className="text-right">实收金额</TableHead>
                  <TableHead className="text-right">结算收入</TableHead>
                  <TableHead className="text-right">其他收入</TableHead>
                  <TableHead className="text-right">销售提成</TableHead>
                  <TableHead className="text-right">产品利润</TableHead>
                  <TableHead className="text-right">运营成本</TableHead>
                  <TableHead className="text-right">净利润</TableHead>
                  <TableHead>盈亏</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unitComparison.map((unit, index) => (
                  <TableRow key={unit.name}>
                    <TableCell>
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        index === 0 ? "bg-amber-100 text-amber-700" :
                        index === 1 ? "bg-gray-100 text-gray-600" :
                        index === 2 ? "bg-orange-100 text-orange-700" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {index + 1}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{unit.name}</TableCell>
                    <TableCell className="text-right text-blue-600">{formatCurrency(unit.salesAmount)}</TableCell>
                    <TableCell className="text-right text-cyan-600 font-medium">{formatCurrency(unit.settlementIncome)}</TableCell>
                    <TableCell className="text-right text-emerald-600">{formatCurrency(unit.otherIncome || 0)}</TableCell>
                    <TableCell className="text-right text-violet-600">{formatCurrency(unit.commission)}</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(unit.productProfit)}</TableCell>
                    <TableCell className="text-right text-orange-600">{formatCurrency(unit.cost)}</TableCell>
                    <TableCell className={`text-right font-bold ${unit.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatCurrency(unit.profit)}
                    </TableCell>
                    <TableCell>
                      {unit.profit >= 0 ? (
                        <Badge className="bg-emerald-50 text-emerald-700">盈利</Badge>
                      ) : (
                        <Badge className="bg-red-50 text-red-700">亏损</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ===================== 收入明细与结算 ===================== */}
      <Card id="section-profit-income" className="mb-6 scroll-mt-20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-5 w-5 text-emerald-600" />
            收入明细与结算
          </CardTitle>
          <CardDescription>
            业绩结算可在此调整；其他收入请在「成本与收入录入」记账，本表只汇总
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead className="text-right">预估结算收入</TableHead>
                  <TableHead className="text-right">实际结算金额</TableHead>
                  <TableHead className="text-right">差额</TableHead>
                  <TableHead className="text-right">其他收入</TableHead>
                  <TableHead className="text-right">收入合计</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incomeDetail.map((d) => {
                  const isExp = expandedIncomeRows.has(d.unit.id);
                  return (
                    <>
                      <TableRow key={d.unit.id} className="cursor-pointer hover:bg-accent/50" onClick={() => toggleIncomeRow(d.unit.id)}>
                        <TableCell>
                          <button className="flex h-6 w-6 items-center justify-center rounded">
                            {isExp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">{d.unit.name}</TableCell>
                        <TableCell className="text-right text-blue-600">{formatCurrency(d.estimatedAmount)}</TableCell>
                        <TableCell className={`text-right font-bold ${d.isAdjusted ? "text-amber-600" : "text-blue-600"}`}>
                          {formatCurrency(d.actualAmount)}
                        </TableCell>
                        <TableCell className={`text-right ${d.diff > 0 ? "text-emerald-600" : d.diff < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                          {d.diff > 0 ? "+" : ""}{formatCurrency(d.diff)}
                        </TableCell>
                        <TableCell className="text-right text-emerald-600">{d.otherIncome > 0 ? formatCurrency(d.otherIncome) : "-"}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-700">{formatCurrency(d.totalIncome)}</TableCell>
                        <TableCell>
                          {d.isAdjusted ? (
                            <Badge className="bg-amber-100 text-amber-700 text-xs">
                              <CheckCircle2 className="mr-1 h-3 w-3" />已调整
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">待确认</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {canEditCost && !isReadOnly ? (
                            <Button variant="ghost" size="sm" onClick={() => openSettlement(d.unit.id, d.unit.name, d.estimatedAmount, d.settlement)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              {d.isAdjusted ? "重新调整" : "调整结算"}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">仅查看</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExp && (
                        <TableRow key={d.unit.id + "-detail"} className="bg-emerald-50/20">
                          <TableCell colSpan={9} className="py-3">
                            <div className="ml-4 space-y-4">
                              {/* 业绩收入明细 */}
                              <div>
                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-700">
                                  <TrendingUp className="h-4 w-4" />
                                  业绩收入明细（{d.unitSales.length} 笔）
                                </div>
                                {d.unitSales.length > 0 ? (
                                  <div className="overflow-hidden rounded-lg border">
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="bg-muted/50">
                                          <TableHead>成交日期</TableHead>
                                          <TableHead>销售人员</TableHead>
                                          <TableHead>产品</TableHead>
                                          <TableHead>客户</TableHead>
                                          <TableHead className="text-right">订单金额</TableHead>
                                          <TableHead className="text-right">结算金额</TableHead>
                                          <TableHead>来源</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {d.unitSales.map((s) => {
                                          const person = personnel.find((p) => p.id === s.personnelId);
                                          const product = products.find((p) => p.id === s.productId);
                                          const personName = person?.name || s.salesPersonName || "-";
                                          const prodName = product?.name || s.productName || "-";
                                          const settlementAmt = calcSaleSettlementIncome(
                                            s,
                                            visibleUnitProductSettlements,
                                          );
                                          return (
                                            <TableRow key={s.id}>
                                              <TableCell className="text-sm">{formatDate(s.saleDate)}</TableCell>
                                              <TableCell className="text-sm">{personName}</TableCell>
                                              <TableCell className="text-sm">{prodName}</TableCell>
                                              <TableCell className="text-sm text-muted-foreground">{s.customerName || "-"}</TableCell>
                                              <TableCell className="text-right text-sm text-muted-foreground">{formatCurrency(s.totalAmount)}</TableCell>
                                              <TableCell className="text-right text-sm font-medium text-cyan-600">{formatCurrency(settlementAmt)}</TableCell>
                                              <TableCell>
                                                {s.synced ? (
                                                  <Badge className="bg-blue-100 text-blue-700 text-xs">生态圈</Badge>
                                                ) : (
                                                  <Badge variant="outline" className="text-xs">手动</Badge>
                                                )}
                                              </TableCell>
                                            </TableRow>
                                          );
                                        })}
                                        <TableRow className="bg-muted/30 font-medium">
                                          <TableCell colSpan={4} className="text-right text-sm">合计</TableCell>
                                          <TableCell className="text-right text-sm text-muted-foreground">{formatCurrency(d.unitSales.reduce((sum, s) => sum + s.totalAmount, 0))}</TableCell>
                                          <TableCell className="text-right text-sm font-bold text-cyan-600">{formatCurrency(d.estimatedAmount)}</TableCell>
                                          <TableCell></TableCell>
                                        </TableRow>
                                        <TableRow className="bg-violet-50/50">
                                          <TableCell colSpan={5} className="text-right text-sm text-violet-700">
                                            本单位销售提成（管理+个人，按人配置）
                                          </TableCell>
                                          <TableCell className="text-right text-sm font-bold text-violet-600">
                                            {formatCurrency(getSalesCommission([d.unit.id], selectedMonth))}
                                          </TableCell>
                                          <TableCell></TableCell>
                                        </TableRow>
                                      </TableBody>
                                    </Table>
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground py-2">本月暂无销售记录</p>
                                )}
                              </div>

                              {/* 其他收入明细 */}
                              <div>
                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700">
                                  <Receipt className="h-4 w-4" />
                                  其他收入明细（{d.unitIncomeRecords.length} 条）
                                </div>
                                {d.unitIncomeRecords.length > 0 ? (
                                  <div className="space-y-2">
                                    {d.unitIncomeRecords.map((r) => (
                                      <div key={r.id} className="rounded-lg border bg-card p-3">
                                        <div className="mb-2 flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            {r.isRecurring && (
                                              <Badge className="bg-violet-100 text-violet-700 text-xs">每月</Badge>
                                            )}
                                            <span className="text-xs text-muted-foreground">{formatDate(r.date)}</span>
                                            {r.createdBy && (
                                              <span className="text-xs text-muted-foreground">录入: {r.createdBy}</span>
                                            )}
                                          </div>
                                          <span className="text-sm font-bold text-emerald-600">{formatCurrency(r.totalAmount)}</span>
                                        </div>
                                        <div className="space-y-1">
                                          {r.items.map((item) => (
                                            <div key={item.id} className="flex items-center gap-3 text-sm">
                                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">{item.category}</Badge>
                                              <span className="flex-1 text-muted-foreground">{item.description || "-"}</span>
                                              <span className="font-medium text-emerald-600">{formatCurrency(item.amount)}</span>
                                            </div>
                                          ))}
                                        </div>
                                        {r.remark && <p className="mt-1 text-xs text-muted-foreground">备注: {r.remark}</p>}
                                      </div>
                                    ))}
                                    <div className="flex justify-end border-t pt-2 text-sm">
                                      <span className="mr-3 text-muted-foreground">其他收入合计</span>
                                      <span className="font-bold text-emerald-600">{formatCurrency(d.otherIncome)}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground py-2">本月暂无其他收入</p>
                                )}
                              </div>

                              {/* 收入汇总 */}
                              <div className="flex items-center justify-between rounded-lg border-2 border-emerald-200 bg-emerald-50/50 px-4 py-3">
                                <div className="flex items-center gap-6 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">预估业绩: </span>
                                    <span className="font-medium text-blue-600">{formatCurrency(d.estimatedAmount)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">实际结算: </span>
                                    <span className="font-bold text-amber-600">{formatCurrency(d.actualAmount)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">其他收入: </span>
                                    <span className="font-medium text-emerald-600">{formatCurrency(d.otherIncome)}</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className="text-sm text-muted-foreground">收入合计 </span>
                                  <span className="text-lg font-bold text-emerald-700">{formatCurrency(d.totalIncome)}</span>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {/* 合计行 */}
                <TableRow className="border-t-2 bg-muted/30 font-bold">
                  <TableCell></TableCell>
                  <TableCell>合计</TableCell>
                  <TableCell className="text-right text-blue-600">{formatCurrency(incomeTotals.totalEstimated)}</TableCell>
                  <TableCell className="text-right text-amber-600">{formatCurrency(incomeTotals.totalActual)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {incomeTotals.totalActual - incomeTotals.totalEstimated > 0 ? "+" : ""}
                    {formatCurrency(incomeTotals.totalActual - incomeTotals.totalEstimated)}
                  </TableCell>
                  <TableCell className="text-right text-emerald-600">{formatCurrency(incomeTotals.totalOther)}</TableCell>
                  <TableCell className="text-right text-emerald-700">{formatCurrency(incomeTotals.grandTotal)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{incomeTotals.adjustedCount} 个已调整</Badge>
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
                {incomeDetail.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">暂无数据</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Personnel Ranking */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">销售人员业绩排行 TOP 8</CardTitle>
          <CardDescription>按销售额排名展示Top销售人员</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {personnelRanking.map((person, index) => {
              const maxRevenue = personnelRanking[0]?.revenue || 1;
              const pct = (person.revenue / maxRevenue) * 100;
              return (
                <div key={person.name} className="flex items-center gap-4">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    index === 0 ? "bg-amber-100 text-amber-700" :
                    index === 1 ? "bg-gray-200 text-gray-600" :
                    index === 2 ? "bg-orange-100 text-orange-700" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {index + 1}
                  </div>
                  <div className="w-24 shrink-0">
                    <p className="text-sm font-medium">{person.name}</p>
                    <p className="text-xs text-muted-foreground">{person.unit}</p>
                  </div>
                  <div className="flex-1">
                    <div className="h-7 overflow-hidden rounded-full bg-muted">
                      <div
                        className="flex h-full items-center justify-end rounded-full bg-gradient-to-r from-blue-400 to-blue-600 px-2 transition-all"
                        style={{ width: `${Math.max(pct, 5)}%` }}
                      >
                        <span className="text-xs font-medium text-white">{formatCurrency(person.revenue)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-16 shrink-0 text-right">
                    <span className="text-xs text-muted-foreground">{person.count}笔</span>
                  </div>
                </div>
              );
            })}
            {personnelRanking.length === 0 && (
              <p className="text-center py-8 text-muted-foreground">暂无销售数据</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===================== 结算调整弹窗 ===================== */}
      <Dialog open={!!settlementDialog} onOpenChange={(open) => { if (!open) setSettlementDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600" />
              调整实际结算金额
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
              <div>
                <p className="text-sm text-muted-foreground">{settlementDialog?.unitName}</p>
                <p className="text-xs text-muted-foreground">{selectedMonth}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">预估结算收入（按结算比例）</p>
                <p className="text-lg font-bold text-blue-600">{settlementDialog && formatCurrency(settlementDialog.estimated)}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>实际结算金额（¥）</Label>
              <Input
                type="number"
                value={settlementForm.actualAmount}
                onChange={(e) => setSettlementForm({ ...settlementForm, actualAmount: Number(e.target.value) })}
                placeholder="输入实际结算金额"
              />
              <p className="text-xs text-muted-foreground">
                如与预估金额一致则标记为"待确认"，不一致则标记为"已调整"
              </p>
            </div>
            <div className="space-y-2">
              <Label>调整说明</Label>
              <Textarea
                value={settlementForm.remark}
                onChange={(e) => setSettlementForm({ ...settlementForm, remark: e.target.value })}
                placeholder="如：退款扣除、折扣调整、补差等"
                rows={2}
              />
            </div>
            {settlementDialog && settlementForm.actualAmount !== settlementDialog.estimated && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                差额: {settlementForm.actualAmount > settlementDialog.estimated ? "+" : ""}
                {formatCurrency(settlementForm.actualAmount - settlementDialog.estimated)}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementDialog(null)}>取消</Button>
            <Button onClick={handleSettlementSubmit}>
              <Clock className="mr-1 h-4 w-4" />保存结算
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MPerformanceEstimateSheet
        open={estimateOpen}
        onOpenChange={setEstimateOpen}
        initialMonth={selectedMonth}
        initialUnitIds={filterUnitIds}
        monthOptions={monthOptions}
        salesUnits={salesUnits.map((u) => ({ id: u.id, name: u.name }))}
        getSummary={getEstimateSummary}
      />
    </div>
  );
}
