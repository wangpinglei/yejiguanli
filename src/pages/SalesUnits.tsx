import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, getYearMonth } from "@/lib/format";
import { getTotalSalaryCost, filterByMonth } from "@/lib/salary";
import { getEffectiveConfirmAmount, getEffectiveManualCost } from "@/lib/confirmAmount";
import { calcSaleSettlementIncome } from "@/lib/settlement";
import type { SalesUnit } from "@/types";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Building2,
  Users,
  Swords,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

function RoleNameInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`请输入${label}姓名`}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SalesUnits() {
  const navigate = useNavigate();
  const {
    addSalesUnit,
    updateSalesUnit,
    deleteSalesUnit,
    products,
    monthlyAdjustments,
    productPersonCommissions,
    teamMgmtCommissionRules,
    performanceTargets,
  } = useData();
  const { users } = useAuth();
  const {
    canEditUnit,
    visibleSalesUnits: salesUnits,
    visiblePersonnel: personnel,
    visibleSalesRecords: salesRecords,
    visibleCostRecords: costRecords,
    visibleIncomeRecords: incomeRecords,
    visibleUnitProductSettlements,
    visibleRevenueSettlements: revenueSettlements,
    visibleCostSettlements: costSettlements,
  } = usePermissions();
  const [search, setSearch] = useState("");
  /** none | desc | asc — 利润排序 */
  const [profitSortOrder, setProfitSortOrder] = useState<"none" | "desc" | "asc">("none");
  /** 与盈亏分析同口径：按月看净利润 */
  const [selectedMonth, setSelectedMonth] = useState(
    () => new Date().toISOString().slice(0, 7),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<SalesUnit | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    groupAdminName: "",
    militaryCadreName: "",
    orgDeptName: "",
    unitLeaderName: "",
  });

  // 按角色筛选用户
  const getUserName = (id?: string) => (id ? users.find((u) => u.id === id)?.name || users.find((u) => u.id === id)?.username || "-" : "-");
  const getManagerDisplay = (name?: string, id?: string) => {
    const n = (name || "").trim();
    if (n) return n;
    return getUserName(id);
  };

  // 录入人名后，若已有同名登录账号则自动关联用户ID（用于权限）
  function resolveUserIdByName(personName: string, preferredRole?: string): string | undefined {
    const key = personName.trim().toLowerCase();
    if (!key) return undefined;
    const matched = users.find((u) => {
      const uname = (u.username || "").trim().toLowerCase();
      const name = (u.name || "").trim().toLowerCase();
      return uname === key || name === key;
    });
    if (!matched) return undefined;
    if (preferredRole && matched.role !== preferredRole && matched.role !== "superadmin") {
      return matched.id;
    }
    return matched.id;
  }

  const filteredUnits = useMemo(() => {
    return salesUnits.filter((u) =>
      u.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [salesUnits, search]);

  const teamMgmtContext = useMemo(
    () => ({
      rules: teamMgmtCommissionRules,
      targets: performanceTargets,
      upsList: visibleUnitProductSettlements,
    }),
    [teamMgmtCommissionRules, performanceTargets, visibleUnitProductSettlements],
  )

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      options.push({ value, label: `${d.getFullYear()}年${d.getMonth() + 1}月` })
    }
    return options
  }, [])

  const unitStatsById = useMemo(() => {
    const map: Record<
      string,
      {
        personnelCount: number
        settlementIncome: number
        otherIncome: number
        manualCost: number
        salaryPayCost: number
        socialHousingFundCost: number
        salaryCost: number
        profit: number
      }
    > = {}
    const monthNum = parseInt(selectedMonth.slice(5, 7), 10)

    for (const u of salesUnits) {
      const unitPersonnel = personnel.filter((p) => p.salesUnitId === u.id)
      const estimatedSettlement = filterByMonth(salesRecords, selectedMonth)
        .filter((s) => s.salesUnitId === u.id)
        .reduce(
          (sum, s) => sum + calcSaleSettlementIncome(s, visibleUnitProductSettlements),
          0,
        )
      const settlementIncome = getEffectiveConfirmAmount(
        revenueSettlements,
        u.id,
        selectedMonth,
        estimatedSettlement,
      )
      const otherIncome = incomeRecords
        .filter((r) => {
          if (r.salesUnitId !== u.id) return false
          if (r.isRecurring) {
            const months = r.recurringMonths || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
            if (!months.includes(monthNum)) return false
            if (r.recurringStartDate && selectedMonth < r.recurringStartDate.slice(0, 7)) {
              return false
            }
            if (r.recurringEndDate && selectedMonth > r.recurringEndDate.slice(0, 7)) {
              return false
            }
            return true
          }
          return getYearMonth(r.date) === selectedMonth
        })
        .reduce((sum, r) => sum + (r.totalAmount || 0), 0)
      const manualCost = getEffectiveManualCost(
        costSettlements,
        costRecords,
        u.id,
        selectedMonth,
      )
      const salaryData = getTotalSalaryCost(
        [u.id],
        personnel,
        salesRecords,
        products,
        selectedMonth,
        monthlyAdjustments,
        productPersonCommissions,
        teamMgmtContext,
      )
      const salaryPayCost = salaryData.grandSalary
      const socialHousingFundCost = salaryData.grandSocialHousingFund
      const salaryCost = salaryData.grandTotal
      map[u.id] = {
        personnelCount: unitPersonnel.length,
        settlementIncome,
        otherIncome,
        manualCost,
        salaryPayCost,
        socialHousingFundCost,
        salaryCost,
        profit: settlementIncome + otherIncome - manualCost - salaryCost,
      }
    }
    return map
  }, [
    salesUnits,
    personnel,
    salesRecords,
    costRecords,
    incomeRecords,
    products,
    selectedMonth,
    monthlyAdjustments,
    productPersonCommissions,
    visibleUnitProductSettlements,
    teamMgmtContext,
    revenueSettlements,
    costSettlements,
  ])

  function getUnitStats(unitId: string) {
    return (
      unitStatsById[unitId] || {
        personnelCount: 0,
        settlementIncome: 0,
        otherIncome: 0,
        manualCost: 0,
        salaryPayCost: 0,
        socialHousingFundCost: 0,
        salaryCost: 0,
        profit: 0,
      }
    )
  }

  function handleToggleProfitSort() {
    setProfitSortOrder((prev) => {
      if (prev === 'none') return 'desc'
      if (prev === 'desc') return 'asc'
      return 'none'
    })
  }

  const displayedUnits = useMemo(() => {
    const list = [...filteredUnits]
    if (profitSortOrder === 'none') return list
    const dir = profitSortOrder === 'desc' ? -1 : 1
    list.sort((a, b) => {
      const pa = getUnitStats(a.id).profit
      const pb = getUnitStats(b.id).profit
      if (pa === pb) return a.name.localeCompare(b.name, 'zh')
      return (pa - pb) * dir
    })
    return list
  }, [filteredUnits, profitSortOrder, unitStatsById])

  const openAdd = () => {
    setEditingUnit(null);
    setForm({
      name: "",
      description: "",
      groupAdminName: "",
      militaryCadreName: "",
      orgDeptName: "",
      unitLeaderName: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (unit: SalesUnit) => {
    setEditingUnit(unit);
    setForm({
      name: unit.name,
      description: unit.description,
      groupAdminName: unit.groupAdminName || getUserName(unit.groupAdminId).replace(/^-$/, ""),
      militaryCadreName: unit.militaryCadreName || getUserName(unit.militaryCadreId).replace(/^-$/, ""),
      orgDeptName: unit.orgDeptName || getUserName(unit.orgDeptId).replace(/^-$/, ""),
      unitLeaderName: unit.unitLeaderName || getUserName(unit.unitLeaderId).replace(/^-$/, ""),
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    const groupAdminName = form.groupAdminName.trim();
    const militaryCadreName = form.militaryCadreName.trim();
    const orgDeptName = form.orgDeptName.trim();
    const unitLeaderName = form.unitLeaderName.trim();

    // 类型/联系人/电话/地址已从界面移除，提交时保留兼容后端的默认值
    const data = {
      name: form.name,
      type: (editingUnit?.type || "company") as SalesUnit["type"],
      address: editingUnit?.address || "",
      contact: editingUnit?.contact || "",
      contactPhone: editingUnit?.contactPhone || "",
      description: form.description,
      groupAdminName,
      militaryCadreName,
      orgDeptName,
      unitLeaderName,
      groupAdminId: resolveUserIdByName(groupAdminName, "group_admin"),
      militaryCadreId: resolveUserIdByName(militaryCadreName, "military_cadre"),
      orgDeptId: resolveUserIdByName(orgDeptName, "org_department"),
      unitLeaderId: resolveUserIdByName(unitLeaderName, "unit_leader"),
    };
    try {
      if (editingUnit) {
        await updateSalesUnit(editingUnit.id, data);
      } else {
        await addSalesUnit(data);
      }
      setDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteSalesUnit(deleteId);
        setDeleteId(null);
      } catch (error: any) {
        alert("删除失败: " + (error.message || "未知错误"));
      }
    }
  };

  return (
    <div>
      <PageHeader
        title="销售单位管理"
        description="管理各销售单位，录入管理人员人名；登录权限请在「权限分配」中开通"
        action={
          canEditUnit && (
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              新增单位
            </Button>
          )
        }
      />

      {/* Search + 月份 */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索单位名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40">
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
        </div>
        <Badge variant="secondary">共 {filteredUnits.length} 个单位</Badge>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        利润与「盈亏分析」同口径：结算收入 + 其他收入 −（录入成本 + 薪酬成本 + 社保公积金成本），按所选月份计算。
      </p>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单位名称</TableHead>
                  <TableHead>集团管理</TableHead>
                  <TableHead>军工干部</TableHead>
                  <TableHead>组织部</TableHead>
                  <TableHead>单位负责人</TableHead>
                  <TableHead className="text-right">人员数</TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-muted/80"
                      onClick={handleToggleProfitSort}
                      title="点击按本月利润排序（与盈亏分析同口径）"
                    >
                      本月利润
                      {profitSortOrder === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5 text-emerald-600" />
                      ) : profitSortOrder === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {profitSortOrder === "desc" ? (
                        <span className="text-[10px] font-normal text-emerald-600">高→低</span>
                      ) : profitSortOrder === "asc" ? (
                        <span className="text-[10px] font-normal text-emerald-600">低→高</span>
                      ) : null}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedUnits.map((unit) => {
                  const stats = getUnitStats(unit.id);
                  return (
                    <TableRow key={unit.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{unit.name}</p>
                            <p className="text-xs text-muted-foreground">{unit.description}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{getManagerDisplay(unit.groupAdminName, unit.groupAdminId)}</TableCell>
                      <TableCell className="text-sm">{getManagerDisplay(unit.militaryCadreName, unit.militaryCadreId)}</TableCell>
                      <TableCell className="text-sm">{getManagerDisplay(unit.orgDeptName, unit.orgDeptId)}</TableCell>
                      <TableCell className="text-sm">{getManagerDisplay(unit.unitLeaderName, unit.unitLeaderId)}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {stats.personnelCount}
                        </span>
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          stats.profit >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                        title={`结算 ${formatCurrency(stats.settlementIncome)} + 其他 ${formatCurrency(stats.otherIncome)} - 录入 ${formatCurrency(stats.manualCost)} - 薪酬 ${formatCurrency(stats.salaryPayCost)} - 社保公积金 ${formatCurrency(stats.socialHousingFundCost)}`}
                      >
                        {formatCurrency(stats.profit)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEditUnit ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="查看战报"
                              onClick={() => navigate(`/sales-battle-report?unit=${unit.id}`)}
                              className="text-violet-600 hover:text-violet-700"
                            >
                              <Swords className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(unit)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteId(unit.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="查看战报"
                            onClick={() => navigate(`/sales-battle-report?unit=${unit.id}`)}
                            className="text-violet-600 hover:text-violet-700"
                          >
                            <Swords className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {displayedUnits.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
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
            <DialogTitle>{editingUnit ? "编辑销售单位" : "新增销售单位"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>单位名称 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入单位名称"
              />
            </div>

            {/* 角色分配：录入人名 */}
            <div className="rounded-lg border p-4 space-y-4">
              <p className="text-sm font-semibold">管理人员（录入人名）</p>
              <p className="text-xs text-muted-foreground">
                在此填写各角色负责人姓名。登录账号与操作权限请到「权限分配」中开通。
              </p>
              <div className="grid grid-cols-2 gap-4">
                <RoleNameInput
                  label="集团管理"
                  value={form.groupAdminName}
                  onChange={(v) => setForm({ ...form, groupAdminName: v })}
                />
                <RoleNameInput
                  label="军工干部"
                  value={form.militaryCadreName}
                  onChange={(v) => setForm({ ...form, militaryCadreName: v })}
                />
                <RoleNameInput
                  label="组织部"
                  value={form.orgDeptName}
                  onChange={(v) => setForm({ ...form, orgDeptName: v })}
                />
                <RoleNameInput
                  label="单位负责人"
                  value={form.unitLeaderName}
                  onChange={(v) => setForm({ ...form, unitLeaderName: v })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>备注说明</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="单位描述或备注"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingUnit ? "保存" : "新增"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除该销售单位将同时删除其下所有人员数据，此操作不可撤销。
            </AlertDialogDescription>
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
