import { useState, useMemo } from "react";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { EMPTY_SALARY, calculateMonthlySalary, getFixedSalary, filterByMonth, MONTHLY_WORK_DAYS } from "@/lib/salary";
import type { Personnel, SalaryStructure } from "@/types";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// 默认表单
const DEFAULT_FORM = {
  name: "",
  salesUnitId: "",
  position: "",
  phone: "",
  email: "",
  salary: { ...EMPTY_SALARY },
  socialInsurance: 0,
  housingFund: 0,
  hireDate: "",
  resignDate: "",
  status: "active" as Personnel["status"],
};

// 销售总额时间范围
type SalesRange = "all" | "year" | "quarter" | "month" | "custom";

function getDateRange(range: SalesRange, customStart?: string, customEnd?: string): { start: string; end: string } | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "year") {
    return {
      start: `${now.getFullYear()}-01-01`,
      end: `${now.getFullYear()}-12-31`,
    };
  }
  if (range === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const startMonth = q * 3;
    const endMonth = startMonth + 2;
    const lastDay = new Date(now.getFullYear(), endMonth + 1, 0).getDate();
    return {
      start: `${now.getFullYear()}-${String(startMonth + 1).padStart(2, "0")}-01`,
      end: `${now.getFullYear()}-${String(endMonth + 1).padStart(2, "0")}-${lastDay}`,
    };
  }
  if (range === "month") {
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    return {
      start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      end: `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}`,
    };
  }
  if (range === "custom" && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  return null;
}

const RANGE_LABELS: Record<SalesRange, string> = {
  all: "全部时间",
  year: "本年度",
  quarter: "本季度",
  month: "本月",
  custom: "自定义",
};

export default function PersonnelPage() {
  const { addPersonnel, updatePersonnel, deletePersonnel, products, monthlyAdjustments, productPersonCommissions, teamMgmtCommissionRules, performanceTargets, unitProductSettlements } = useData();
  const teamMgmtContext = useMemo(() => ({
    rules: teamMgmtCommissionRules,
    targets: performanceTargets,
    upsList: unitProductSettlements,
  }), [teamMgmtCommissionRules, performanceTargets, unitProductSettlements]);
  const { visiblePersonnel: personnel, visibleSalesUnits: salesUnits, visibleSalesRecords: salesRecords, canEditPersonnel, isReadOnly, role } = usePermissions();
  const [search, setSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState("all");
  const [salesRange, setSalesRange] = useState<SalesRange>("year");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Personnel | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [salaryDetailPerson, setSalaryDetailPerson] = useState<Personnel | null>(null);
  const [salaryDetailMonth, setSalaryDetailMonth] = useState(new Date().toISOString().slice(0, 7));

  const [form, setForm] = useState(DEFAULT_FORM);

  // 组织部只能编辑入离职日期
  const isOrgDept = role === "org_department";
  const datesOnly = isOrgDept && !canEditPersonnel;

  const filteredPersonnel = useMemo(() => {
    return personnel.filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.position.toLowerCase().includes(search.toLowerCase());
      const matchUnit = filterUnit === "all" || p.salesUnitId === filterUnit;
      return matchSearch && matchUnit;
    });
  }, [personnel, search, filterUnit]);

  const getUnitName = (id: string) => salesUnits.find((u) => u.id === id)?.name || "-";

  // 销售总额时间范围
  const activeDateRange = useMemo(
    () => getDateRange(salesRange, customStart, customEnd),
    [salesRange, customStart, customEnd]
  );

  const getPersonnelSales = (personId: string) => {
    let records = salesRecords.filter((s) => s.personnelId === personId);
    if (activeDateRange) {
      records = records.filter((s) => {
        const d = (s.saleDate || "").slice(0, 10);
        return d >= activeDateRange.start && d <= activeDateRange.end;
      });
    }
    const total = records.reduce((sum, s) => sum + s.totalAmount, 0);
    return { count: records.length, total };
  };

  const openAdd = () => {
    setEditingPerson(null);
    setForm({
      ...DEFAULT_FORM,
      salary: { ...EMPTY_SALARY },
      socialInsurance: 0,
      housingFund: 0,
      salesUnitId: salesUnits[0]?.id || "",
      hireDate: new Date().toISOString().slice(0, 10),
    });
    setDialogOpen(true);
  };

  const openEdit = (person: Personnel) => {
    setEditingPerson(person);
    setForm({
      name: person.name,
      salesUnitId: person.salesUnitId,
      position: person.position,
      phone: person.phone,
      email: person.email,
      salary: { ...person.salary },
      socialInsurance: person.socialInsurance || 0,
      housingFund: person.housingFund || 0,
      hireDate: person.hireDate,
      resignDate: person.resignDate || "",
      status: person.status,
    });
    setDialogOpen(true);
  };

  // 更新薪资字段
  const updateSalary = (field: keyof SalaryStructure, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      salary: { ...prev.salary, [field]: value },
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.salesUnitId) return;
    const status = form.resignDate ? "inactive" as Personnel["status"] : form.status;
    const data = { ...form, resignDate: form.resignDate || undefined, status };
    try {
      if (editingPerson) {
        await updatePersonnel(editingPerson.id, data);
      } else {
        await addPersonnel(data);
      }
      setDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deletePersonnel(deleteId);
        setDeleteId(null);
      } catch (error: any) {
        alert("删除失败: " + (error.message || "未知错误"));
      }
    }
  };

  const showActions = canEditPersonnel || datesOnly;

  // 薪资明细计算（按月度）
  const salaryDetail = useMemo(() => {
    if (!salaryDetailPerson) return null;
    const adj = monthlyAdjustments.find(
      (a) => a.personnelId === salaryDetailPerson.id && a.yearMonth === salaryDetailMonth
    );
    return calculateMonthlySalary(salaryDetailPerson, salesRecords, products, salaryDetailMonth, adj, productPersonCommissions, teamMgmtContext);
  }, [salaryDetailPerson, salaryDetailMonth, salesRecords, products, monthlyAdjustments, productPersonCommissions, teamMgmtContext]);

  // 月度销售额
  const monthlyPersonnelSales = useMemo(() => {
    if (!salaryDetailPerson) return 0;
    return filterByMonth(salesRecords, salaryDetailMonth)
      .filter((s) => s.personnelId === salaryDetailPerson.id)
      .reduce((sum, s) => sum + s.totalAmount, 0);
  }, [salaryDetailPerson, salaryDetailMonth, salesRecords]);

  return (
    <div>
      <PageHeader
        title="人员管理"
        description="管理各销售单位人员信息、入离职时间、薪资结构与销售业绩"
        action={
          showActions && !isReadOnly && (
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              新增人员
            </Button>
          )
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索姓名或职位..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterUnit} onValueChange={setFilterUnit}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="筛选单位" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部单位</SelectItem>
            {salesUnits.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <Select value={salesRange} onValueChange={(v) => setSalesRange(v as SalesRange)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="year">本年度</SelectItem>
              <SelectItem value="quarter">本季度</SelectItem>
              <SelectItem value="month">本月</SelectItem>
              <SelectItem value="all">全部时间</SelectItem>
              <SelectItem value="custom">自定义</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {salesRange === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="w-36 h-9"
            />
            <span className="text-muted-foreground text-sm">至</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-36 h-9"
            />
          </div>
        )}
        <Badge variant="secondary">共 {filteredPersonnel.length} 人</Badge>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>所属单位</TableHead>
                  <TableHead>职位</TableHead>
                  <TableHead className="text-right">底薪</TableHead>
                  <TableHead className="text-right">固定月薪</TableHead>
                  <TableHead className="text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span>销售总额</span>
                      <span className="text-[10px] font-normal text-blue-600">
                        {RANGE_LABELS[salesRange]}
                        {salesRange === "custom" && customStart && customEnd
                          ? `（${customStart} ~ ${customEnd}）`
                          : ""}
                      </span>
                    </div>
                  </TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>入职日期</TableHead>
                  <TableHead>离职日期</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPersonnel.map((person) => {
                  const sales = getPersonnelSales(person.id);
                  const fixed = getFixedSalary(person.salary);
                  return (
                    <TableRow key={person.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {person.name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{person.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getUnitName(person.salesUnitId)}</TableCell>
                      <TableCell>{person.position}</TableCell>
                      <TableCell className="text-right">{formatCurrency(person.salary.baseSalary)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(fixed)}</TableCell>
                      <TableCell className="text-right font-medium text-blue-600">{formatCurrency(sales.total)}</TableCell>
                      <TableCell>
                        <Badge variant={person.status === "active" ? "default" : "secondary"}>
                          {person.status === "active" ? "在岗" : "离职"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(person.hireDate)}</TableCell>
                      <TableCell className="text-muted-foreground">{person.resignDate ? formatDate(person.resignDate) : "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="薪资明细" onClick={() => setSalaryDetailPerson(person)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {showActions && !isReadOnly ? (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => openEdit(person)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {canEditPersonnel && (
                                <Button variant="ghost" size="icon" onClick={() => setDeleteId(person.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredPersonnel.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPerson ? (datesOnly ? "编辑入离职时间" : "编辑人员") : "新增人员"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* 组织部只能编辑入离职日期 */}
            {datesOnly ? (
              <>
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                  组织部模式下仅可编辑入离职日期，其他信息不可修改
                </div>
                <div className="space-y-2">
                  <Label>姓名</Label>
                  <Input value={form.name} disabled />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>入职日期</Label>
                    <Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>离职日期</Label>
                    <Input type="date" value={form.resignDate} onChange={(e) => setForm({ ...form, resignDate: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select value={form.resignDate ? "inactive" : form.status} onValueChange={(v) => setForm({ ...form, status: v as Personnel["status"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">在岗</SelectItem>
                      <SelectItem value="inactive">离职</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>姓名 *</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="姓名" />
                  </div>
                  <div className="space-y-2">
                    <Label>所属单位 *</Label>
                    <Select value={form.salesUnitId} onValueChange={(v) => setForm({ ...form, salesUnitId: v })}>
                      <SelectTrigger><SelectValue placeholder="选择单位" /></SelectTrigger>
                      <SelectContent>
                        {salesUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>职位</Label>
                    <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="如：销售经理" />
                  </div>
                  <div className="space-y-2">
                    <Label>状态</Label>
                    <Select value={form.resignDate ? "inactive" : form.status} onValueChange={(v) => setForm({ ...form, status: v as Personnel["status"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">在岗</SelectItem>
                        <SelectItem value="inactive">离职</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>手机号</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="手机号" />
                  </div>
                  <div className="space-y-2">
                    <Label>邮箱</Label>
                    <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="邮箱" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>入职日期</Label>
                    <Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>离职日期</Label>
                    <Input type="date" value={form.resignDate} onChange={(e) => setForm({ ...form, resignDate: e.target.value })} />
                    <p className="text-xs text-muted-foreground">填写后状态自动变为"离职"</p>
                  </div>
                </div>

                {/* 薪资结构 */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">薪资结构</h4>
                    <Badge variant="secondary">
                      固定月薪：{formatCurrency(getFixedSalary(form.salary))}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    月薪 = 底薪 + 绩效 + 岗位补贴 + 管理提成 + 个人提成（提成根据销售业绩动态计算）
                  </p>

                  {/* 底薪 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">底薪 (¥)</Label>
                      <Input type="number" value={form.salary.baseSalary} onChange={(e) => updateSalary("baseSalary", Number(e.target.value))} placeholder="0" />
                    </div>
                  </div>

                  {/* 绩效 */}
                  <div className="space-y-2 rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-700">绩效</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">绩效金额 (¥)</Label>
                        <Input type="number" value={form.salary.performance} onChange={(e) => updateSalary("performance", Number(e.target.value))} placeholder="0" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">发放条件</Label>
                        <Input value={form.salary.performanceCondition} onChange={(e) => updateSalary("performanceCondition", e.target.value)} placeholder="如：完成月度销售目标80%以上发放" />
                      </div>
                    </div>
                  </div>

                  {/* 岗位补贴 */}
                  <div className="space-y-2 rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-purple-100 text-purple-700">岗位补贴</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">补贴金额 (¥)</Label>
                        <Input type="number" value={form.salary.positionAllowance} onChange={(e) => updateSalary("positionAllowance", Number(e.target.value))} placeholder="0" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">发放条件</Label>
                        <Input value={form.salary.positionAllowanceCondition} onChange={(e) => updateSalary("positionAllowanceCondition", e.target.value)} placeholder="如：管理岗位或特定职级发放" />
                      </div>
                    </div>
                  </div>

                </div>

                {/* 社保公积金 */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">社保公积金（企业承担部分）</h4>
                    <Badge variant="secondary">
                      月度合计：{formatCurrency((form.socialInsurance || 0) + (form.housingFund || 0))}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    社保和公积金将自动计入成本管理，无需手动录入
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 rounded-md bg-red-50/50 p-3">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-red-100 text-red-700">社保</Badge>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">社保金额 (¥/月)</Label>
                        <Input type="number" value={form.socialInsurance} onChange={(e) => setForm({ ...form, socialInsurance: Number(e.target.value) })} placeholder="0" />
                        <p className="text-[10px] text-muted-foreground">养老、医疗、失业、工伤、生育（企业承担部分）</p>
                      </div>
                    </div>
                    <div className="space-y-2 rounded-md bg-cyan-50/50 p-3">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-cyan-100 text-cyan-700">公积金</Badge>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">公积金金额 (¥/月)</Label>
                        <Input type="number" value={form.housingFund} onChange={(e) => setForm({ ...form, housingFund: Number(e.target.value) })} placeholder="0" />
                        <p className="text-[10px] text-muted-foreground">住房公积金（企业承担部分）</p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingPerson ? "保存" : "新增"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 薪资明细弹窗 */}
      <Dialog open={!!salaryDetailPerson} onOpenChange={(open) => !open && setSalaryDetailPerson(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>薪资明细 - {salaryDetailPerson?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {salaryDetailPerson && salaryDetail && (
            <div className="space-y-3 py-2">
              {/* 月份选择器 */}
              <div className="flex items-center gap-2">
                <Label className="text-sm">月份</Label>
                <Input
                  type="month"
                  value={salaryDetailMonth}
                  onChange={(e) => setSalaryDetailMonth(e.target.value)}
                  className="h-8 w-40"
                />
              </div>

              {/* 月度业绩 */}
              <div className="flex justify-between rounded-md border border-blue-200 bg-blue-50/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">本月销售额</span>
                <span className="font-medium text-blue-600">{formatCurrency(monthlyPersonnelSales)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">底薪</span>
                  <span className="font-medium">{formatCurrency(salaryDetail.baseSalary)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">绩效</span>
                  <span className="font-medium">{formatCurrency(salaryDetail.performance)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">岗位补贴</span>
                  <span className="font-medium">{formatCurrency(salaryDetail.positionAllowance)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">管理提成</span>
                  <span className="font-medium text-emerald-600">{formatCurrency(salaryDetail.managementCommission)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">个人提成</span>
                  <span className="font-medium text-orange-600">{formatCurrency(salaryDetail.personalCommission)}</span>
                </div>
                {salaryDetail.leaveDeduction > 0 && (
                  <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                    <span className="text-muted-foreground">请假扣款</span>
                    <span className="font-medium text-red-600">-{formatCurrency(salaryDetail.leaveDeduction)}</span>
                  </div>
                )}
                {salaryDetail.otherBonus > 0 && (
                  <div className="flex justify-between rounded-md border border-amber-200 bg-amber-50/30 px-3 py-2">
                    <span className="text-muted-foreground">其他加项</span>
                    <span className="font-medium text-amber-600">+{formatCurrency(salaryDetail.otherBonus)}</span>
                  </div>
                )}
                {salaryDetail.otherDeduction > 0 && (
                  <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                    <span className="text-muted-foreground">其他减项</span>
                    <span className="font-medium text-red-600">-{formatCurrency(salaryDetail.otherDeduction)}</span>
                  </div>
                )}
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">实际月薪</span>
                  <span className="font-bold text-blue-600">{formatCurrency(salaryDetail.total)}</span>
                </div>
              </div>

              {/* 社保公积金 */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                  <span className="text-muted-foreground">社保（企业承担）</span>
                  <span className="font-medium text-red-600">{formatCurrency(salaryDetailPerson.socialInsurance || 0)}</span>
                </div>
                <div className="flex justify-between rounded-md border border-cyan-200 bg-cyan-50/30 px-3 py-2">
                  <span className="text-muted-foreground">公积金（企业承担）</span>
                  <span className="font-medium text-cyan-600">{formatCurrency(salaryDetailPerson.housingFund || 0)}</span>
                </div>
              </div>

              <div className="flex justify-between rounded-lg bg-primary/5 px-4 py-3">
                <span className="font-semibold">总人力成本（薪资+社保+公积金）</span>
                <span className="text-lg font-bold text-primary">
                  {formatCurrency(salaryDetail.total + (salaryDetailPerson.socialInsurance || 0) + (salaryDetailPerson.housingFund || 0))}
                </span>
              </div>

              {/* 日薪参考 */}
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                日薪参考：底薪 / {MONTHLY_WORK_DAYS} = {formatCurrency(salaryDetailPerson.salary.baseSalary / MONTHLY_WORK_DAYS)} / 天
              </div>

              {/* 条件说明 */}
              <div className="space-y-1.5 rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">条件说明：</p>
                {salaryDetailPerson.salary.performanceCondition && (
                  <p className="text-xs">· 绩效：{salaryDetailPerson.salary.performanceCondition}</p>
                )}
                {salaryDetailPerson.salary.positionAllowanceCondition && (
                  <p className="text-xs">· 岗位补贴：{salaryDetailPerson.salary.positionAllowanceCondition}</p>
                )}
                {salaryDetailPerson.salary.managementCommissionCondition && (
                  <p className="text-xs">· 管理提成：{salaryDetailPerson.salary.managementCommissionCondition}（团队销售额超 {formatCurrency(salaryDetailPerson.salary.managementCommissionThreshold)} 部分按 {salaryDetailPerson.salary.managementCommissionRate}% 计算）</p>
                )}
                {salaryDetailPerson.salary.personalCommissionCondition && (
                  <p className="text-xs">· 个人提成：{salaryDetailPerson.salary.personalCommissionCondition}（个人销售额超 {formatCurrency(salaryDetailPerson.salary.personalCommissionThreshold)} 部分按 {salaryDetailPerson.salary.personalCommissionRate}% 计算）</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSalaryDetailPerson(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除该人员吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
