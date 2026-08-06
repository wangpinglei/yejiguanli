import { useState, useMemo, useEffect } from "react";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate, formatDateTime, getYearMonth } from "@/lib/format";
import { getTotalSalaryCost, calcLeaveDeduction, MONTHLY_WORK_DAYS } from "@/lib/salary";
import type { CostRecord, CostItem, IncomeRecord, IncomeItem } from "@/types";
import {
  Plus, Search, Pencil, Trash2, Wallet, X, ChevronDown, ChevronRight, Clock,
  Users, Calculator, History, Percent, CalendarDays, Save, TrendingUp, Repeat, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import MSalesCommissionPanel from "./CostManagement/components/m-sales-commission-panel";
import MTeamMgmtCommissionPanel from "./CostManagement/components/m-team-mgmt-commission-panel";

const costCategories = ["人力成本", "办公租金", "营销推广", "差旅交通", "运营杂费", "设备采购", "其他"];
const incomeCategories = ["服务费收入", "咨询费收入", "技术支持费", "培训费收入", "退款收入", "其他收入"];

export default function CostManagement() {
  const { addCostRecord, updateCostRecord, deleteCostRecord, costChangeLogs, products, monthlyAdjustments, upsertMonthlyAdjustment, addIncomeRecord, updateIncomeRecord, deleteIncomeRecord, productPersonCommissions, teamMgmtCommissionRules, performanceTargets, unitProductSettlements } = useData();
  const { user } = useAuth();
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleCostRecords: costRecords, visibleIncomeRecords: incomeRecords, visibleSalesRecords: salesRecords, canEditCost, isReadOnly, role } = usePermissions();
  const [search, setSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // "2026-08"
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CostRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedSalaryRows, setExpandedSalaryRows] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);

  // Form state
  const [form, setForm] = useState({
    salesUnitId: "",
    date: new Date().toISOString().slice(0, 10),
    remark: "",
    changeReason: "",
  });
  const [formItems, setFormItems] = useState<CostItem[]>([
    { id: `ci${Date.now()}`, category: "人力成本", amount: 0, description: "" },
  ]);

  // 收入录入状态
  const [incomeDialogOpen, setIncomeDialogOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeRecord | null>(null);
  const [incomeDeleteId, setIncomeDeleteId] = useState<string | null>(null);
  const [incomeForm, setIncomeForm] = useState({
    salesUnitId: "",
    date: new Date().toISOString().slice(0, 10),
    remark: "",
    isRecurring: false, // 是否月度固定
    recurringMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as number[], // 适用月份
    recurringEndDate: "", // 月度固定结束日期（可选）
  });
  const [incomeFormItems, setIncomeFormItems] = useState<IncomeItem[]>([
    { id: `ii${Date.now()}`, category: "服务费收入", amount: 0, description: "" },
  ]);

  // Adjustment form state (inline editing)
  const [adjForm, setAdjForm] = useState<Record<string, { leaveDays: number; otherBonus: number; otherDeduction: number; note: string }>>({});

  // Delete reason state
  const [deleteReason, setDeleteReason] = useState("");

  const isSuperadmin = role === "superadmin";

  const teamMgmtContext = useMemo(() => ({
    rules: teamMgmtCommissionRules,
    targets: performanceTargets,
    upsList: unitProductSettlements,
  }), [teamMgmtCommissionRules, performanceTargets, unitProductSettlements]);

  // ===================== 自动薪酬成本计算（按月度） =====================
  const salaryCosts = useMemo(() => {
    const unitIds = filterUnit === "all"
      ? salesUnits.map((u) => u.id)
      : [filterUnit];
    return getTotalSalaryCost(
      unitIds,
      personnel,
      salesRecords,
      products,
      selectedMonth,
      monthlyAdjustments,
      productPersonCommissions,
      teamMgmtContext,
    );
  }, [salesUnits, personnel, salesRecords, filterUnit, products, selectedMonth, monthlyAdjustments, productPersonCommissions, teamMgmtContext]);

  // 按月过滤手动成本记录
  const filteredRecords = useMemo(() => {
    return costRecords
      .filter((c) => {
        const matchUnit = filterUnit === "all" || c.salesUnitId === filterUnit;
        const matchMonth = getYearMonth(c.date) === selectedMonth;
        const matchSearch = c.remark.toLowerCase().includes(search.toLowerCase());
        return matchUnit && matchMonth && matchSearch;
      })
      .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  }, [costRecords, filterUnit, selectedMonth, search]);

  const manualCostTotal = useMemo(() => {
    return filteredRecords.reduce((sum, c) => sum + c.totalCost, 0);
  }, [filteredRecords]);

  // 按月过滤收入记录（同时匹配普通记录和月度固定记录）
  const filteredIncomeRecords = useMemo(() => {
    const targetMonth = selectedMonth; // "2026-08"
    const targetM = parseInt(targetMonth.slice(5, 7), 10);
    return incomeRecords
      .filter((r) => {
        const matchUnit = filterUnit === "all" || r.salesUnitId === filterUnit;
        if (!matchUnit) return false;
        // 月度固定模式：判断目标月是否在适用月份内 + 起止日期
        if (r.isRecurring) {
          const months = r.recurringMonths || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
          if (!months.includes(targetM)) return false;
          // 起始日期校验
          if (r.date && targetMonth < r.date.slice(0, 7)) return false;
          // 结束日期校验
          if (r.recurringEndDate && targetMonth > r.recurringEndDate.slice(0, 7)) return false;
          return true;
        }
        // 普通记录按日期月份匹配
        return getYearMonth(r.date) === selectedMonth;
      })
      .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  }, [incomeRecords, filterUnit, selectedMonth]);

  const incomeTotal = useMemo(() => {
    return filteredIncomeRecords.reduce((sum, r) => sum + r.totalAmount, 0);
  }, [filteredIncomeRecords]);

  const productCommissionTotal = salaryCosts.grandSalesCommission;
  const leaveDeductionTotal = salaryCosts.grandLeaveDeduction;
  const otherAdjustmentTotal = salaryCosts.grandOtherAdjustment;

  const grandTotal = manualCostTotal + salaryCosts.grandTotal;

  // 选中单位和月份下的在职人员（用于月度调整面板）
  const adjustmentPersonnel = useMemo(() => {
    const unitIds = filterUnit === "all"
      ? salesUnits.map((u) => u.id)
      : [filterUnit];
    return personnel.filter((p) => p.status === "active" && unitIds.includes(p.salesUnitId));
  }, [personnel, salesUnits, filterUnit]);

  // 初始化调整表单（从已有数据加载）
  useEffect(() => {
    if (adjustmentDialogOpen) {
      const newForm: Record<string, { leaveDays: number; otherBonus: number; otherDeduction: number; note: string }> = {};
      adjustmentPersonnel.forEach((p) => {
        const existing = monthlyAdjustments.find(
          (a) => a.personnelId === p.id && a.yearMonth === selectedMonth
        );
        newForm[p.id] = {
          leaveDays: existing?.leaveDays || 0,
          otherBonus: existing?.otherBonus || 0,
          otherDeduction: existing?.otherDeduction || 0,
          note: existing?.note || "",
        };
      });
      setAdjForm(newForm);
    }
  }, [adjustmentDialogOpen, adjustmentPersonnel, monthlyAdjustments, selectedMonth]);

  const getUnitName = (id: string) => salesUnits.find((u) => u.id === id)?.name || "-";

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSalaryRow = (id: string) => {
    setExpandedSalaryRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openAdd = () => {
    setEditingRecord(null);
    setForm({
      salesUnitId: salesUnits[0]?.id || "",
      date: new Date().toISOString().slice(0, 10),
      remark: "",
      changeReason: "",
    });
    setFormItems([{ id: `ci${Date.now()}`, category: "人力成本", amount: 0, description: "" }]);
    setDialogOpen(true);
  };

  const openEdit = (record: CostRecord) => {
    setEditingRecord(record);
    setForm({
      salesUnitId: record.salesUnitId,
      date: record.date,
      remark: record.remark,
      changeReason: "",
    });
    setFormItems(record.items.length > 0 ? record.items.map((i) => ({ ...i })) : [{ id: `ci${Date.now()}`, category: "人力成本", amount: 0, description: "" }]);
    setDialogOpen(true);
  };

  // Dynamic row operations
  const addRow = () => {
    setFormItems([...formItems, { id: `ci${Date.now()}${Math.random()}`, category: "其他", amount: 0, description: "" }]);
  };

  const removeRow = (id: string) => {
    if (formItems.length <= 1) return;
    setFormItems(formItems.filter((item) => item.id !== id));
  };

  const updateRow = (id: string, field: keyof CostItem, value: string | number) => {
    setFormItems(formItems.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const formTotalCost = formItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  const operator = user ? { name: user.name, id: user.id } : undefined;

  const handleSubmit = async () => {
    if (!form.salesUnitId) return;
    const validItems = formItems.filter((i) => i.amount > 0);
    if (validItems.length === 0) return;
    if (!form.changeReason.trim()) {
      alert("请填写变更原因");
      return;
    }
    const data = { ...form, items: validItems, createdBy: user?.name };
    try {
      if (editingRecord) {
        await updateCostRecord(editingRecord.id, data, form.changeReason.trim(), operator);
      } else {
        await addCostRecord(data, form.changeReason.trim(), operator);
      }
      setDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    if (!deleteReason.trim()) {
      alert("请填写删除原因");
      return;
    }
    try {
      await deleteCostRecord(deleteId, deleteReason.trim(), operator);
      setDeleteId(null);
      setDeleteReason("");
    } catch (error: any) {
      alert("删除失败: " + (error.message || "未知错误"));
    }
  };

  // ===================== 收入录入操作 =====================
  const openAddIncome = () => {
    setEditingIncome(null);
    setIncomeForm({
      salesUnitId: salesUnits[0]?.id || "",
      date: new Date().toISOString().slice(0, 10),
      remark: "",
      isRecurring: false,
      recurringMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      recurringEndDate: "",
    });
    setIncomeFormItems([{ id: `ii${Date.now()}`, category: "服务费收入", amount: 0, description: "" }]);
    setIncomeDialogOpen(true);
  };

  const openEditIncome = (record: IncomeRecord) => {
    setEditingIncome(record);
    setIncomeForm({
      salesUnitId: record.salesUnitId,
      date: record.date,
      remark: record.remark,
      isRecurring: !!record.isRecurring,
      recurringMonths: record.recurringMonths || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      recurringEndDate: record.recurringEndDate || "",
    });
    setIncomeFormItems(record.items.length > 0 ? record.items.map((i) => ({ ...i })) : [{ id: `ii${Date.now()}`, category: "服务费收入", amount: 0, description: "" }]);
    setIncomeDialogOpen(true);
  };

  const addIncomeRow = () => {
    setIncomeFormItems([...incomeFormItems, { id: `ii${Date.now()}${Math.random()}`, category: "其他收入", amount: 0, description: "" }]);
  };

  const removeIncomeRow = (id: string) => {
    if (incomeFormItems.length <= 1) return;
    setIncomeFormItems(incomeFormItems.filter((item) => item.id !== id));
  };

  const updateIncomeRow = (id: string, field: keyof IncomeItem, value: string | number) => {
    setIncomeFormItems(incomeFormItems.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const incomeFormTotal = incomeFormItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  const handleIncomeSubmit = async () => {
    if (!incomeForm.salesUnitId) return;
    const validItems = incomeFormItems.filter((i) => i.amount > 0);
    if (validItems.length === 0) return;
    if (incomeForm.isRecurring && incomeForm.recurringMonths.length === 0) {
      alert("月度固定模式下，请至少选择一个适用月份");
      return;
    }
    const data = {
      ...incomeForm,
      items: validItems,
      createdBy: user?.name,
      // 月度固定模式保存时清理字段
      isRecurring: incomeForm.isRecurring || undefined,
      recurringMonths: incomeForm.isRecurring ? incomeForm.recurringMonths : undefined,
      recurringEndDate: incomeForm.isRecurring && incomeForm.recurringEndDate ? incomeForm.recurringEndDate : undefined,
    };
    try {
      if (editingIncome) {
        await updateIncomeRecord(editingIncome.id, data);
      } else {
        await addIncomeRecord(data);
      }
      setIncomeDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleIncomeDelete = async () => {
    if (!incomeDeleteId) return;
    try {
      await deleteIncomeRecord(incomeDeleteId);
      setIncomeDeleteId(null);
    } catch (error: any) {
      alert("删除失败: " + (error.message || "未知错误"));
    }
  };

  // 保存月度调整
  const handleSaveAdjustments = async () => {
    try {
      for (const personId of Object.keys(adjForm)) {
        const data = adjForm[personId];
        // 只保存有内容的记录
        if (data.leaveDays > 0 || data.otherBonus > 0 || data.otherDeduction > 0 || data.note.trim()) {
          await upsertMonthlyAdjustment({
            personnelId: personId,
            yearMonth: selectedMonth,
            leaveDays: data.leaveDays,
            otherBonus: data.otherBonus,
            otherDeduction: data.otherDeduction,
            note: data.note,
            createdBy: user?.name,
          });
        }
      }
      setAdjustmentDialogOpen(false);
    } catch (error: any) {
      alert("保存失败: " + (error.message || "未知错误"));
    }
  };

  const actionLabels: Record<string, { label: string; color: string }> = {
    create: { label: "新增", color: "bg-green-100 text-green-700" },
    update: { label: "修改", color: "bg-blue-100 text-blue-700" },
    delete: { label: "删除", color: "bg-red-100 text-red-700" },
  };

  // 月份选项（近12个月 + 当前月）
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
        title="成本管理"
        description="按月度管理人员成本；个人提成与团队管理提成在本页上方配置，自动计入成本"
        action={
          <div className="flex gap-2">
            {isSuperadmin && (
              <Button variant="outline" onClick={() => setHistoryOpen(true)}>
                <History className="mr-2 h-4 w-4" />变更记录
              </Button>
            )}
            {canEditCost && !isReadOnly && (
              <Button variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={openAddIncome}>
                <TrendingUp className="mr-2 h-4 w-4" />新增收入记录
              </Button>
            )}
            {canEditCost && !isReadOnly && (
              <Button onClick={openAdd}>
                <Plus className="mr-2 h-4 w-4" />新增成本记录
              </Button>
            )}
          </div>
        }
      />

      {/* 月份 + 单位筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-blue-600" />
          <Label className="text-sm font-medium">月份</Label>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Select value={filterUnit} onValueChange={setFilterUnit}>
          <SelectTrigger className="w-48"><SelectValue placeholder="筛选单位" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部单位</SelectItem>
            {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {canEditCost && !isReadOnly && (
          <Button variant="outline" onClick={() => setAdjustmentDialogOpen(true)}>
            <Users className="mr-2 h-4 w-4" />月度人员调整
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <Calculator className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">自动人力成本</p>
              <p className="text-xl font-bold text-blue-600">{formatCurrency(salaryCosts.grandTotal)}</p>
              <p className="text-[10px] text-muted-foreground">薪酬 {formatCurrency(salaryCosts.grandSalary)} + 社保公积金 {formatCurrency(salaryCosts.grandSocialInsurance + salaryCosts.grandHousingFund)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
              <Wallet className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">社保公积金合计</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(salaryCosts.grandSocialInsurance + salaryCosts.grandHousingFund)}</p>
              <p className="text-[10px] text-muted-foreground">社保 {formatCurrency(salaryCosts.grandSocialInsurance)} / 公积金 {formatCurrency(salaryCosts.grandHousingFund)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50">
              <Wallet className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">手动录入成本</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(manualCostTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{selectedMonth} 月</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50">
              <CalendarDays className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">请假扣款 / 其他调整</p>
              <p className="text-xl font-bold text-amber-600">-{formatCurrency(leaveDeductionTotal)}</p>
              <p className="text-[10px] text-muted-foreground">其他调整 {otherAdjustmentTotal >= 0 ? "+" : ""}{formatCurrency(otherAdjustmentTotal)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
              <TrendingUp className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">其他收入</p>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(incomeTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{selectedMonth} 月 · {filteredIncomeRecords.length} 条</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50">
              <Users className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">在职人数 / 总成本</p>
              <p className="text-xl font-bold">{salaryCosts.units.reduce((sum, u) => sum + u.activeCount, 0)} 人</p>
              <p className="text-[10px] font-medium text-red-600">{formatCurrency(grandTotal)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50">
              <Percent className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">销售提成合计</p>
              <p className="text-xl font-bold text-violet-600">{formatCurrency(productCommissionTotal)}</p>
              <p className="text-[10px] text-muted-foreground">个人+团队管理提成</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 团队管理提成：单位级规则 */}
      <section
        id="team-mgmt-commission-config"
        className="mb-6 rounded-xl border-2 border-emerald-300 bg-emerald-50/40 p-5"
      >
        <MTeamMgmtCommissionPanel selectedMonth={selectedMonth} />
      </section>

      {/* 销售个人提成：整宽常驻配置 */}
      <section
        id="sales-commission-config"
        className="mb-6 rounded-xl border-2 border-violet-300 bg-violet-50/40 p-5"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100">
              <Percent className="h-5 w-5 text-violet-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-violet-900">销售个人提成配置</h3>
              <p className="text-xs text-muted-foreground">
                按产品 × 单位 × 人员设置个人提成与特殊奖励；本月提成合计{" "}
                <span className="font-semibold text-violet-700">
                  {formatCurrency(productCommissionTotal)}
                </span>
              </p>
            </div>
          </div>
        </div>
        <MSalesCommissionPanel selectedMonth={selectedMonth} />
      </section>

      {/* ===================== 自动薪酬成本明细 ===================== */}
      <Card className="mb-6">
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Calculator className="h-5 w-5 text-blue-600" />
            <h3 className="text-base font-semibold">自动计入人力成本（{selectedMonth} 月度）</h3>
            <Badge variant="secondary" className="ml-auto">系统自动计算</Badge>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead className="text-right">在职人数</TableHead>
                  <TableHead className="text-right">底薪合计</TableHead>
                  <TableHead className="text-right">绩效合计</TableHead>
                  <TableHead className="text-right">岗位补贴</TableHead>
                  <TableHead className="text-right">团队管理提成</TableHead>
                  <TableHead className="text-right">个人提成</TableHead>
                  <TableHead className="text-right">请假扣款</TableHead>
                  <TableHead className="text-right">其他调整</TableHead>
                  <TableHead className="text-right">社保</TableHead>
                  <TableHead className="text-right">公积金</TableHead>
                  <TableHead className="text-right">总人力成本</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaryCosts.units.map((unit) => {
                  const isExpanded = expandedSalaryRows.has(unit.unitId);
                  const sums = unit.details.reduce((acc, d) => ({
                    base: acc.base + d.baseSalary,
                    perf: acc.perf + d.performance,
                    pos: acc.pos + d.positionAllowance,
                    mgmt: acc.mgmt + d.managementCommission,
                    personal: acc.personal + d.personalCommission,
                    leave: acc.leave + d.leaveDeduction,
                    other: acc.other + d.otherBonus - d.otherDeduction,
                  }), { base: 0, perf: 0, pos: 0, mgmt: 0, personal: 0, leave: 0, other: 0 });
                  return (
                    <>
                      <TableRow
                        key={unit.unitId}
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => toggleSalaryRow(unit.unitId)}
                      >
                        <TableCell>
                          <button className="flex h-6 w-6 items-center justify-center rounded">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">
                          <Badge variant="outline">{getUnitName(unit.unitId)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{unit.activeCount} 人</TableCell>
                        <TableCell className="text-right text-gray-600">{formatCurrency(sums.base)}</TableCell>
                        <TableCell className="text-right text-blue-600">{formatCurrency(sums.perf)}</TableCell>
                        <TableCell className="text-right text-violet-600">{formatCurrency(sums.pos)}</TableCell>
                        <TableCell className="text-right text-emerald-600">{formatCurrency(sums.mgmt)}</TableCell>
                        <TableCell className="text-right text-amber-600">{formatCurrency(sums.personal)}</TableCell>
                        <TableCell className="text-right text-red-600">-{formatCurrency(sums.leave)}</TableCell>
                        <TableCell className="text-right text-amber-600">{sums.other >= 0 ? "+" : ""}{formatCurrency(sums.other)}</TableCell>
                        <TableCell className="text-right text-red-600">{formatCurrency(unit.totalSocialInsurance)}</TableCell>
                        <TableCell className="text-right text-cyan-600">{formatCurrency(unit.totalHousingFund)}</TableCell>
                        <TableCell className="text-right font-bold text-blue-600">{formatCurrency(unit.totalCost)}</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={unit.unitId + "-detail"} className="bg-blue-50/30">
                          <TableCell colSpan={13} className="py-3">
                            <div className="ml-8 space-y-2">
                              {unit.details.map((d) => (
                                <div key={d.personId} className="grid grid-cols-11 gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
                                  <span className="font-medium">{d.name}</span>
                                  <span className="text-muted-foreground">{d.position}</span>
                                  <span className="text-right text-gray-600">底薪 {formatCurrency(d.baseSalary)}</span>
                                  <span className="text-right text-blue-600">绩效 {formatCurrency(d.performance)}</span>
                                  <span className="text-right text-emerald-600">提成 {formatCurrency(d.managementCommission + d.personalCommission)}</span>
                                  <span className="text-right text-red-600">请假扣 {formatCurrency(d.leaveDeduction)}</span>
                                  <span className="text-right text-amber-600">其他 {formatCurrency(d.otherBonus - d.otherDeduction)}</span>
                                  <span className="text-right text-red-600">社保 {formatCurrency(d.socialInsurance)}</span>
                                  <span className="text-right text-cyan-600">公积金 {formatCurrency(d.housingFund)}</span>
                                  <span className="text-right text-muted-foreground">{d.adjustment?.note || "-"}</span>
                                  <span className="text-right font-bold text-blue-600">{formatCurrency(d.total)}</span>
                                </div>
                              ))}
                              {unit.details.length === 0 && (
                                <p className="text-center text-sm text-muted-foreground py-2">该单位暂无在职人员</p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {salaryCosts.units.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">暂无在职人员数据</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ===================== 手动录入成本 ===================== */}
      <div className="mb-4 flex items-center gap-2">
        <Wallet className="h-5 w-5 text-orange-600" />
        <h3 className="text-base font-semibold">手动录入成本记录</h3>
        <Badge variant="outline" className="ml-1">{selectedMonth} · {filteredRecords.length} 条</Badge>
      </div>

      {/* Search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜索备注..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>记录日期</TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead className="text-right">成本项数</TableHead>
                  <TableHead className="text-right">总成本</TableHead>
                  <TableHead>录入时间</TableHead>
                  <TableHead>录入人</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => {
                  const isExpanded = expandedRows.has(record.id);
                  return (
                    <>
                      <TableRow key={record.id} className="cursor-pointer hover:bg-accent/50" onClick={() => toggleRow(record.id)}>
                        <TableCell>
                          <button className="flex h-6 w-6 items-center justify-center rounded">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">{formatDate(record.date)}</TableCell>
                        <TableCell><Badge variant="outline">{getUnitName(record.salesUnitId)}</Badge></TableCell>
                        <TableCell className="text-right">{record.items.length}</TableCell>
                        <TableCell className="text-right font-bold text-orange-600">{formatCurrency(record.totalCost)}</TableCell>
                        <TableCell>
                          {record.createdAt ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatDateTime(record.createdAt)}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-sm">{record.createdBy || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{record.remark || "-"}</TableCell>
                        <TableCell className="text-right">
                          {canEditCost && !isReadOnly ? (
                            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" onClick={() => openEdit(record)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => { setDeleteId(record.id); setDeleteReason(""); }}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>仅查看</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={record.id + "-detail"} className="bg-muted/30">
                          <TableCell colSpan={9} className="py-3">
                            <div className="ml-8 space-y-2">
                              {record.items.map((item) => (
                                <div key={item.id} className="flex items-center gap-4 rounded-lg border bg-card px-4 py-2 text-sm">
                                  <Badge variant="secondary">{item.category}</Badge>
                                  <span className="flex-1 text-muted-foreground">{item.description || "-"}</span>
                                  <span className="font-semibold text-orange-600">{formatCurrency(item.amount)}</span>
                                </div>
                              ))}
                              <div className="flex justify-end border-t pt-2 text-sm">
                                <span className="mr-3 text-muted-foreground">合计</span>
                                <span className="font-bold text-orange-600">{formatCurrency(record.totalCost)}</span>
                              </div>
                              {record.changeReason && (
                                <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                                  <strong>最近变更原因：</strong>{record.changeReason}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">{selectedMonth} 月暂无手动成本记录</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ===================== 其他收入记录 ===================== */}
      <div className="mt-8 mb-4 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-emerald-600" />
        <h3 className="text-base font-semibold">其他收入记录</h3>
        <Badge variant="outline" className="ml-1 border-emerald-200 text-emerald-700">{selectedMonth} · {filteredIncomeRecords.length} 条</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>周期</TableHead>
                  <TableHead>记录/起始日期</TableHead>
                  <TableHead>销售单位</TableHead>
                  <TableHead className="text-right">收入项数</TableHead>
                  <TableHead className="text-right">总收入</TableHead>
                  <TableHead>录入时间</TableHead>
                  <TableHead>录入人</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredIncomeRecords.map((record) => {
                  const isExp = expandedRows.has(record.id);
                  const monthCount = record.recurringMonths?.length || 0;
                  return (
                    <>
                      <TableRow key={record.id} className="cursor-pointer hover:bg-accent/50" onClick={() => toggleRow(record.id)}>
                        <TableCell>
                          <button className="flex h-6 w-6 items-center justify-center rounded">
                            {isExp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell>
                          {record.isRecurring ? (
                            <Badge className="bg-violet-100 text-violet-700 text-xs">
                              <Repeat className="mr-1 h-3 w-3" />每月
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">单次</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {record.isRecurring ? (
                            <div>
                              <div className="text-sm">{formatDate(record.date)} 起</div>
                              {monthCount > 0 && monthCount < 12 && (
                                <div className="text-[10px] text-violet-600 mt-0.5">
                                  {record.recurringMonths!.map((m) => `${m}月`).join("、")}
                                </div>
                              )}
                              {monthCount === 12 && (
                                <div className="text-[10px] text-violet-600 mt-0.5">全年</div>
                              )}
                            </div>
                          ) : (
                            formatDate(record.date)
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline">{getUnitName(record.salesUnitId)}</Badge></TableCell>
                        <TableCell className="text-right">{record.items.length}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-600">{formatCurrency(record.totalAmount)}</TableCell>
                        <TableCell>
                          {record.createdAt ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatDateTime(record.createdAt)}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-sm">{record.createdBy || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{record.remark || "-"}</TableCell>
                        <TableCell className="text-right">
                          {canEditCost && !isReadOnly ? (
                            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" onClick={() => openEditIncome(record)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setIncomeDeleteId(record.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>仅查看</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExp && (
                        <TableRow key={record.id + "-detail"} className="bg-emerald-50/30">
                          <TableCell colSpan={10} className="py-3">
                            <div className="ml-8 space-y-2">
                              {record.isRecurring && (
                                <div className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-800">
                                  <Repeat className="inline mr-1 h-3 w-3" />
                                  <strong>月度固定收入：</strong>
                                  自 {formatDate(record.date)} 起
                                  {record.recurringEndDate ? `至 ${formatDate(record.recurringEndDate)} 止` : "永久生效"}
                                  ，每月
                                  {record.recurringMonths?.length === 12 ? "（全年）" :
                                    `（${record.recurringMonths?.map((m) => `${m}月`).join("、")}）`}
                                  自动计入
                                </div>
                              )}
                              {record.items.map((item) => (
                                <div key={item.id} className="flex items-center gap-4 rounded-lg border bg-card px-4 py-2 text-sm">
                                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">{item.category}</Badge>
                                  <span className="flex-1 text-muted-foreground">{item.description || "-"}</span>
                                  <span className="font-semibold text-emerald-600">{formatCurrency(item.amount)}</span>
                                </div>
                              ))}
                              <div className="flex justify-end border-t pt-2 text-sm">
                                <span className="mr-3 text-muted-foreground">合计</span>
                                <span className="font-bold text-emerald-600">{formatCurrency(record.totalAmount)}</span>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {filteredIncomeRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      {selectedMonth} 月暂无其他收入记录
                      {incomeRecords.some((r) => r.isRecurring) && (
                        <div className="text-xs mt-1">（已配置月度固定收入但未选中适用月份）</div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog with Dynamic Rows */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRecord ? "编辑成本记录" : "新增成本记录"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>销售单位 *</Label>
                <Select value={form.salesUnitId} onValueChange={(v) => setForm({ ...form, salesUnitId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择单位" /></SelectTrigger>
                  <SelectContent>
                    {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>记录日期</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>

            {/* 录入信息提示 */}
            {!editingRecord && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
                <Clock className="h-4 w-4" />
                系统将自动记录录入时间和录入人（{user?.name}）
              </div>
            )}

            {/* 薪酬自动计入提示 */}
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              <Calculator className="h-4 w-4" />
              在职人员薪酬、社保、公积金、请假扣款已自动按月度计入成本，此处仅需录入其他成本项（租金、营销、差旅等）
            </div>

            {/* Dynamic Cost Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">成本明细（动态行）</Label>
                <Button variant="outline" size="sm" onClick={addRow}>
                  <Plus className="mr-1 h-3 w-3" />添加行
                </Button>
              </div>

              <div className="space-y-2">
                {/* Header */}
                <div className="grid grid-cols-[1fr_120px_1fr_32px] gap-2 px-1 text-xs font-medium text-muted-foreground">
                  <span>成本类别</span>
                  <span className="text-right">金额 (¥)</span>
                  <span>说明</span>
                  <span></span>
                </div>
                {formItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_120px_1fr_32px] items-center gap-2 rounded-lg border p-2">
                    <Select value={item.category} onValueChange={(v) => updateRow(item.id, "category", v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {costCategories.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      value={item.amount}
                      onChange={(e) => updateRow(item.id, "amount", Number(e.target.value))}
                      placeholder="金额"
                      className="h-9 text-right"
                    />
                    <Input
                      value={item.description}
                      onChange={(e) => updateRow(item.id, "description", e.target.value)}
                      placeholder="说明"
                      className="h-9"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => removeRow(item.id)}
                      disabled={formItems.length <= 1}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="flex items-center justify-between rounded-lg bg-orange-50 px-4 py-3">
                <span className="text-sm font-medium text-orange-800">成本合计</span>
                <span className="text-xl font-bold text-orange-600">{formatCurrency(formTotalCost)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="备注信息" rows={2} />
            </div>

            {/* 变更原因（必填） */}
            <div className="space-y-2">
              <Label className="text-red-600">变更原因 * <span className="text-xs font-normal text-muted-foreground">（系统将记录此原因，超级管理员可查阅）</span></Label>
              <Textarea
                value={form.changeReason}
                onChange={(e) => setForm({ ...form, changeReason: e.target.value })}
                placeholder={editingRecord ? "请说明修改原因..." : "请说明本次成本录入原因..."}
                rows={2}
                className="border-red-200 focus:border-red-400"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingRecord ? "保存" : "新增"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== 收入录入弹窗 ===================== */}
      <Dialog open={incomeDialogOpen} onOpenChange={setIncomeDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              {editingIncome ? "编辑收入记录" : "新增收入记录"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>销售单位 *</Label>
                <Select value={incomeForm.salesUnitId} onValueChange={(v) => setIncomeForm({ ...incomeForm, salesUnitId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择单位" /></SelectTrigger>
                  <SelectContent>
                    {salesUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{incomeForm.isRecurring ? "生效起始日期" : "记录日期"}</Label>
                <Input type="date" value={incomeForm.date} onChange={(e) => setIncomeForm({ ...incomeForm, date: e.target.value })} />
              </div>
            </div>

            {/* 月度固定开关 */}
            <div className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-violet-600" />
                <div>
                  <Label className="text-sm font-medium text-violet-900 cursor-pointer">设为月度固定收入</Label>
                  <p className="text-xs text-violet-700 mt-0.5">开启后只需录入一次，系统会按月自动计入相应月份</p>
                </div>
              </div>
              <Switch
                checked={incomeForm.isRecurring}
                onCheckedChange={(checked) => setIncomeForm({ ...incomeForm, isRecurring: checked })}
              />
            </div>

            {/* 月度固定配置区 */}
            {incomeForm.isRecurring && (
              <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/30 p-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">适用月份 <span className="text-xs font-normal text-muted-foreground">（勾选需要生效的月份）</span></Label>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setIncomeForm({ ...incomeForm, recurringMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })}
                      >
                        全选
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setIncomeForm({ ...incomeForm, recurringMonths: [] })}
                      >
                        清空
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <label
                        key={m}
                        className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 cursor-pointer transition-colors ${
                          incomeForm.recurringMonths.includes(m)
                            ? "border-violet-400 bg-violet-100 text-violet-900"
                            : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        <Checkbox
                          checked={incomeForm.recurringMonths.includes(m)}
                          onCheckedChange={(checked) => {
                            const next = checked
                              ? [...incomeForm.recurringMonths, m].sort((a, b) => a - b)
                              : incomeForm.recurringMonths.filter((x) => x !== m);
                            setIncomeForm({ ...incomeForm, recurringMonths: next });
                          }}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs font-medium">{m}月</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">结束日期 <span className="text-xs font-normal text-muted-foreground">（可选，不填则永久生效）</span></Label>
                  <Input
                    type="date"
                    value={incomeForm.recurringEndDate}
                    onChange={(e) => setIncomeForm({ ...incomeForm, recurringEndDate: e.target.value })}
                    className="bg-white"
                    min={incomeForm.date}
                  />
                </div>
                <div className="flex items-start gap-1.5 rounded-md bg-violet-100/60 px-2.5 py-1.5 text-xs text-violet-800">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>已选 {incomeForm.recurringMonths.length} 个月份，将自动按月生成收入记录</span>
                </div>
              </div>
            )}

            {!editingIncome && !incomeForm.isRecurring && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <TrendingUp className="h-4 w-4" />
                录入除业绩收入以外的其他收入（服务费、咨询费、退款等），系统将自动记录录入人和时间
              </div>
            )}
            {editingIncome && !incomeForm.isRecurring && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <TrendingUp className="h-4 w-4" />
                单次收入记录，仅在录入日期所在月份生效
              </div>
            )}

            {/* Dynamic Income Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">收入明细（动态行）</Label>
                <Button variant="outline" size="sm" onClick={addIncomeRow} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                  <Plus className="mr-1 h-3 w-3" />添加行
                </Button>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_120px_1fr_32px] gap-2 px-1 text-xs font-medium text-muted-foreground">
                  <span>收入类别</span>
                  <span className="text-right">金额 (¥)</span>
                  <span>说明</span>
                  <span></span>
                </div>
                {incomeFormItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_120px_1fr_32px] items-center gap-2 rounded-lg border p-2">
                    <Select value={item.category} onValueChange={(v) => updateIncomeRow(item.id, "category", v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {incomeCategories.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      value={item.amount}
                      onChange={(e) => updateIncomeRow(item.id, "amount", Number(e.target.value))}
                      placeholder="金额"
                      className="h-9 text-right"
                    />
                    <Input
                      value={item.description}
                      onChange={(e) => updateIncomeRow(item.id, "description", e.target.value)}
                      placeholder="说明"
                      className="h-9"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => removeIncomeRow(item.id)}
                      disabled={incomeFormItems.length <= 1}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
                <span className="text-sm font-medium text-emerald-800">收入合计</span>
                <span className="text-xl font-bold text-emerald-600">{formatCurrency(incomeFormTotal)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea value={incomeForm.remark} onChange={(e) => setIncomeForm({ ...incomeForm, remark: e.target.value })} placeholder="备注信息" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncomeDialogOpen(false)}>取消</Button>
            <Button onClick={handleIncomeSubmit} className="bg-emerald-600 hover:bg-emerald-700">
              {editingIncome ? "保存" : "新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 收入删除确认 */}
      <AlertDialog open={!!incomeDeleteId} onOpenChange={(open) => { if (!open) setIncomeDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除收入记录</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const rec = incomeRecords.find((r) => r.id === incomeDeleteId);
                if (rec?.isRecurring) {
                  const count = rec.recurringMonths?.length || 0;
                  return (
                    <div className="space-y-1">
                      <p>这是一条<span className="font-semibold text-violet-700">月度固定收入</span>记录，删除后将停止所有月份的自动计入。</p>
                      <p className="text-xs">适用月份：{count === 12 ? "全年" : rec.recurringMonths?.map((m) => `${m}月`).join("、")}（共 {count} 个月）</p>
                      <p>此操作不可撤销。</p>
                    </div>
                  );
                }
                return "确定要删除该收入记录吗？此操作不可撤销。";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleIncomeDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===================== 月度人员调整弹窗 ===================== */}
      <Dialog open={adjustmentDialogOpen} onOpenChange={setAdjustmentDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              月度人员调整 - {selectedMonth}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <CalendarDays className="mr-1 inline h-4 w-4" />
              请假扣款 = 日薪 × 请假天数（日薪 = 底薪 / {MONTHLY_WORK_DAYS}）。其他加项/减项为额外薪资调整。
            </div>
            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>单位</TableHead>
                    <TableHead className="text-right">底薪</TableHead>
                    <TableHead className="text-right">日薪</TableHead>
                    <TableHead className="text-right">请假天数</TableHead>
                    <TableHead className="text-right">请假扣款</TableHead>
                    <TableHead className="text-right">其他加项</TableHead>
                    <TableHead className="text-right">其他减项</TableHead>
                    <TableHead>备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustmentPersonnel.map((p) => {
                    const data = adjForm[p.id] || { leaveDays: 0, otherBonus: 0, otherDeduction: 0, note: "" };
                    const dailyRate = p.salary.baseSalary / MONTHLY_WORK_DAYS;
                    const leaveDeduction = calcLeaveDeduction(p.salary.baseSalary, data.leaveDays);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell><Badge variant="outline">{getUnitName(p.salesUnitId)}</Badge></TableCell>
                        <TableCell className="text-right text-gray-600">{formatCurrency(p.salary.baseSalary)}</TableCell>
                        <TableCell className="text-right text-gray-500">{formatCurrency(dailyRate)}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.5"
                            value={data.leaveDays}
                            onChange={(e) => setAdjForm({
                              ...adjForm,
                              [p.id]: { ...data, leaveDays: Number(e.target.value) },
                            })}
                            className="h-8 w-20 text-right"
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell className="text-right text-red-600">-{formatCurrency(leaveDeduction)}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={data.otherBonus}
                            onChange={(e) => setAdjForm({
                              ...adjForm,
                              [p.id]: { ...data, otherBonus: Number(e.target.value) },
                            })}
                            className="h-8 w-24 text-right"
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={data.otherDeduction}
                            onChange={(e) => setAdjForm({
                              ...adjForm,
                              [p.id]: { ...data, otherDeduction: Number(e.target.value) },
                            })}
                            className="h-8 w-24 text-right"
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={data.note}
                            onChange={(e) => setAdjForm({
                              ...adjForm,
                              [p.id]: { ...data, note: e.target.value },
                            })}
                            className="h-8 w-32"
                            placeholder="备注"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {adjustmentPersonnel.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">暂无在职人员</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveAdjustments}>
              <Save className="mr-2 h-4 w-4" />保存调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog with Reason */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) { setDeleteId(null); setDeleteReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除该成本记录吗？此操作不可撤销，系统将记录此次删除操作。</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-red-600">删除原因 *</Label>
            <Textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="请说明删除原因..."
              rows={2}
              className="border-red-200 focus:border-red-400"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteReason.trim()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===================== 变更记录弹窗（仅超管） ===================== */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              成本变更记录
              <Badge variant="secondary">{costChangeLogs.length} 条</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
            {costChangeLogs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <History className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p>暂无变更记录</p>
              </div>
            ) : (
              costChangeLogs.map((log) => {
                const cfg = actionLabels[log.action] || { label: log.action, color: "bg-gray-100 text-gray-700" };
                return (
                  <div key={log.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={cfg.color}>{cfg.label}</Badge>
                      <span className="font-medium text-sm whitespace-pre-wrap break-words leading-relaxed flex-1 min-w-0">
                        {log.summary}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(log.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">操作人：</span>
                      <span className="font-medium">{log.operator}</span>
                      {log.costRecordRemark && (
                        <>
                          <span className="text-muted-foreground ml-3">记录备注：</span>
                          <span>{log.costRecordRemark}</span>
                        </>
                      )}
                    </div>
                    <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
                      <strong>变更原因：</strong>{log.reason}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
