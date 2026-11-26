import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildUnitSettlementBlocks } from "@/lib/saleSettlementReconcile";
import { downloadProductSettlementSalesExcel } from "@/lib/productSettlementSalesExport";
import {
  ChevronDown,
  ChevronRight,
  Download,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

function buildMonthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      value,
      label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
    });
  }
  return out;
}

export default function ProductSettlementSales() {
  const { products } = useData();
  const {
    visibleSalesUnits: salesUnits,
    visibleSalesRecords: salesRecords,
    visiblePersonnel: personnel,
    visibleRevenueSettlements: revenueSettlements,
    visibleUnitProductSettlements: upsList,
  } = usePermissions();

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(
    () => new Date().toISOString().slice(0, 7),
  );
  const [filterUnitId, setFilterUnitId] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const blocks = useMemo(
    () =>
      buildUnitSettlementBlocks({
        salesUnits,
        salesRecords,
        personnel,
        products,
        upsList,
        revenueSettlements,
        yearMonth: selectedMonth,
        unitFilterIds: filterUnitId === "all" ? null : [filterUnitId],
      }),
    [
      salesUnits,
      salesRecords,
      personnel,
      products,
      upsList,
      revenueSettlements,
      selectedMonth,
      filterUnitId,
    ],
  );

  const totals = useMemo(() => {
    const estimated = blocks.reduce((s, b) => s + b.estimatedTotal, 0);
    const actual = blocks.reduce((s, b) => s + b.actualTotal, 0);
    const count = blocks.reduce((s, b) => s + b.lines.length, 0);
    return { estimated, actual, count };
  }, [blocks]);

  function toggleUnit(unitId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const nonEmpty = blocks.filter((b) => b.lines.length > 0);
      if (nonEmpty.length === 0) {
        alert("当前月份没有可导出的结算明细");
        return;
      }
      await downloadProductSettlementSalesExcel(nonEmpty, selectedMonth);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="产品结算"
        description="记佣金额（实收 − 业绩扣除）× 结算比例 = 预估结算；单位在盈亏分析手工改过实际结算时，按预估占比分摊到每单。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterUnitId} onValueChange={setFilterUnitId}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="单位" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部单位</SelectItem>
                {salesUnits.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={exporting || totals.count === 0}
              onClick={() => void handleExport()}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {exporting ? "导出中…" : "导出 Excel"}
            </Button>
          </div>
        }
      />

      <Card className="mb-4 border-cyan-200 bg-cyan-50/40">
        <CardContent className="flex flex-wrap gap-6 py-4 text-sm">
          <div>
            <span className="text-muted-foreground">本月订单 </span>
            <span className="font-semibold">{totals.count} 笔</span>
          </div>
          <div>
            <span className="text-muted-foreground">预估结算合计 </span>
            <span className="font-semibold text-cyan-700">
              {formatCurrency(totals.estimated)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">实际结算合计 </span>
            <span className="font-semibold text-blue-700">
              {formatCurrency(totals.actual)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10" />
              <TableHead>销售单位</TableHead>
              <TableHead className="text-right">预估结算</TableHead>
              <TableHead className="text-right">实际结算</TableHead>
              <TableHead className="text-right">差额</TableHead>
              <TableHead className="text-right">笔数</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  暂无可见单位
                </TableCell>
              </TableRow>
            ) : (
              blocks.map((b) => {
                const isOpen = expanded.has(b.unit.id);
                const diff = b.actualTotal - b.estimatedTotal;
                return (
                  <Fragment key={b.unit.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => toggleUnit(b.unit.id)}
                    >
                      <TableCell>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{b.unit.name}</TableCell>
                      <TableCell className="text-right text-cyan-700">
                        {formatCurrency(b.estimatedTotal)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-blue-700">
                        {formatCurrency(b.actualTotal)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${Math.abs(diff) > 0.01 ? "text-amber-700" : "text-muted-foreground"}`}
                      >
                        {formatCurrency(diff)}
                      </TableCell>
                      <TableCell className="text-right">{b.lines.length}</TableCell>
                      <TableCell>
                        {b.isAdjusted ? (
                          <Badge variant="secondary" className="text-xs">
                            已调整
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            待确认
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={7} className="p-3">
                          {b.lines.length === 0 ? (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                              本月无归属本单位的销售（含分业绩份额）
                            </p>
                          ) : (
                            <div className="ml-2 space-y-2">
                              <div className="flex items-center gap-2 text-sm font-medium text-cyan-800">
                                <TrendingUp className="h-4 w-4" />
                                结算明细
                              </div>
                              <div className="overflow-x-auto rounded-md border bg-background">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>成交日</TableHead>
                                      <TableHead>销售</TableHead>
                                      <TableHead>客户</TableHead>
                                      <TableHead>产品</TableHead>
                                      <TableHead className="text-right">实收</TableHead>
                                      <TableHead className="text-right">业绩扣除</TableHead>
                                      <TableHead className="text-right">记佣金额</TableHead>
                                      <TableHead className="text-right">比例</TableHead>
                                      <TableHead className="text-right">预估结算</TableHead>
                                      <TableHead className="text-right">实际结算</TableHead>
                                      <TableHead>来源</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {b.lines.map((l, idx) => (
                                      <TableRow key={`${l.saleId}-${idx}`}>
                                        <TableCell className="text-sm">
                                          {formatDate(l.saleDate)}
                                        </TableCell>
                                        <TableCell className="text-sm">{l.salesPersonName}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                          {l.customerName || "—"}
                                        </TableCell>
                                        <TableCell className="text-sm">{l.productName}</TableCell>
                                        <TableCell className="text-right text-sm">
                                          {formatCurrency(l.receivedAmount)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-amber-800">
                                          {formatCurrency(l.performanceDeduction)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-medium text-blue-700">
                                          {formatCurrency(l.commissionBase)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-muted-foreground">
                                          {l.settlementRatioLabel}
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-medium text-cyan-700">
                                          {formatCurrency(l.estimatedSettlement)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-medium">
                                          {formatCurrency(l.actualSettlement)}
                                        </TableCell>
                                        <TableCell>
                                          {l.synced ? (
                                            <Badge className="bg-blue-100 text-blue-700 text-xs">
                                              生态圈
                                            </Badge>
                                          ) : (
                                            <Badge variant="outline" className="text-xs">
                                              手动
                                            </Badge>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                    <TableRow className="bg-muted/40 font-medium">
                                      <TableCell colSpan={8} className="text-right text-sm">
                                        合计
                                      </TableCell>
                                      <TableCell className="text-right text-cyan-800">
                                        {formatCurrency(b.estimatedTotal)}
                                      </TableCell>
                                      <TableCell className="text-right text-blue-800">
                                        {formatCurrency(b.actualTotal)}
                                      </TableCell>
                                      <TableCell />
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </div>
                              {b.isAdjusted && (
                                <p className="text-xs text-muted-foreground">
                                  实际结算已在盈亏分析调整；明细按预估占比分摊。
                                </p>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        修改单位实际结算请至{" "}
        <Link className="text-primary underline" to="/profit-analysis">
          盈亏分析 · 收入明细与结算
        </Link>
        ；比例配置在「产品结算金额设定」。
      </p>
    </div>
  );
}