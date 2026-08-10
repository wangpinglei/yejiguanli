import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Zap,
  FileUp,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { hrProfilesApi, laborCompaniesApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ContractAlert, HrProfile, HrReminders, LaborCompany } from "@/types";

type ContractFilter = "all" | "due60" | "due30" | "expired" | "empty";

type HrForm = {
  personnelId: string;
  gender: string;
  contractStartDate: string;
  contractEndDate: string;
  idNumber: string;
  birthDate: string;
  ethnicity: string;
  politicalStatus: string;
  education: string;
  school: string;
  major: string;
  bankAccount: string;
  bankName: string;
  address: string;
  emergencyContact: string;
  emergencyPhone: string;
  laborCompanyId: string;
  salesCompanyId: string;
};

const EMPTY_FORM: HrForm = {
  personnelId: "",
  gender: "",
  contractStartDate: "",
  contractEndDate: "",
  idNumber: "",
  birthDate: "",
  ethnicity: "",
  politicalStatus: "",
  education: "",
  school: "",
  major: "",
  bankAccount: "",
  bankName: "",
  address: "",
  emergencyContact: "",
  emergencyPhone: "",
  laborCompanyId: "",
  salesCompanyId: "",
};

function getAlertLabel(alert: ContractAlert, daysLeft: number | null): string {
  if (alert === "expired") return "已过期";
  if (alert === "due30") return daysLeft == null ? "30天内到期" : `${daysLeft}天后到期`;
  if (alert === "due60") return daysLeft == null ? "60天内到期" : `${daysLeft}天后到期`;
  if (alert === "empty") return "未填合同";
  return "正常";
}

function getAlertClass(alert: ContractAlert): string {
  if (alert === "expired") return "bg-red-100 text-red-700 border-red-200";
  if (alert === "due30") return "bg-orange-100 text-orange-700 border-orange-200";
  if (alert === "due60") return "bg-amber-100 text-amber-800 border-amber-200";
  return "";
}

export default function HrManagementPage() {
  const { personnel, salesUnits, refreshAll } = useData();
  const { canEditHr, canViewHr, isReadOnly } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [list, setList] = useState<HrProfile[]>([]);
  const [laborCompanies, setLaborCompanies] = useState<LaborCompany[]>([]);
  const [reminders, setReminders] = useState<HrReminders | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [contractFilter, setContractFilter] = useState<ContractFilter>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HrProfile | null>(null);
  const [form, setForm] = useState<HrForm>(EMPTY_FORM);
  const [newLaborName, setNewLaborName] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batchCreating, setBatchCreating] = useState(false);
  const [importResult, setImportResult] = useState<string>("");

  const unitNameMap = useMemo(() => {
    const map = new Map<string, string>();
    salesUnits.forEach((u) => map.set(u.id, u.name));
    return map;
  }, [salesUnits]);

  const laborNameMap = useMemo(() => {
    const map = new Map<string, string>();
    laborCompanies.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [laborCompanies]);

  const profiledIds = useMemo(() => new Set(list.map((x) => x.personnelId)), [list]);

  const unprofiledPersonnel = useMemo(
    () => personnel.filter((p) => !profiledIds.has(p.id)),
    [personnel, profiledIds],
  );

  const loadData = useCallback(async () => {
    if (!canViewHr) return;
    setLoading(true);
    try {
      const [profiles, rem, companies] = await Promise.all([
        hrProfilesApi.list(),
        hrProfilesApi.reminders(),
        laborCompaniesApi.list(),
      ]);
      setList(profiles);
      setReminders(rem);
      setLaborCompanies(companies);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载失败";
      alert(msg);
    } finally {
      setLoading(false);
    }
  }, [canViewHr]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((row) => {
      if (unitFilter !== "all" && row.salesUnitId !== unitFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (contractFilter === "due60" && row.contractAlert !== "due60" && row.contractAlert !== "due30") {
        return false;
      }
      if (contractFilter === "due30" && row.contractAlert !== "due30") return false;
      if (contractFilter === "expired" && row.contractAlert !== "expired") return false;
      if (contractFilter === "empty" && row.contractAlert !== "empty") return false;
      if (!q) return true;
      const hay = [
        row.name,
        row.phone,
        row.idNumber,
        row.position,
        unitNameMap.get(row.salesUnitId) || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [list, search, unitFilter, statusFilter, contractFilter, unitNameMap]);

  function openEdit(row: HrProfile) {
    setEditing(row);
    setForm({
      personnelId: row.personnelId,
      gender: row.gender,
      contractStartDate: row.contractStartDate,
      contractEndDate: row.contractEndDate,
      idNumber: row.idNumber,
      birthDate: row.birthDate,
      ethnicity: row.ethnicity,
      politicalStatus: row.politicalStatus,
      education: row.education,
      school: row.school,
      major: row.major,
      bankAccount: row.bankAccount,
      bankName: row.bankName,
      address: row.address,
      emergencyContact: row.emergencyContact,
      emergencyPhone: row.emergencyPhone,
      laborCompanyId: row.laborCompanyId || "",
      salesCompanyId: row.salesUnitId || "",
    });
    setNewLaborName("");
    setDialogOpen(true);
  }

  async function handleAddLaborCompany() {
    const name = newLaborName.trim();
    if (!name) {
      alert("请输入签署公司名称");
      return;
    }
    try {
      const created = await laborCompaniesApi.create({ name });
      setLaborCompanies((prev) => {
        if (prev.some((c) => c.id === created.id)) return prev;
        return [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "zh"));
      });
      setForm({ ...form, laborCompanyId: created.id });
      setNewLaborName("");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "新增签署公司失败");
    }
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await hrProfilesApi.update(editing.id, form);
      setDialogOpen(false);
      await loadData();
      await refreshAll();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleBatchCreate() {
    setBatchCreating(true);
    setImportResult("");
    try {
      // 先刷新人员，避免前端人数缓存不准导致误判
      await refreshAll();
      const result = await hrProfilesApi.batchCreate();
      if (result.created === 0 && result.totalPersonnel === 0) {
        setImportResult("人员管理中暂无人员，请先在「人员管理」添加后再建档");
      } else if (result.created === 0) {
        setImportResult(
          `人员均已建档（共 ${result.totalPersonnel} 人），无需重复操作。可直接编辑档案或「批量导入表格」补全信息。`,
        );
      } else {
        setImportResult(
          `一键建档完成：新建 ${result.created} 人，已有档案跳过 ${result.skipped} 人`,
        );
      }
      await loadData();
      await refreshAll();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "一键建档失败");
    } finally {
      setBatchCreating(false);
    }
  }

  async function handleDelete(row: HrProfile) {
    if (!confirm(`确认删除「${row.name}」的人事档案？不会删除人员管理中的人员。`)) return;
    try {
      await hrProfilesApi.delete(row.id);
      await loadData();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportResult("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      // 优先用含「姓名」列的工作表
      let sheet = wb.Sheets[wb.SheetNames[0]];
      for (const name of wb.SheetNames) {
        const s = wb.Sheets[name];
        const preview = XLSX.utils.sheet_to_json<Record<string, unknown>>(s, {
          defval: "",
          raw: false,
        });
        if (
          preview.some((r) =>
            Object.keys(r).some((k) => k.replace(/\s+/g, "").includes("姓名")),
          )
        ) {
          sheet = s;
          break;
        }
      }
      const rows = XLSX.utils
        .sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
          raw: false,
        })
        .map((row) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            out[String(k).replace(/\s+/g, "").replace(/\u00a0/g, "")] = v;
          }
          return out;
        })
        .filter((row) => Object.values(row).some((v) => String(v ?? "").trim() !== ""));

      if (rows.length === 0) {
        alert("表格无数据，请确认第一行是表头（含「姓名」列）");
        return;
      }
      const result = await hrProfilesApi.importRows(rows);
      const createdPart =
        (result as { createdPersonnel?: number }).createdPersonnel
          ? `，自动新建人员 ${(result as { createdPersonnel?: number }).createdPersonnel} 人`
          : "";
      setImportResult(
        `成功 ${result.success} 条，失败 ${result.failed} 条${createdPart}` +
          (result.errors.length
            ? `。失败明细：${result.errors
                .slice(0, 10)
                .map((e) => `第${e.row}行${e.name ? `「${e.name}」` : ""} ${e.reason}`)
                .join("；")}${result.errors.length > 10 ? "…" : ""}`
            : ""),
      );
      await loadData();
      await refreshAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "导入失败";
      setImportResult(`导入失败：${msg}`);
      alert(msg);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!canViewHr) {
    return (
      <div className="p-6">
        <PageHeader title="人事管理" description="机密模块，需超级管理员授权后才能访问" />
        <Card className="mt-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            当前账号无「人事管理」查看权限
          </CardContent>
        </Card>
      </div>
    );
  }

  const canEdit = canEditHr && !isReadOnly;

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="人事管理"
        description="与人员管理 1:1 联动。劳动签署公司为独立字典；销售单位以人员管理为准（人事侧只读）。导入按姓名+部门匹配已有人员，不自动建人。薪酬与提成请到人员管理。"
        action={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportFile(f);
                }}
              />
              <Button
                disabled={batchCreating || loading}
                onClick={() => void handleBatchCreate()}
              >
                <Zap className="mr-2 h-4 w-4" />
                {batchCreating
                  ? "建档中…"
                  : unprofiledPersonnel.length > 0
                    ? `一键建档（${unprofiledPersonnel.length}）`
                    : "一键建档"}
              </Button>
              <Button
                variant="outline"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="mr-2 h-4 w-4" />
                {importing ? "导入中…" : "批量导入表格"}
              </Button>
            </div>
          ) : undefined
        }
      />

      {(reminders?.total || 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            合同提醒：已过期 {reminders?.expired || 0} 人，30 天内到期 {reminders?.due30 || 0} 人，
            60 天内到期 {reminders?.due60 || 0} 人
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-300 bg-white"
            onClick={() => setContractFilter("due60")}
          >
            查看即将到期
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-300 bg-white"
            onClick={() => setContractFilter("expired")}
          >
            查看已过期
          </Button>
        </div>
      )}

      {importResult && (
        <div className="rounded-lg border bg-muted/40 px-4 py-2 text-sm">{importResult}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索姓名 / 手机 / 身份证 / 职位"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="销售单位" />
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
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">在职</SelectItem>
            <SelectItem value="inactive">离职</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={contractFilter}
          onValueChange={(v) => setContractFilter(v as ContractFilter)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">合同：全部</SelectItem>
            <SelectItem value="due60">60天内到期</SelectItem>
            <SelectItem value="due30">30天内到期</SelectItem>
            <SelectItem value="expired">已过期</SelectItem>
            <SelectItem value="empty">未填合同</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary">共 {filtered.length} 人</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 min-w-[48px] bg-background">序号</TableHead>
                  <TableHead className="sticky left-12 z-10 min-w-[64px] bg-background">状态</TableHead>
                  <TableHead className="sticky left-[112px] z-10 min-w-[88px] bg-background">
                    姓名
                  </TableHead>
                  <TableHead>性别</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>劳动签署公司</TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead>职位</TableHead>
                  <TableHead>入职日期</TableHead>
                  <TableHead>合同起始</TableHead>
                  <TableHead>合同终止</TableHead>
                  <TableHead>合同提醒</TableHead>
                  <TableHead>身份证号</TableHead>
                  <TableHead>出生日期</TableHead>
                  <TableHead>年龄</TableHead>
                  <TableHead>民族</TableHead>
                  <TableHead>政治面貌</TableHead>
                  <TableHead>学历</TableHead>
                  <TableHead>毕业院校</TableHead>
                  <TableHead>专业</TableHead>
                  <TableHead>银行卡号</TableHead>
                  <TableHead>开户行</TableHead>
                  <TableHead>现住址</TableHead>
                  <TableHead>紧急联系人</TableHead>
                  <TableHead>紧急电话</TableHead>
                  {canEdit && <TableHead className="min-w-[100px]">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={25} className="py-10 text-center text-muted-foreground">
                      加载中…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={25} className="py-10 text-center text-muted-foreground">
                      暂无人事档案。可点「一键建档」从人员管理生成，或「批量导入表格」（须先在人员管理建好人员）。
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row, index) => (
                    <TableRow key={row.id}>
                      <TableCell className="sticky left-0 z-10 bg-background">{index + 1}</TableCell>
                      <TableCell className="sticky left-12 z-10 bg-background">
                        <Badge variant={row.status === "active" ? "default" : "secondary"}>
                          {row.status === "active" ? "在职" : "离职"}
                        </Badge>
                      </TableCell>
                      <TableCell className="sticky left-[112px] z-10 bg-background font-medium">
                        {row.name}
                      </TableCell>
                      <TableCell>{row.gender || "—"}</TableCell>
                      <TableCell>{row.phone || "—"}</TableCell>
                      <TableCell>
                        {row.laborCompanyName
                          || laborNameMap.get(row.laborCompanyId)
                          || "未匹配"}
                      </TableCell>
                      <TableCell>
                        {unitNameMap.get(row.salesUnitId) || "未分配"}
                      </TableCell>
                      <TableCell>{row.position || "—"}</TableCell>
                      <TableCell>{row.hireDate || "—"}</TableCell>
                      <TableCell>{row.contractStartDate || "—"}</TableCell>
                      <TableCell
                        className={cn(
                          row.contractAlert === "due60" || row.contractAlert === "due30"
                            ? "bg-amber-100"
                            : "",
                          row.contractAlert === "expired" ? "bg-red-100" : "",
                        )}
                      >
                        {row.contractEndDate || "—"}
                      </TableCell>
                      <TableCell>
                        {row.contractAlert !== "ok" && row.contractAlert !== "empty" ? (
                          <Badge
                            variant="outline"
                            className={cn("border", getAlertClass(row.contractAlert))}
                          >
                            {getAlertLabel(row.contractAlert, row.contractDaysLeft)}
                          </Badge>
                        ) : row.contractAlert === "empty" ? (
                          <span className="text-muted-foreground">未填</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.idNumber || "—"}</TableCell>
                      <TableCell>{row.birthDate || "—"}</TableCell>
                      <TableCell>{row.age ?? "—"}</TableCell>
                      <TableCell>{row.ethnicity || "—"}</TableCell>
                      <TableCell>{row.politicalStatus || "—"}</TableCell>
                      <TableCell>{row.education || "—"}</TableCell>
                      <TableCell>{row.school || "—"}</TableCell>
                      <TableCell>{row.major || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.bankAccount || "—"}</TableCell>
                      <TableCell>{row.bankName || "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={row.address}>
                        {row.address || "—"}
                      </TableCell>
                      <TableCell>{row.emergencyContact || "—"}</TableCell>
                      <TableCell>{row.emergencyPhone || "—"}</TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => openEdit(row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => void handleDelete(row)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑人事档案</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>劳动签署公司</Label>
              <Select
                value={form.laborCompanyId || "__none__"}
                onValueChange={(v) =>
                  setForm({ ...form, laborCompanyId: v === "__none__" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择签署公司" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未匹配</SelectItem>
                  {laborCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEdit && (
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="新签署公司名称"
                    value={newLaborName}
                    onChange={(e) => setNewLaborName(e.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleAddLaborCompany()}>
                    新增
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>销售单位（人员管理）</Label>
              <Input
                disabled
                value={
                  editing
                    ? (unitNameMap.get(editing.salesUnitId) || "未分配")
                    : ""
                }
              />
              <p className="text-xs text-muted-foreground">
                只读。改业绩归属单位请到「人员管理」。
              </p>
            </div>
            {(
              [
                ["gender", "性别"],
                ["contractStartDate", "合同起始日期"],
                ["contractEndDate", "合同终止日期"],
                ["idNumber", "身份证号"],
                ["birthDate", "出生日期"],
                ["ethnicity", "民族"],
                ["politicalStatus", "政治面貌"],
                ["education", "学历"],
                ["school", "毕业院校"],
                ["major", "专业"],
                ["bankAccount", "银行卡号"],
                ["bankName", "开户行"],
                ["emergencyContact", "紧急联系人"],
                ["emergencyPhone", "紧急电话"],
              ] as Array<[keyof HrForm, string]>
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={key.includes("Date") ? "date" : "text"}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="sm:col-span-2 space-y-1.5">
              <Label>现住址</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            劳动签署公司为独立名单，可与销售单位名称不同。导入须人员管理已有该人；不会自动新建人员。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void handleSave()}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
