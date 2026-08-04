import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCurrency, formatPercent, getYearMonth } from "@/lib/format";
import { getTotalSalaryCost, filterByMonth } from "@/lib/salary";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Users,
  Building2,
  ShoppingCart,
  ArrowUpRight,
  ArrowDownRight,
  CalendarDays,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const COLORS = ["#3b82f6", "#60a5fa", "#93c5fd", "#1e40af", "#2563eb", "#1d4ed8"];

export default function Dashboard() {
  const { products, monthlyAdjustments } = useData();
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords, visibleCostRecords: costRecords } = usePermissions();
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  // 按月过滤的销售记录和成本记录
  const monthlySales = useMemo(() => filterByMonth(salesRecords, selectedMonth), [salesRecords, selectedMonth]);
  const monthlyCosts = useMemo(() => costRecords.filter((c) => getYearMonth(c.date) === selectedMonth), [costRecords, selectedMonth]);

  // 计算统计（按月度）
  const stats = useMemo(() => {
    const totalRevenue = monthlySales.reduce((sum, s) => sum + s.totalAmount, 0);
    const manualCost = monthlyCosts.reduce((sum, c) => sum + c.totalCost, 0);
    const salaryData = getTotalSalaryCost(
      salesUnits.map((u) => u.id),
      personnel,
      salesRecords,
      products,
      selectedMonth,
      monthlyAdjustments
    );
    const salaryCost = salaryData.grandTotal;
    const productCommission = salaryData.grandProductCommission;
    const totalCost = manualCost + salaryCost;
    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const activePersonnel = personnel.filter((p) => p.status === "active").length;

    return {
      totalRevenue,
      totalCost,
      manualCost,
      salaryCost,
      productCommission,
      totalProfit,
      profitMargin,
      totalUnits: salesUnits.length,
      totalPersonnel: personnel.length,
      totalSales: monthlySales.length,
      activePersonnel,
    };
  }, [monthlySales, monthlyCosts, salesUnits, personnel, salesRecords, products, selectedMonth, monthlyAdjustments]);

  // 月度趋势
  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, { revenue: number; cost: number }>();

    salesRecords.forEach((s) => {
      const ym = getYearMonth(s.saleDate);
      const existing = monthMap.get(ym) || { revenue: 0, cost: 0 };
      existing.revenue += s.totalAmount;
      monthMap.set(ym, existing);
    });

    costRecords.forEach((c) => {
      const ym = getYearMonth(c.date);
      const existing = monthMap.get(ym) || { revenue: 0, cost: 0 };
      existing.cost += c.totalCost;
      monthMap.set(ym, existing);
    });

    // 将自动薪酬成本按月分配
    return Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => {
        const monthSalary = getTotalSalaryCost(
          salesUnits.map((u) => u.id),
          personnel,
          salesRecords,
          products,
          month,
          monthlyAdjustments
        ).grandTotal;
        return {
          month: month.split("-")[1] + "月",
          revenue: data.revenue,
          cost: data.cost + monthSalary,
          profit: data.revenue - data.cost - monthSalary,
        };
      });
  }, [salesRecords, costRecords, salesUnits, personnel, products, monthlyAdjustments]);

  // 各单位销售（按月度）
  const unitSales = useMemo(() => {
    return salesUnits.map((unit) => {
      const revenue = monthlySales
        .filter((s) => s.salesUnitId === unit.id)
        .reduce((sum, s) => sum + s.totalAmount, 0);
      const manualCost = monthlyCosts
        .filter((c) => c.salesUnitId === unit.id)
        .reduce((sum, c) => sum + c.totalCost, 0);
      const salaryCost = getTotalSalaryCost([unit.id], personnel, salesRecords, products, selectedMonth, monthlyAdjustments).grandTotal;
      const cost = manualCost + salaryCost;
      return {
        name: unit.name.length > 6 ? unit.name.slice(0, 6) + "..." : unit.name,
        revenue,
        cost,
        profit: revenue - cost,
      };
    });
  }, [salesUnits, monthlySales, monthlyCosts, personnel, salesRecords, products, selectedMonth, monthlyAdjustments]);

  // 成本分类（按月度）
  const costByCategory = useMemo(() => {
    const catMap = new Map<string, number>();
    monthlyCosts.forEach((c) => {
      c.items.forEach((item) => {
        catMap.set(item.category, (catMap.get(item.category) || 0) + item.amount);
      });
    });
    // 添加自动薪酬成本
    const salaryData = getTotalSalaryCost(
      salesUnits.map((u) => u.id),
      personnel,
      salesRecords,
      products,
      selectedMonth,
      monthlyAdjustments
    );
    if (salaryData.grandTotal > 0) {
      catMap.set("人力成本（薪酬+社保+公积金）", salaryData.grandTotal);
    }
    // 添加产品销售提成（作为人力成本的子项单独展示）
    if (salaryData.grandProductCommission > 0) {
      catMap.set("产品销售提成", salaryData.grandProductCommission);
    }
    return Array.from(catMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [monthlyCosts, salesUnits, personnel, salesRecords, products, selectedMonth, monthlyAdjustments]);

  // 最近销售记录（按月度）
  const recentSales = useMemo(() => {
    return [...monthlySales]
      .sort((a, b) => b.saleDate.localeCompare(a.saleDate))
      .slice(0, 6);
  }, [monthlySales]);

  const getUnitName = (id: string) => salesUnits.find((u) => u.id === id)?.name || "-";
  const getPersonnelName = (id: string) => personnel.find((p) => p.id === id)?.name || "-";
  const getProductName = (id: string) => products.find((p) => p.id === id)?.name || "-";

  const statCards = [
    {
      title: "总营收",
      value: formatCurrency(stats.totalRevenue),
      icon: TrendingUp,
      change: "+12.5%",
      isUp: true,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "总成本",
      value: formatCurrency(stats.totalCost),
      icon: Wallet,
      change: "+5.2%",
      isUp: false,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      title: "净利润",
      value: formatCurrency(stats.totalProfit),
      icon: TrendingDown,
      change: "+18.3%",
      isUp: true,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      title: "利润率",
      value: formatPercent(stats.profitMargin),
      icon: ArrowUpRight,
      change: "+3.1%",
      isUp: true,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
  ];

  const miniStats = [
    { label: "销售单位", value: stats.totalUnits, icon: Building2 },
    { label: "在岗人员", value: `${stats.activePersonnel}/${stats.totalPersonnel}`, icon: Users },
    { label: "销售笔数", value: stats.totalSales, icon: ShoppingCart },
    { label: "产品数量", value: products.length, icon: TrendingUp },
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
    <div className="space-y-6">
      {/* Month Selector */}
      <div className="flex items-center gap-3">
        <CalendarDays className="h-5 w-5 text-blue-600" />
        <span className="text-sm font-medium">数据月份</span>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <div className={`rounded-lg ${card.bg} p-2`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                <div className="mt-1 flex items-center gap-1 text-xs">
                  {card.isUp ? (
                    <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 text-red-500" />
                  )}
                  <span className={card.isUp ? "text-emerald-600" : "text-red-500"}>
                    {card.change}
                  </span>
                  <span className="text-muted-foreground">较上期</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {miniStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="flex items-center gap-3 rounded-xl border bg-card p-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-lg font-bold">{stat.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Revenue Trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">营收与成本趋势</CardTitle>
            <CardDescription>按月统计营收、成本和利润变化</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthlyTrend}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" name="营收" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
                <Area type="monotone" dataKey="cost" name="成本" stroke="#f97316" fillOpacity={1} fill="url(#colorCost)" strokeWidth={2} />
                <Area type="monotone" dataKey="profit" name="利润" stroke="#10b981" fillOpacity={1} fill="url(#colorProfit)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Cost Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">成本分类占比</CardTitle>
            <CardDescription>各成本类别分布</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={costByCategory}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {costByCategory.map((_, index) => (
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

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Unit Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">各单位业绩对比</CardTitle>
            <CardDescription>各销售单位营收、成本与利润</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={unitSales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="营收" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost" name="成本" fill="#f97316" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="利润" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Sales */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近销售记录</CardTitle>
            <CardDescription>最新 6 笔销售交易</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentSales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                      <ShoppingCart className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{getProductName(sale.productId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {getPersonnelName(sale.personnelId)} · {getUnitName(sale.salesUnitId)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-blue-600">
                      {formatCurrency(sale.totalAmount)}
                    </p>
                    <p className="text-xs text-muted-foreground">{sale.saleDate}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
