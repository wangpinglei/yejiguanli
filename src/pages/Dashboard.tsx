import { useMemo, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCurrency, formatPercent } from "@/lib/format";
import {
  buildSalesReceiptDashboard,
  buildSalesReceiptRows,
  buildUnitReceiptRanking,
  type ReceiptGrain,
} from "@/lib/salesReceiptAggregate";
import { PageHeader } from "@/components/PageHeader";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  Check,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const GRAIN_OPTIONS: { value: ReceiptGrain; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
];

export default function Dashboard() {
  const {
    visibleSalesUnits: salesUnits,
    visibleSalesRecords: salesRecords,
    visiblePersonnel: personnel,
  } = usePermissions();
  const [grain, setGrain] = useState<ReceiptGrain>("month");
  const [referenceDate, setReferenceDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[] | null>(null);
  const [unitFilterOpen, setUnitFilterOpen] = useState(false);

  const filterUnitIds = useMemo(() => {
    if (selectedUnitIds === null) return salesUnits.map((u) => u.id);
    return selectedUnitIds.filter((id) => salesUnits.some((u) => u.id === id));
  }, [selectedUnitIds, salesUnits]);

  const allScopedUnitIds = useMemo(
    () => salesUnits.map((u) => u.id),
    [salesUnits],
  );

  const receiptRows = useMemo(
    () =>
      buildSalesReceiptRows(salesRecords, {
        unitFilterIds: filterUnitIds,
        allScopedUnitIds,
        personnel,
      }),
    [salesRecords, filterUnitIds, allScopedUnitIds, personnel],
  );

  const unitNameMap = useMemo(
    () => new Map(salesUnits.map((u) => [u.id, u.name])),
    [salesUnits],
  );

  const dashboard = useMemo(
    () =>
      buildSalesReceiptDashboard(receiptRows, {
        grain,
        referenceDate,
      }),
    [receiptRows, grain, referenceDate],
  );

  const unitRanking = useMemo(
    () =>
      buildUnitReceiptRanking(
        salesRecords,
        filterUnitIds,
        unitNameMap,
        dashboard.current.startDate,
        dashboard.current.endDate,
        personnel,
      ),
    [
      salesRecords,
      filterUnitIds,
      unitNameMap,
      dashboard.current.startDate,
      dashboard.current.endDate,
      personnel,
    ],
  );

  const chartData = useMemo(
    () =>
      dashboard.buckets.map((b) => ({
        label: b.label,
        amount: b.amount,
        count: b.count,
      })),
    [dashboard.buckets],
  );

  const isAllUnits =
    selectedUnitIds === null
    || (salesUnits.length > 0 && selectedUnitIds.length === salesUnits.length);
  const isNoUnits = selectedUnitIds !== null && selectedUnitIds.length === 0;
  const unitFilterLabel = useMemo(() => {
    if (isNoUnits) return "未选单位";
    if (isAllUnits) return "全部单位";
    if (selectedUnitIds!.length === 1) {
      return salesUnits.find((u) => u.id === selectedUnitIds![0])?.name || "已选 1 个";
    }
    return `已选 ${selectedUnitIds!.length} 个单位`;
  }, [isAllUnits, isNoUnits, selectedUnitIds, salesUnits]);

  const checkedUnitSet = useMemo(() => {
    if (selectedUnitIds === null) return new Set(salesUnits.map((u) => u.id));
    return new Set(selectedUnitIds);
  }, [selectedUnitIds, salesUnits]);

  function handleToggleUnit(unitId: string, checked: boolean) {
    setSelectedUnitIds((prev) => {
      const base = prev === null ? salesUnits.map((u) => u.id) : [...prev];
      if (checked) {
        if (base.includes(unitId)) return base;
        const next = [...base, unitId];
        if (salesUnits.length > 0 && next.length === salesUnits.length) return null;
        return next;
      }
      return base.filter((id) => id !== unitId);
    });
  }

  const mom = dashboard.momPct;
  const momUp = mom != null && mom >= 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据看板"
        description="销售进款（按成交日实收金额汇总）；周统计以周一为一周起始。"
      />

      <div className="flex flex-wrap items-center gap-3">
        <CalendarDays className="h-5 w-5 text-blue-600" />
        <span className="text-sm font-medium">统计粒度</span>
        <div className="flex rounded-lg border bg-muted/40 p-0.5">
          {GRAIN_OPTIONS.map((g) => (
            <Button
              key={g.value}
              type="button"
              size="sm"
              variant={grain === g.value ? "default" : "ghost"}
              className="h-8 px-4"
              onClick={() => setGrain(g.value)}
            >
              {g.label}
            </Button>
          ))}
        </div>

        <span className="text-sm text-muted-foreground ml-1">基准日</span>
        <Input
          type="date"
          className="w-40 h-9"
          value={referenceDate}
          onChange={(e) => setReferenceDate(e.target.value.slice(0, 10))}
        />

        <Building2 className="ml-2 h-5 w-5 text-blue-600" />
        <span className="text-sm font-medium">销售单位</span>
        <Popover open={unitFilterOpen} onOpenChange={setUnitFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="min-w-[11rem] max-w-[18rem] justify-between font-normal"
            >
              <span className="truncate">{unitFilterLabel}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <div className="border-b px-3 py-2 space-y-2">
              <p className="text-xs text-muted-foreground">可多选，默认全部</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={() => setSelectedUnitIds(null)}
                >
                  全选
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={() => setSelectedUnitIds([])}
                >
                  全不选
                </Button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {salesUnits.map((unit) => (
                <label
                  key={unit.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    checked={checkedUnitSet.has(unit.id)}
                    onCheckedChange={(v) => handleToggleUnit(unit.id, v === true)}
                  />
                  <span className="flex-1 truncate text-sm">{unit.name}</span>
                  {checkedUnitSet.has(unit.id) && (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  )}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              本期进款
            </CardTitle>
            <p className="text-xs text-muted-foreground">{dashboard.current.label}</p>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatCurrency(dashboard.current.amount)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {dashboard.current.count} 笔
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              上期进款
            </CardTitle>
            <p className="text-xs text-muted-foreground">{dashboard.previous.label}</p>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(dashboard.previous.amount)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {dashboard.previous.count} 笔
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              环比
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mom == null ? (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            ) : (
              <div className="flex items-center gap-1">
                {momUp ? (
                  <ArrowUpRight className="h-5 w-5 text-emerald-500" />
                ) : (
                  <ArrowDownRight className="h-5 w-5 text-red-500" />
                )}
                <span
                  className={`text-2xl font-bold ${momUp ? "text-emerald-600" : "text-red-500"}`}
                >
                  {formatPercent(Math.abs(mom))}
                </span>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">较上一同周期</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              笔均进款
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {dashboard.current.count > 0
                ? formatCurrency(dashboard.current.amount / dashboard.current.count)
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              进款趋势
            </CardTitle>
            <CardDescription>
              {grain === "day" && "近 30 日"}
              {grain === "week" && "近 12 周（周一至周日）"}
              {grain === "month" && "近 12 个月"}
              {grain === "year" && "近 5 年"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                />
                <Bar dataKey="amount" name="进款" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              本期各单位进款
            </CardTitle>
            <CardDescription>{dashboard.current.label}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] space-y-2 overflow-y-auto">
              {unitRanking.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p>
              ) : (
                unitRanking.slice(0, 12).map((row) => (
                  <div
                    key={row.unitId}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="shrink-0 font-semibold text-blue-600">
                      {formatCurrency(row.amount)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            说明
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>进款 = 销售记录「实收金额」，按成交日统计；不含其他收入、成本与利润。</p>
          <p>
            选全部单位时按整单实收汇总；选部分单位时与「销售记录」一致，按订单分业绩计入各单位份额（如
            云拆单 分摊部分）。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}