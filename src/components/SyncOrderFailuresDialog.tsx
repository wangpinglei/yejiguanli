import { useCallback, useEffect, useState } from "react";
import { syncOrdersApi } from "@/lib/api";
import type { SyncOrderFailure } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { RefreshCw } from "lucide-react";

const CODE_LABEL: Record<string, string> = {
  invalid_fields: "字段无法识别",
  missing_required: "缺少必填",
  deleted_blocklist: "已删黑名单",
  db_error: "写入异常",
  upstream_error: "上游异常",
};

const SOURCE_LABEL: Record<string, string> = {
  push: "生态圈推送",
  pull: "主动拉取",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SyncOrderFailuresDialog({ open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SyncOrderFailure[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<SyncOrderFailure | null>(null);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await syncOrdersApi.listFailures({ limit: pageSize, offset: 0 });
      setItems(res.items || []);
      setTotal(res.total ?? 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
      setDetail(null);
    }
  }, [open, load]);

  return (
  <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>生态圈推送失败记录</DialogTitle>
          <DialogDescription>
            同步被跳过或写入失败时在本系统留档（不含单位/人员名称对不上但仍入库的「软失败」）。
            共 {total} 条，展示最近 {pageSize} 条。
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">时间</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>产品</TableHead>
                <TableHead>单位</TableHead>
                <TableHead>订单号</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    {loading ? "加载中…" : "暂无失败记录（部署后新产生的跳过/失败会出现在这里）"}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {row.createdAt?.replace("T", " ").slice(0, 19) || "—"}
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      <div className="flex flex-wrap gap-1 mb-0.5">
                        <Badge variant="outline" className="text-xs font-normal">
                          {CODE_LABEL[row.failureCode] || row.failureCode || "—"}
                        </Badge>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {SOURCE_LABEL[row.source] || row.source}
                        </Badge>
                      </div>
                      <p className="text-sm line-clamp-2" title={row.reason}>
                        {row.reason}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{row.customerName || "—"}</TableCell>
                    <TableCell className="text-sm">{row.productName || "—"}</TableCell>
                    <TableCell className="text-sm max-w-[8rem] truncate" title={row.salesUnitName}>
                      {row.salesUnitName || "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {row.externalOrderId || "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setDetail(row)}
                      >
                        详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={detail != null} onOpenChange={(v) => !v && setDetail(null)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>失败详情</DialogTitle>
        </DialogHeader>
        {detail && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">原因</dt>
            <dd>{detail.reason}</dd>
            <dt className="text-muted-foreground">成交日</dt>
            <dd>{detail.saleDate || "—"}</dd>
            <dt className="text-muted-foreground">销售人员</dt>
            <dd>{detail.salesPersonName || "—"}</dd>
            <dt className="text-muted-foreground">原始 payload</dt>
            <dd className="col-span-2">
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                {detail.payloadJson
                  ? (() => {
                    try {
                      return JSON.stringify(JSON.parse(detail.payloadJson), null, 2);
                    } catch {
                      return detail.payloadJson;
                    }
                  })()
                  : "（无）"}
              </pre>
            </dd>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  </>
  );
}