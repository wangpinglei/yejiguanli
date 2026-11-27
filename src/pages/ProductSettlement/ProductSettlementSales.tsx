import { Fragment, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import type { UnitSettlementBlock } from "@/lib/saleSettlementReconcile";
import { ExpandableCellText } from "@/components/ExpandableCellText";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { buildUnitSettlementBlocks } from "@/lib/saleSettlementReconcile";
import { downloadProductSettlementSalesExcel } from "@/lib/productSettlementSalesExport";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

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
  const { products, upsertRevenueSettlement, deleteRevenueSettlement } = useData();
  const { user } = useAuth();
  const {
    visibleSalesUnits: salesUnits,
    visibleSalesRecords: salesRecords,
    visiblePersonnel: personnel,
    visibleRevenueSettlements: revenueSettlements,
    visibleUnitProductSettlements: upsList,
    canEditCost,
    canEditProduct,
    isReadOnly,
  } = usePermissions();
  /** 须盈亏分析或业务域结算的「编辑」权，查看权不能确认 */
  const canConfirmSettlement =
    !isReadOnly && (canEditCost || canEditProduct);

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(
    () => new Date().toISOString().slice(0, 7),
  );
  const [filterUnitIds, setFilterUnitIds] = useState<string[]>([]);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [confirmDialogBlock, setConfirmDialogBlock] =
    useState<UnitSettlementBlock | null>(null);
  const [confirmForm, setConfirmForm] = useState({
    actualAmount: 0,
    remark: "",
  });
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [revokingUnitId, setRevokingUnitId] = useState<string | null>(null);

  const isAllFilterUnits = filterUnitIds.length === 0;
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
    if (isAllFilterUnits) {
      if (checked) setFilterUnitIds([unitId]);
      return;
    }
    let next = checked
      ? Array.from(new Set([...filterUnitIds, unitId]))
      : filterUnitIds.filter((id) => id !== unitId);
    if (next.length === 0 || next.length === salesUnits.length) {
      next = [];
    }
    setFilterUnitIds(next);
  }

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
        unitFilterIds: isAllFilterUnits ? null : filterUnitIds,
      }),
    [
      salesUnits,
      salesRecords,
      personnel,
      products,
      upsList,
      revenueSettlements,
      selectedMonth,
      isAllFilterUnits,
      filterUnitIds,
    ],
  );

  const totals = useMemo(() => {
    const estimated = blocks.reduce((s, b) => s + b.estimatedTotal, 0);
    const actual = blocks.reduce((s, b) => s + b.actualTotal, 0);
    const count = blocks.reduce((s, b) => s + b.lines.length, 0);
    return { estimated, actual, count };
  }, [blocks]);

  function profitConfirmHref(unitId: string) {
    const q = new URLSearchParams({
      month: selectedMonth,
      unit: unitId,
      confirm: "1",
    });
    return `/profit-analysis?${q.toString()}`;
  }

  function openConfirmDialog(block: UnitSettlementBlock, e: MouseEvent) {
    e.stopPropagation();
    if (block.lines.length === 0) {
      alert("本月无销售明细，无需确认");
      return;
    }
    setConfirmDialogBlock(block);
    const actual =
      block.isAdjusted && block.settlement?.actualAmount != null
        ? Number(block.settlement.actualAmount)
        : block.estimatedTotal;
    setConfirmForm({
      actualAmount: actual,
      remark: block.settlement?.remark || "",
    });
  }

  async function submitConfirmDialog() {
    if (!confirmDialogBlock) return;
    const est = confirmDialogBlock.estimatedTotal;
    const actual = Number(confirmForm.actualAmount);
    if (!Number.isFinite(actual) || actual < 0) {
      alert("请填写有效的实际结算金额");
      return;
    }
    if (!confirmForm.remark.trim()) {
      alert("请填写确认说明（可与预估一致，注明核对无误即可）");
      return;
    }
    setConfirmSubmitting(true);
    try {
      const same = Math.abs(actual - est) < 0.005;
      await upsertRevenueSettlement({
        salesUnitId: confirmDialogBlock.unit.id,
        yearMonth: selectedMonth,
        estimatedAmount: est,
        actualAmount: actual,
        isAdjusted: true,
        remark: confirmForm.remark.trim()
          || (same ? "与预估一致确认" : "产品结算页确认"),
        adjustedBy: user?.name,
        adjustedAt: new Date().toISOString(),
      });
      setConfirmDialogBlock(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "确认失败");
    } finally {
      setConfirmSubmitting(false);
    }
  }

  async function revokeUnitBlock(
    block: UnitSettlementBlock,
    e: MouseEvent,
  ) {
    e.stopPropagation();
    const sid = block.settlement?.id;
    if (!sid || !block.isAdjusted) return;
    if (
      !window.confirm(
        `撤回「${block.unit.name}」${selectedMonth} 的结算确认？撤回后状态变为待确认，可重新核对后再确认。`,
      )
    ) {
      return;
    }
    setRevokingUnitId(block.unit.id);
    try {
      await deleteRevenueSettlement(sid);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "撤回失败");
    } finally {
      setRevokingUnitId(null);
    }
  }

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
      if (totals.count === 0) {
        alert("当前月份没有可导出的结算明细");
        return;
      }
      const fileNameSuffix = isAllFilterUnits
        ? undefined
        : filterUnitIds.length === 1
          ? salesUnits.find((u) => u.id === filterUnitIds[0])?.name
          : `已选${filterUnitIds.length}个单位`;
      await downloadProductSettlementSalesExcel(
        blocks,
        selectedMonth,
        fileNameSuffix,
      );
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
        description="各单位每月须确认一次实际结算（与盈亏分析收入结算同一记录）；确认后按预估占比分摊到订单。与预估一致时也可直接点「确认」。"
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
            <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-44 justify-between font-normal"
                >
                  <span className="truncate">{filterUnitLabel}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="end">
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  <p className="px-2 pb-1 text-xs text-muted-foreground">
                    勾选要查看/导出的单位；不选即为全部
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
            <Button
              type="button"
              variant="outline"
              disabled={exporting || totals.count === 0}
              onClick={() => void handleExport()}
              title={
                isAllFilterUnits
                  ? "导出全部单位"
                  : `仅导出：${filterUnitLabel}`
              }
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
              <TableHead className="text-right min-w-[8rem]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
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
                          <div className="space-y-0.5">
                            <Badge variant="secondary" className="text-xs">
                              已确认
                            </Badge>
                            {b.settlement?.adjustedBy && (
                              <p className="text-[10px] text-muted-foreground">
                                {b.settlement.adjustedBy}
                                {b.settlement.adjustedAt
                                  ? ` · ${formatDateTime(b.settlement.adjustedAt)}`
                                  : ""}
                              </p>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            待确认
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-col items-end gap-1">
                          {canConfirmSettlement && b.lines.length > 0 ? (
                            <Button
                              type="button"
                              size="sm"
                              variant={b.isAdjusted ? "outline" : "default"}
                              className="h-7 text-xs"
                              onClick={(e) => openConfirmDialog(b, e)}
                            >
                              {b.isAdjusted ? "重新确认" : "确认结算"}
                            </Button>
                          ) : null}
                          {b.isAdjusted && canConfirmSettlement && b.settlement?.id ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-amber-800"
                              disabled={revokingUnitId === b.unit.id}
                              onClick={(e) => void revokeUnitBlock(b, e)}
                            >
                              {revokingUnitId === b.unit.id ? "撤回中…" : "撤回确认"}
                            </Button>
                          ) : null}
                          <Link
                            to={profitConfirmHref(b.unit.id)}
                            className="inline-flex items-center gap-0.5 text-xs text-primary underline-offset-2 hover:underline"
                          >
                            盈亏分析
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={8} className="p-3">
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
                                <Table className="min-w-[1180px] table-fixed text-sm [&_td]:overflow-hidden [&_th]:overflow-hidden">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-[5.5rem]">成交日</TableHead>
                                      <TableHead className="w-[4.5rem]">销售</TableHead>
                                      <TableHead className="w-[5.5rem]">客户</TableHead>
                                      <TableHead className="w-[7.5rem]">产品</TableHead>
                                      <TableHead className="w-[5rem] text-right">订单金额</TableHead>
                                      <TableHead className="w-[4.5rem] text-right">实收</TableHead>
                                      <TableHead className="w-[5rem] text-right">业绩扣除</TableHead>
                                      <TableHead className="w-[7.5rem]">扣除原因</TableHead>
                                      <TableHead className="w-[5rem] text-right">记佣金额</TableHead>
                                      <TableHead className="w-[3.5rem] text-right">比例</TableHead>
                                      <TableHead className="w-[5rem] text-right">预估结算</TableHead>
                                      <TableHead className="w-[5rem] text-right">实际结算</TableHead>
                                      <TableHead className="w-[4rem]">来源</TableHead>
                                      <TableHead className="w-[6.5rem]">订单号</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {b.lines.map((l, idx) => (
                                      <TableRow key={`${l.saleId}-${idx}`}>
                                        <TableCell className="whitespace-nowrap text-sm">
                                          {formatDate(l.saleDate)}
                                        </TableCell>
                                        <TableCell className="align-top text-sm">
                                          <ExpandableCellText
                                            text={l.salesPersonName}
                                            label="销售"
                                            maxLen={6}
                                            lineClamp={1}
                                            textClassName="text-sm"
                                          />
                                        </TableCell>
                                        <TableCell className="align-top text-sm text-muted-foreground">
                                          <ExpandableCellText
                                            text={l.customerName || "—"}
                                            label="客户"
                                            emptyText="—"
                                            maxLen={8}
                                            lineClamp={1}
                                            textClassName="text-sm text-muted-foreground"
                                          />
                                        </TableCell>
                                        <TableCell className="align-top text-sm">
                                          <ExpandableCellText
                                            text={l.productName}
                                            label="产品"
                                            maxLen={12}
                                            lineClamp={2}
                                            textClassName="text-sm"
                                          />
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                                          {l.orderAmount > 0
                                            ? formatCurrency(l.orderAmount)
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="text-right text-sm whitespace-nowrap">
                                          {formatCurrency(l.receivedAmount)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-amber-800 whitespace-nowrap">
                                          {formatCurrency(l.performanceDeduction)}
                                        </TableCell>
                                        <TableCell className="align-top">
                                          <ExpandableCellText
                                            text={
                                              l.performanceDeduction <= 0
                                                ? "无业绩扣除"
                                                : l.performanceDeductionRemarkBrief
                                            }
                                            detailText={
                                              l.performanceDeduction <= 0
                                                ? undefined
                                                : l.performanceDeductionRemark
                                            }
                                            label="扣除原因"
                                            emptyText="无业绩扣除"
                                            maxLen={40}
                                            lineClamp={2}
                                            textClassName="text-xs leading-snug text-muted-foreground"
                                          />
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-medium text-blue-700 whitespace-nowrap">
                                          {formatCurrency(l.commissionBase)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                                          {l.settlementRatioLabel}
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-medium text-cyan-700 whitespace-nowrap">
                                          {formatCurrency(l.estimatedSettlement)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-medium whitespace-nowrap">
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
                                        <TableCell className="align-top text-sm text-muted-foreground">
                                          <ExpandableCellText
                                            text={l.orderNumber || "—"}
                                            label="订单号"
                                            emptyText="—"
                                            maxLen={10}
                                            lineClamp={1}
                                            textClassName="text-sm text-muted-foreground"
                                          />
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                    <TableRow className="bg-muted/40 font-medium">
                                      <TableCell colSpan={10} className="text-right text-sm">
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
                                  已与盈亏分析「收入明细与结算」关联确认
                                  {b.settlement?.adjustedBy
                                    ? `（${b.settlement.adjustedBy}）`
                                    : ""}
                                  ；有差额时明细按预估占比分摊实际结算。
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
        各单位每月须在弹窗中核对实际金额并填写说明后确认，与{" "}
        <Link className="text-primary underline" to="/profit-analysis">
          盈亏分析 · 收入明细与结算
        </Link>
        共用同一条记录。比例配置在「产品结算金额设定」。
      </p>

      <Dialog
        open={!!confirmDialogBlock}
        onOpenChange={(open) => {
          if (!open) setConfirmDialogBlock(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认单位产品结算</DialogTitle>
          </DialogHeader>
          {confirmDialogBlock && (
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {confirmDialogBlock.unit.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedMonth}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">预估结算</p>
                  <p className="text-lg font-bold text-cyan-700">
                    {formatCurrency(confirmDialogBlock.estimatedTotal)}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-actual">实际结算金额（¥）</Label>
                <Input
                  id="confirm-actual"
                  type="number"
                  min={0}
                  step="0.01"
                  value={confirmForm.actualAmount}
                  onChange={(e) =>
                    setConfirmForm({
                      ...confirmForm,
                      actualAmount: Number(e.target.value),
                    })
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  与预估一致可保持默认金额，有差额请改为财务核定数。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-remark">确认说明（必填）</Label>
                <Textarea
                  id="confirm-remark"
                  value={confirmForm.remark}
                  onChange={(e) =>
                    setConfirmForm({
                      ...confirmForm,
                      remark: e.target.value,
                    })
                  }
                  placeholder="例：与预估核对无误 / 退款扣除后调整"
                  rows={2}
                />
              </div>
              {Math.abs(
                confirmForm.actualAmount - confirmDialogBlock.estimatedTotal,
              ) > 0.005 && (
                <p className="text-xs text-amber-800">
                  差额：
                  {formatCurrency(
                    confirmForm.actualAmount
                      - confirmDialogBlock.estimatedTotal,
                  )}
                  ；保存后订单明细将按预估占比分摊实际结算。
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={confirmSubmitting}
              onClick={() => setConfirmDialogBlock(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={confirmSubmitting || !canConfirmSettlement}
              onClick={() => void submitConfirmDialog()}
            >
              {confirmSubmitting ? "保存中…" : "保存确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}