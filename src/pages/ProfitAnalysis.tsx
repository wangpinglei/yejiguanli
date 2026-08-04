import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate, getYearMonth } from "@/lib/format";
import { getTotalSalaryCost, filterByMonth } from "@/lib/salary";
import type { RevenueSettlement } from "@/types";
import {
  TrendingUp, DollarSign, Award, AlertTriangle,
  ChevronDown, ChevronRight, Pencil, Receipt, CheckCircle2, Clock,
} from "lucide-react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#eab308"];

export default function ProfitAnalysis() {
  const { products, monthlyAdjustments, upsertRevenueSettlement } = useData();
  const { user } = useAuth();
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords, visibleCostRecords: costRecords, visibleIncomeRecords: incomeRecords, visibleRevenueSettlements: revenueSettlements, visibleUnitProductSettlements, canEditCost, isReadOnly } = usePermissions();
  const [filterUnit, setFilterUnit] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  // 收入明细展开状态
  const [expandedIncomeRows, setExpandedIncomeRows] = useState<Set<string>>(new Set());
  // 结算调整弹窗
  const [settlementDialog, setSettlementDialog] = useState<{ unitId: string; unitName: string; estimated: number } | null>(null);
  const [settlementForm, setSettlementForm] = useState({ actualAmount: 0, remark: "" });

  // 按月过滤
  const monthlySales = useMemo(() => filterByMonth(salesRecords, selectedMonth), [salesRecords, selectedMonth]);
  const monthlyCosts = useMemo(() => costRecords.filter((c) => getYearMonth(c.date) === selectedMonth), [costRecords, selectedMonth]);

  // 筛选数据
  const filteredSales = useMemo(() => {
    return filterUnit === "all" ? monthlySales : monthlySales.filter((s) => s.salesUnitId === filterUnit);
  }, [monthlySales, filterUnit]);

  const filteredCosts = useMemo(() => {
    return filterUnit === "all" ? monthlyCosts : monthlyCosts.filter((c) => c.salesUnitId === filterUnit);
  }, [monthlyCosts, filterUnit]);

  // 计算结算收入（按单位×产品结算比例）
  const calcSettlementIncome = (sales: typeof filteredSales) => {
    return sales.reduce((sum, s) => {
      const ups = visibleUnitProductSettlements.find(
        (x) => x.salesUnitId === s.salesUnitId && x.productId === s.productId
      );
      if (!ups) return sum + s.totalAmount; // 未配置结算则按全额计入
      if (ups.settlementType === "fixed") return sum + (ups.settlementAmount || 0) * s.quantity;
      return sum + s.totalAmount * ((ups.settlementRate || 0) / 100);
    }, 0);
  };

  // 计算销售提成
  const calcCommission = (sales: typeof filteredSales) => {
    return sales.reduce((sum, s) => {
      const product = products.find((p) => p.id === s.productId);
      if (!product) return sum;
      if (product.commissionType === "fixed") return sum + (product.commissionAmount || 0) * s.quantity;
      return sum + s.totalAmount * ((product.commissionRate || 0) / 100);
    }, 0);
  };

  // 汇总（按月度）
  const summary = useMemo(() => {
    const totalSalesAmount = filteredSales.reduce((sum, s) => sum + s.totalAmount, 0); // 实收总额
    const totalSettlementIncome = calcSettlementIncome(filteredSales); // 结算收入
    const totalCommission = calcCommission(filteredSales); // 销售提成
    const productProfit = totalSettlementIncome - totalCommission; // 产品利润 = 结算收入 - 提成
    const manualCost = filteredCosts.reduce((sum, c) => sum + c.totalCost, 0);
    const salaryData = getTotalSalaryCost(
      filterUnit === "all" ? salesUnits.map((u) => u.id) : [filterUnit],
      personnel,
      salesRecords,
      products,
      selectedMonth,
      monthlyAdjustments
    );
    const salaryCost = salaryData.grandTotal;
    const totalCost = manualCost + salaryCost;
    // 净利润 = 结算收入 - 总成本（总成本已含提成）
    const totalProfit = totalSettlementIncome - totalCost;
    const profitMargin = totalSettlementIncome > 0 ? (totalProfit / totalSettlementIncome) * 100 : 0;
    return { totalSalesAmount, totalSettlementIncome, totalCommission, productProfit, totalCost, manualCost, salaryCost, totalProfit, profitMargin };
  }, [filteredSales, filteredCosts, filterUnit, salesUnits, personnel, salesRecords, products, selectedMonth, monthlyAdjustments, visibleUnitProductSettlements]);

  // 月度趋势
  const monthlyData = useMemo(() => {
    const monthMap = new Map<string, { salesAmount: number; settlementIncome: number; commission: number; cost: number }>();
    salesRecords.forEach((s) => {
      const ym = getYearMonth(s.saleDate);
      const existing = monthMap.get(ym) || { salesAmount: 0, settlementIncome: 0, commission: 0, cost: 0 };
      existing.salesAmount += s.totalAmount;
      // 结算收入
      const ups = visibleUnitProductSettlements.find(
        (x) => x.salesUnitId === s.salesUnitId && x.productId === s.productId
      );
      if (!ups) existing.settlementIncome += s.totalAmount;
      else if (ups.settlementType === "fixed") existing.settlementIncome += (ups.settlementAmount || 0) * s.quantity;
      else existing.settlementIncome += s.totalAmount * ((ups.settlementRate || 0) / 100);
      // 提成
      const product = products.find((p) => p.id === s.productId);
      if (product) {
        if (product.commissionType === "fixed") existing.commission += (product.commissionAmount || 0) * s.quantity;
        else existing.commission += s.totalAmount * ((product.commissionRate || 0) / 100);
      }
      monthMap.set(ym, existing);
    });
    costRecords.forEach((c) => {
      const ym = getYearMonth(c.date);
      const existing = monthMap.get(ym) || { salesAmount: 0, settlementIncome: 0, commission: 0, cost: 0 };
      existing.cost += c.totalCost;
      monthMap.set(ym, existing);
    });
    // 按月分配薪酬成本
    return Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => {
        const monthSalary = getTotalSalaryCost(
          filterUnit === "all" ? salesUnits.map((u) => u.id) : [filterUnit],
          personnel,
          salesRecords,
          products,
          month,
          monthlyAdjustments
        ).grandTotal;
        return {
          month: month.split("-")[1] + "月",
          revenue: data.settlementIncome,
          cost: data.cost + monthSalary,
          profit: data.settlementIncome - data.cost - monthSalary,
          margin: data.settlementIncome > 0 ? ((data.settlementIncome - data.cost - monthSalary) / data.settlementIncome) * 100 : 0,
        };
      });
  }, [filterUnit, salesUnits, personnel, salesRecords, products, costRecords, monthlyAdjustments, visibleUnitProductSettlements]);

  // 各单位对比（按月度）
  const unitComparison = useMemo(() => {
    return salesUnits.map((unit) => {
      const unitSales = monthlySales.filter((s) => s.salesUnitId === unit.id);
      const salesAmount = unitSales.reduce((sum, s) => sum + s.totalAmount, 0); // 实收金额
      const settlementIncome = calcSettlementIncome(unitSales); // 结算收入
      const commission = calcCommission(unitSales); // 销售提成
      const productProfit = settlementIncome - commission; // 产品利润
      const manualCost = monthlyCosts.filter((c) => c.salesUnitId === unit.id).reduce((sum, c) => sum + c.totalCost, 0);
      const salaryCost = getTotalSalaryCost([unit.id], personnel, salesRecords, products, selectedMonth, monthlyAdjustments).grandTotal;
      const cost = manualCost + salaryCost;
      const profit = settlementIncome - cost; // 净利润 = 结算收入 - 总成本
      const margin = settlementIncome > 0 ? (profit / settlementIncome) * 100 : 0;
      return { name: unit.name, salesAmount, settlementIncome, commission, productProfit, cost, profit, margin };
    }).sort((a, b) => b.profit - a.profit);
  }, [salesUnits, monthlySales, monthlyCosts, personnel, salesRecords, products, selectedMonth, monthlyAdjustments, visibleUnitProductSettlements]);

  // 成本结构（按月度）
  const costStructure = useMemo(() => {
    const catMap = new Map<string, number>();
    filteredCosts.forEach((c) => {
      c.items.forEach((item) => {
        catMap.set(item.category, (catMap.get(item.category) || 0) + item.amount);
      });
    });
    // 添加自动薪酬成本
    const salaryData = getTotalSalaryCost(
      filterUnit === "all" ? salesUnits.map((u) => u.id) : [filterUnit],
      personnel,
      salesRecords,
      products,
      selectedMonth,
      monthlyAdjustments
    );
    if (salaryData.grandTotal > 0) {
      catMap.set("人力成本（薪酬+社保+公积金）", salaryData.grandTotal);
    }
    // 添加产品销售提成（作为子项单独展示）
    if (salaryData.grandProductCommission > 0) {
      catMap.set("产品销售提成", salaryData.grandProductCommission);
    }
    return Array.from(catMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredCosts, filterUnit, salesUnits, personnel, salesRecords, products, selectedMonth, monthlyAdjustments]);

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
  const monthlyIncomeRecords = useMemo(() => {
    const targetM = parseInt(selectedMonth.slice(5, 7), 10);
    return incomeRecords
      .filter((r) => {
        const matchUnit = filterUnit === "all" || r.salesUnitId === filterUnit;
        if (!matchUnit) return false;
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
  }, [incomeRecords, filterUnit, selectedMonth]);

  // 按单位计算收入明细
  const incomeDetail = useMemo(() => {
    const unitsToShow = filterUnit === "all" ? salesUnits : salesUnits.filter((u) => u.id === filterUnit);
    return unitsToShow.map((unit) => {
      // 预估业绩收入：根据单位×产品结算比例计算
      const unitSales = monthlySales.filter((s) => s.salesUnitId === unit.id);
      const estimatedAmount = unitSales.reduce((sum, s) => {
        // 查找该单位该产品的结算设置
        const settlement = visibleUnitProductSettlements.find(
          (ups) => ups.salesUnitId === unit.id && ups.productId === s.productId
        );
        if (!settlement) return sum + s.totalAmount; // 未配置结算则按全额计入
        if (settlement.settlementType === "fixed") {
          return sum + (settlement.settlementAmount || 0) * s.quantity;
        }
        // percentage
        return sum + s.totalAmount * ((settlement.settlementRate || 0) / 100);
      }, 0);
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
  }, [salesUnits, filterUnit, monthlySales, revenueSettlements, selectedMonth, monthlyIncomeRecords, visibleUnitProductSettlements]);

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
      title: "实收金额", value: formatCurrency(summary.totalSalesAmount),
      icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50",
    },
    {
      title: "结算收入", value: formatCurrency(summary.totalSettlementIncome),
      icon: DollarSign, color: "text-cyan-600", bg: "bg-cyan-50",
    },
    {
      title: "销售提成", value: formatCurrency(summary.totalCommission),
      icon: Award, color: "text-violet-600", bg: "bg-violet-50",
    },
    {
      title: "净利润", value: formatCurrency(summary.totalProfit),
      icon: summary.totalProfit >= 0 ? Award : AlertTriangle,
      color: summary.totalProfit >= 0 ? "text-emerald-600" : "text-red-600",
      bg: summary.totalProfit >= 0 ? "bg-emerald-50" : "bg-red-50",
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

  return (
    <div>
      <PageHeader
        title="收支利润分析"
        description="按月度观测营收、成本与利润，洞察业务盈亏状况"
        action={
          <div className="flex gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterUnit} onValueChange={setFilterUnit}>
              <SelectTrigger className="w-48"><SelectValue placeholder="选择单位" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部单位</SelectItem>
                {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Monthly Trend */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">营收·成本·利润月度趋势</CardTitle>
          <CardDescription>组合图展示每月营收、成本、利润及利润率变化</CardDescription>
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
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">各单位收支利润明细</CardTitle>
          <CardDescription>按销售单位对比营收、成本与利润</CardDescription>
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
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-5 w-5 text-emerald-600" />
            收入明细与结算
          </CardTitle>
          <CardDescription>
            业绩收入自动从销售记录预估，可手动纠正实际结算金额 · 其他收入来自成本管理录入
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
                                          <TableHead className="text-right">提成</TableHead>
                                          <TableHead>来源</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {d.unitSales.map((s) => {
                                          const person = personnel.find((p) => p.id === s.personnelId);
                                          const product = products.find((p) => p.id === s.productId);
                                          const personName = person?.name || s.salesPersonName || "-";
                                          const prodName = product?.name || s.productName || "-";
                                          // 计算该笔销售的结算金额
                                          const ups = visibleUnitProductSettlements.find(
                                            (x) => x.salesUnitId === d.unit.id && x.productId === s.productId
                                          );
                                          const settlementAmt = !ups ? s.totalAmount
                                            : ups.settlementType === "fixed" ? (ups.settlementAmount || 0) * s.quantity
                                            : s.totalAmount * ((ups.settlementRate || 0) / 100);
                                          // 计算该笔销售的提成
                                          const commissionAmt = !product ? 0
                                            : product.commissionType === "fixed" ? (product.commissionAmount || 0) * s.quantity
                                            : s.totalAmount * ((product.commissionRate || 0) / 100);
                                          return (
                                            <TableRow key={s.id}>
                                              <TableCell className="text-sm">{formatDate(s.saleDate)}</TableCell>
                                              <TableCell className="text-sm">{personName}</TableCell>
                                              <TableCell className="text-sm">{prodName}</TableCell>
                                              <TableCell className="text-sm text-muted-foreground">{s.customerName || "-"}</TableCell>
                                              <TableCell className="text-right text-sm text-muted-foreground">{formatCurrency(s.totalAmount)}</TableCell>
                                              <TableCell className="text-right text-sm font-medium text-cyan-600">{formatCurrency(settlementAmt)}</TableCell>
                                              <TableCell className="text-right text-sm text-violet-600">{formatCurrency(commissionAmt)}</TableCell>
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
                                          <TableCell className="text-right text-sm font-bold text-violet-600">{formatCurrency(calcCommission(d.unitSales))}</TableCell>
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
    </div>
  );
}
