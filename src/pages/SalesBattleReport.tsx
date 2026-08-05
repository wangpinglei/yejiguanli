import { useState, useMemo } from "react";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatPercent, getYearMonth, getCurrentYearMonth } from "@/lib/format";
import {
  calculateMonthlySalary,
  filterByMonth,
  getPersonalSales,
  isSalesBattlePosition,
  EMPTY_SALARY,
} from "@/lib/salary";
import type { Personnel } from "@/types";
import {
  CalendarDays,
  Building2,
  Target as TargetIcon,
  Edit3,
  Save,
  X,
  Wallet,
  TrendingUp,
  Users as UsersIcon,
  CheckCircle2,
  XCircle,
  Eye,
  Settings,
  Trash2,
  Tag,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
} from "@/components/ui/dialog";

export default function SalesBattleReport() {
  const { user } = useAuth();
  const {
    products,
    performanceTargets,
    upsertPerformanceTarget,
    batchUpsertPerformanceTargets,
    monthlyAdjustments,
    positionGroupLabels,
    addPositionGroupLabel,
    updatePositionGroupLabel,
    deletePositionGroupLabel,
    matchPositionLabel,
    productPersonCommissions,
  } = useData();
  const { visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords } = usePermissions();

  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [unitId, setUnitId] = useState<string>("");

  // 默认选中第一个单位
  useMemo(() => {
    if (!unitId && salesUnits.length > 0) {
      setUnitId(salesUnits[0].id);
    }
  }, [salesUnits, unitId]);

  // 该单位的所有人员（在职）
  const unitPersonnel = useMemo(() => {
    return personnel.filter((p) => p.salesUnitId === unitId && p.status === "active");
  }, [personnel, unitId]);

  // 战报仅展示销售相关岗位（排除组织部、售后等非销售岗）
  const battlePersonnel = useMemo(() => {
    return unitPersonnel.filter((p) => isSalesBattlePosition(p.position));
  }, [unitPersonnel]);

  // 当月销售记录
  const monthlyRecords = useMemo(() => {
    return filterByMonth(salesRecords, yearMonth);
  }, [salesRecords, yearMonth]);

  // 当月单位的所有销售记录（按销售单位汇总，个人业绩再按任命人员归集）
  const unitMonthlyRecords = useMemo(() => {
    return monthlyRecords.filter((r) => r.salesUnitId === unitId);
  }, [monthlyRecords, unitId]);

  // 团队总业绩
  const teamTotal = useMemo(() => {
    return unitMonthlyRecords.reduce((sum, r) => sum + r.totalAmount, 0);
  }, [unitMonthlyRecords]);

  // 单位整体目标（personnelId 为空的目标）
  const unitTarget = useMemo(() => {
    return performanceTargets.find(
      (t) => t.salesUnitId === unitId && t.yearMonth === yearMonth && !t.personnelId
    );
  }, [performanceTargets, unitId, yearMonth]);

  // 团队完成率（已使用 effectiveTeamCompletionRate，删除未使用变量）

  // 各人员目标（不含单位整体目标）
  const personnelTargets = useMemo(() => {
    const map = new Map<string, number>();
    performanceTargets.forEach((t) => {
      if (t.salesUnitId === unitId && t.yearMonth === yearMonth && t.personnelId) {
        map.set(t.personnelId, t.targetAmount);
      }
    });
    return map;
  }, [performanceTargets, unitId, yearMonth]);

  // 计算每个人员的战报行
  const battleRows = useMemo(() => {
    // 1. 系统内在职销售岗位；个人业绩 = 本单位当月销售记录按任命人员汇总
    const rows = battlePersonnel.map((p) => {
      const personalSales = getPersonalSales(p.id, unitMonthlyRecords, p.name);
      const targetAmount = personnelTargets.get(p.id);
      const hasTarget = targetAmount !== undefined;
      const diff = hasTarget ? personalSales - targetAmount : 0;
      const completionRate = hasTarget && targetAmount > 0
        ? (personalSales / targetAmount) * 100
        : 0;

      // 实时计算该人员薪资
      const adj = monthlyAdjustments.find(
        (a) => a.personnelId === p.id && a.yearMonth === yearMonth
      );
      const salary = calculateMonthlySalary(p, salesRecords, products, yearMonth, adj, productPersonCommissions);
      const totalCost =
        salary.total + (p.socialInsurance || 0) + (p.housingFund || 0);

      // 按岗位匹配特殊分组（如外援团）
      const positionMatch = matchPositionLabel(p.position || "");

      return {
        person: p,
        targetAmount: hasTarget ? targetAmount! : null,
        personalSales,
        diff,
        completionRate,
        salary,
        totalCost,
        positionMatch,
        isExternalPerson: false,
      };
    });

    // 2. 外部人员（生态圈同步/表格导入但未匹配到系统人员的）
    //    personnelId 为空但有 salesPersonName 的记录，按人员名聚合
    const externalRecords = unitMonthlyRecords.filter(
      (r) => !r.personnelId && r.salesPersonName && r.salesPersonName.trim()
    );
    const externalMap = new Map<string, number>();
    externalRecords.forEach((r) => {
      const name = r.salesPersonName!.trim();
      // 已能按姓名归到战报人员的，不重复算外部行
      if (battlePersonnel.some((p) => p.name === name)) return;
      externalMap.set(name, (externalMap.get(name) || 0) + r.totalAmount);
    });

    // 确保不与系统人员重名（重名的外部人员业绩已通过 personnelId / 姓名匹配到系统人员）
    const existingNames = new Set(unitPersonnel.map((p) => p.name));
    externalMap.forEach((sales, name) => {
      if (existingNames.has(name)) return; // 重名跳过
      // 构造伪 Personnel，position 设为"外援"以自动命中默认"外援团"规则
      const fakePerson: Personnel = {
        id: `ext_${name}`,
        name,
        salesUnitId: unitId,
        position: "外援",
        phone: "",
        email: "",
        salary: EMPTY_SALARY,
        socialInsurance: 0,
        housingFund: 0,
        hireDate: "",
        status: "active",
      };
      const positionMatch = matchPositionLabel("外援");
      rows.push({
        person: fakePerson,
        targetAmount: null,
        personalSales: sales,
        diff: 0,
        completionRate: 0,
        salary: {
          baseSalary: 0,
          performance: 0,
          positionAllowance: 0,
          managementCommission: 0,
          personalCommission: 0,
          productCommission: 0,
          leaveDeduction: 0,
          otherBonus: 0,
          otherDeduction: 0,
          total: 0,
        },
        totalCost: 0,
        positionMatch,
        isExternalPerson: true,
      });
    });

    return rows;
  }, [
    battlePersonnel, unitPersonnel, unitMonthlyRecords, personnelTargets,
    monthlyAdjustments, yearMonth, salesRecords, products, matchPositionLabel,
    unitId, productPersonCommissions,
  ]);

  // 团队合计（仅战报表内人员目标）
  const totalTarget = useMemo(() => {
    return battleRows.reduce((sum, row) => sum + (row.targetAmount || 0), 0);
  }, [battleRows]);

  const battlePersonalSalesTotal = useMemo(() => {
    return battleRows.reduce((sum, row) => sum + row.personalSales, 0);
  }, [battleRows]);

  // 状态编辑相关
  const [editingUnitTarget, setEditingUnitTarget] = useState(false);
  const [unitTargetDraft, setUnitTargetDraft] = useState(0);
  const [unitTargetNote, setUnitTargetNote] = useState("");

  const startEditUnitTarget = () => {
    setUnitTargetDraft(unitTarget?.targetAmount || 0);
    setUnitTargetNote(unitTarget?.note || "");
    setEditingUnitTarget(true);
  };

  const saveUnitTarget = async () => {
    if (!unitId) return;
    await upsertPerformanceTarget({
      salesUnitId: unitId,
      yearMonth,
      personnelId: undefined,
      targetAmount: unitTargetDraft,
      note: unitTargetNote,
      createdBy: user?.name,
    });
    setEditingUnitTarget(false);
  };

  // 人员目标行内编辑
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [personTargetDraft, setPersonTargetDraft] = useState(0);

  const startEditPersonTarget = (personId: string, current: number | undefined) => {
    setEditingPersonId(personId);
    setPersonTargetDraft(current || 0);
  };

  const savePersonTarget = async () => {
    if (!editingPersonId || !unitId) return;
    await upsertPerformanceTarget({
      salesUnitId: unitId,
      yearMonth,
      personnelId: editingPersonId,
      targetAmount: personTargetDraft,
      note: "",
      createdBy: user?.name,
    });
    setEditingPersonId(null);
  };

  const cancelPersonTarget = () => {
    setEditingPersonId(null);
    setPersonTargetDraft(0);
  };

  // 人员目标批量编辑
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchDraft, setBatchDraft] = useState<Record<string, number>>({});

  const openBatchEdit = () => {
    const draft: Record<string, number> = {};
    battlePersonnel.forEach((p) => {
      draft[p.id] = personnelTargets.get(p.id) || 0;
    });
    setBatchDraft(draft);
    setBatchOpen(true);
  };

  const saveBatchTargets = async () => {
    if (!unitId) return;
    const targets = battlePersonnel.map((p) => ({
      salesUnitId: unitId,
      yearMonth,
      personnelId: p.id,
      targetAmount: batchDraft[p.id] || 0,
      note: "",
      createdBy: user?.name,
    }));
    await batchUpsertPerformanceTargets(targets);
    setBatchOpen(false);
  };

  // 岗位分组配置弹窗
  const [labelConfigOpen, setLabelConfigOpen] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<{
    keyword: string;
    label: string;
    color: string;
    description: string;
  }>({ keyword: "", label: "", color: "gray", description: "" });

  const openEditLabel = (l: typeof positionGroupLabels[number]) => {
    setEditingLabelId(l.id);
    setLabelDraft({
      keyword: l.keyword,
      label: l.label,
      color: l.color || "gray",
      description: l.description || "",
    });
  };

  const saveLabelDraft = async () => {
    if (!labelDraft.keyword.trim() || !labelDraft.label.trim()) return;
    if (editingLabelId) {
      await updatePositionGroupLabel(editingLabelId, {
        keyword: labelDraft.keyword.trim(),
        label: labelDraft.label.trim(),
        color: labelDraft.color,
        description: labelDraft.description.trim(),
      });
    } else {
      await addPositionGroupLabel({
        keyword: labelDraft.keyword.trim(),
        label: labelDraft.label.trim(),
        color: labelDraft.color,
        description: labelDraft.description.trim(),
      });
    }
    setEditingLabelId(null);
    setLabelDraft({ keyword: "", label: "", color: "gray", description: "" });
  };

  const removeLabel = async (id: string) => {
    await deletePositionGroupLabel(id);
    if (editingLabelId === id) {
      setEditingLabelId(null);
      setLabelDraft({ keyword: "", label: "", color: "gray", description: "" });
    }
  };

  // 列出当前单位中所有命中的岗位，供配置参考
  const unitPositions = useMemo(() => {
    const set = new Set<string>();
    unitPersonnel.forEach((p) => {
      if (p.position) set.add(p.position);
    });
    return Array.from(set);
  }, [unitPersonnel]);

  // 薪资明细弹窗
  const [salaryDetailPerson, setSalaryDetailPerson] = useState<Personnel | null>(null);

  // 人力成本合计
  const totalSalaryCost = useMemo(() => {
    return battleRows.reduce((sum, r) => sum + r.totalCost, 0);
  }, [battleRows]);

  // 团队目标（人员目标合计 + 单位整体目标）取最大
  const effectiveTeamTarget = totalTarget > 0 ? totalTarget : (unitTarget?.targetAmount || 0);

  // 单位目标与人员目标合计的差额（正=单位目标>人员合计，负=人员合计>单位目标）
  const targetGap = useMemo(() => {
    const ut = unitTarget?.targetAmount || 0;
    return ut - totalTarget;
  }, [unitTarget, totalTarget]);

  // 团队完成率（取有效目标）
  const effectiveTeamCompletionRate = useMemo(() => {
    if (effectiveTeamTarget <= 0) return 0;
    return (teamTotal / effectiveTeamTarget) * 100;
  }, [teamTotal, effectiveTeamTarget]);

  // 团队差额
  const teamDiff = effectiveTeamTarget > 0 ? teamTotal - effectiveTeamTarget : 0;

  // 生成可选月份（最近12个月）
  const monthOptions = useMemo(() => {
    const options: string[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = getYearMonth(d.toISOString());
      options.push(ym);
    }
    return options;
  }, []);

  if (salesUnits.length === 0) {
    return (
      <div>
        <PageHeader
          title="销售单位战报"
          description="按月份和单位实时跟踪业绩目标完成情况"
        />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Building2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
            暂无销售单位数据，请先在「销售单位管理」中创建单位
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentUnit = salesUnits.find((u) => u.id === unitId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="销售单位战报"
        description="按月份和单位实时跟踪业绩目标完成情况，关联后台绩效条件显示实时薪资和单位成本"
      />

      {/* 筛选区 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2 min-w-[180px]">
              <Label className="flex items-center gap-1 text-sm">
                <CalendarDays className="h-3.5 w-3.5" />
                统计月份
              </Label>
              <Select value={yearMonth} onValueChange={setYearMonth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m.split("-")[0]}年{m.split("-")[1]}月
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 min-w-[220px]">
              <Label className="flex items-center gap-1 text-sm">
                <Building2 className="h-3.5 w-3.5" />
                销售单位
              </Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger><SelectValue placeholder="选择单位" /></SelectTrigger>
                <SelectContent>
                  {salesUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1" />

            <Button variant="outline" onClick={() => setLabelConfigOpen(true)}>
              <Settings className="mr-2 h-4 w-4" />
              岗位分组配置
              {positionGroupLabels.length > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 min-w-[20px] rounded-full px-1.5 text-[10px]">
                  {positionGroupLabels.length}
                </Badge>
              )}
            </Button>

            <Button variant="outline" onClick={openBatchEdit}>
              <Edit3 className="mr-2 h-4 w-4" />
              人员目标批量录入
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 战报顶部统计卡片 */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-blue-200 bg-blue-50/30">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">团队总业绩</p>
                <p className="text-2xl font-bold text-blue-700">{formatCurrency(teamTotal)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">团队目标</p>
                <p className="text-2xl font-bold text-emerald-700">{formatCurrency(effectiveTeamTarget)}</p>
              </div>
              <TargetIcon className="h-8 w-8 text-emerald-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className={`border-2 ${teamDiff < 0 ? "border-red-200 bg-red-50/30" : "border-violet-200 bg-violet-50/30"}`}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">团队差额</p>
                <p className={`text-2xl font-bold ${teamDiff < 0 ? "text-red-600" : "text-violet-700"}`}>
                  {teamDiff < 0 ? "-" : "+"}{formatCurrency(Math.abs(teamDiff))}
                </p>
              </div>
              {teamDiff < 0 ? (
                <XCircle className="h-8 w-8 text-red-500 opacity-50" />
              ) : (
                <CheckCircle2 className="h-8 w-8 text-violet-500 opacity-50" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={`border-2 ${effectiveTeamCompletionRate >= 100 ? "border-emerald-300 bg-emerald-50" : "border-orange-200 bg-orange-50/30"}`}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">团队总完成率</p>
                <p className={`text-2xl font-bold ${effectiveTeamCompletionRate >= 100 ? "text-emerald-700" : "text-orange-600"}`}>
                  {formatPercent(effectiveTeamCompletionRate)}
                </p>
              </div>
              <UsersIcon className={`h-8 w-8 opacity-50 ${effectiveTeamCompletionRate >= 100 ? "text-emerald-500" : "text-orange-500"}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 单位目标录入卡片 */}
      <Card className="border-violet-200 bg-violet-50/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TargetIcon className="h-4 w-4 text-violet-600" />
            单位整体业绩目标
            <Badge variant="secondary" className="ml-2">当月</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editingUnitTarget ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label>目标金额 (¥)</Label>
                <Input
                  type="number"
                  value={unitTargetDraft}
                  onChange={(e) => setUnitTargetDraft(Number(e.target.value))}
                  className="w-48"
                />
              </div>
              <div className="space-y-2 flex-1 min-w-[200px]">
                <Label>备注</Label>
                <Input
                  value={unitTargetNote}
                  onChange={(e) => setUnitTargetNote(e.target.value)}
                  placeholder="如：含外援团 / 月度KPI"
                />
              </div>
              <Button onClick={saveUnitTarget}>
                <Save className="mr-2 h-4 w-4" />保存
              </Button>
              <Button variant="outline" onClick={() => setEditingUnitTarget(false)}>
                <X className="mr-2 h-4 w-4" />取消
              </Button>
            </div>
          ) : unitTarget ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">目标金额</p>
                    <p className="text-2xl font-bold text-violet-700">{formatCurrency(unitTarget.targetAmount)}</p>
                  </div>
                  {unitTarget.note && (
                    <div>
                      <p className="text-xs text-muted-foreground">备注</p>
                      <p className="text-sm">{unitTarget.note}</p>
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={startEditUnitTarget}>
                  <Edit3 className="mr-2 h-4 w-4" />编辑
                </Button>
              </div>
              {/* 人员目标汇总对比 */}
              {totalTarget > 0 || unitTarget.targetAmount > 0 ? (
                <div className={`rounded-lg border p-3 ${Math.abs(targetGap) > 0 ? "border-amber-300 bg-amber-50/50" : "border-emerald-200 bg-emerald-50/30"}`}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">单位目标</span>
                        <span className="font-semibold text-violet-700">{formatCurrency(unitTarget.targetAmount)}</span>
                      </div>
                      <span className="text-muted-foreground">vs</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">人员目标合计</span>
                        <span className="font-semibold text-blue-700">{formatCurrency(totalTarget)}</span>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 font-bold ${targetGap > 0 ? "text-amber-600" : targetGap < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {targetGap > 0 ? (
                        <>
                          <span>未分配</span>
                          <span>+{formatCurrency(targetGap)}</span>
                        </>
                      ) : targetGap < 0 ? (
                        <>
                          <span>超额分配</span>
                          <span>{formatCurrency(targetGap)}</span>
                        </>
                      ) : (
                        <span>完全匹配</span>
                      )}
                    </div>
                  </div>
                  {Math.abs(targetGap) > 0 && targetGap > 0 && (
                    <p className="mt-1.5 text-xs text-amber-600/70">
                      提示：单位目标比人员目标总和多 {formatCurrency(targetGap)}，可继续为其他人员设定个人目标或调整单位目标
                    </p>
                  )}
                  {targetGap < 0 && (
                    <p className="mt-1.5 text-xs text-red-500/70">
                      提示：人员目标合计超出单位目标 {formatCurrency(Math.abs(targetGap))}，请确认是否需要调高单位目标或降低部分人员目标
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                尚未录入单位整体目标。可在右侧批量录入人员目标，或录入整体目标。
              </p>
              <Button variant="outline" size="sm" onClick={startEditUnitTarget}>
                <Edit3 className="mr-2 h-4 w-4" />录入目标
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 战报表格 */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          仅展示销售相关岗位（岗位名含「销售 / 顾问 / 客户经理 / 外援」等）；
          组织部、售后等非销售岗不显示。个人业绩按本单位销售记录归集。
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-pink-100 hover:bg-pink-100">
                <TableHead className="text-center font-bold text-pink-900 border-r border-pink-200">姓名</TableHead>
                <TableHead className="text-center font-bold text-pink-900 border-r border-pink-200">业绩目标</TableHead>
                <TableHead className="text-center font-bold text-pink-900 border-r border-pink-200">个人业绩合计</TableHead>
                <TableHead className="text-center font-bold text-pink-900 border-r border-pink-200">业绩差额</TableHead>
                <TableHead className="text-center font-bold text-pink-900 border-r border-pink-200">个人完成率</TableHead>
                <TableHead className="text-center font-bold text-pink-900">实时薪资</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {battleRows.map((row) => {
                const { person, targetAmount, personalSales, diff, completionRate, totalCost, positionMatch, isExternalPerson } = row;
                const isSpecialGroup = !!positionMatch; // 命中岗位分组规则
                // 标签颜色映射
                const colorClass = positionMatch
                  ? ({
                      gray: "bg-gray-100 text-gray-700 border-gray-300",
                      blue: "bg-blue-50 text-blue-700 border-blue-300",
                      violet: "bg-violet-50 text-violet-700 border-violet-300",
                      orange: "bg-orange-50 text-orange-700 border-orange-300",
                      red: "bg-red-50 text-red-700 border-red-300",
                      emerald: "bg-emerald-50 text-emerald-700 border-emerald-300",
                    } as Record<string, string>)[positionMatch.color || "gray"] || "bg-gray-100 text-gray-700 border-gray-300"
                  : "";
                return (
                  <TableRow key={person.id} className={isSpecialGroup ? "bg-gray-50" : ""}>
                    <TableCell className={`text-center font-medium border-r ${isSpecialGroup ? "text-gray-500 italic" : ""}`}>
                      <div className="flex items-center justify-center gap-1.5">
                        <span>{person.name}</span>
                        {positionMatch && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colorClass}`}>
                            {positionMatch.label}
                          </Badge>
                        )}
                      </div>
                      {person.position && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {person.position}
                          {isExternalPerson && <span className="ml-1 text-blue-500">（同步/导入）</span>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center border-r">
                      {editingPersonId === person.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <Input
                            type="number"
                            value={personTargetDraft}
                            onChange={(e) => setPersonTargetDraft(Number(e.target.value))}
                            className="w-28 h-7 text-sm text-center"
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={savePersonTarget}>
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelPersonTarget}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : targetAmount !== null ? (
                        <button
                          type="button"
                          onClick={() => startEditPersonTarget(person.id, targetAmount)}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted transition-colors ${targetAmount > 0 ? "font-medium" : "text-muted-foreground"}`}
                        >
                          {targetAmount > 0 ? formatCurrency(targetAmount) : "—"}
                          <Edit3 className="h-3 w-3 opacity-40 hover:opacity-100" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditPersonTarget(person.id, undefined)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          —
                          <Edit3 className="h-3 w-3 opacity-40 hover:opacity-100" />
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-center border-r font-medium">
                      {formatCurrency(personalSales)}
                    </TableCell>
                    <TableCell className={`text-center border-r font-semibold ${diff < 0 ? "text-red-600" : diff > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {targetAmount !== null ? (
                        diff < 0 ? `-${formatCurrency(Math.abs(diff))}` : formatCurrency(diff)
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-center border-r">
                      {targetAmount !== null && targetAmount > 0 ? (
                        <Badge className={completionRate >= 100 ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"} variant="secondary">
                          {formatPercent(completionRate)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {isExternalPerson ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSalaryDetailPerson(person)}
                          className="h-7 px-2"
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          {formatCurrency(totalCost)}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* 个人合计行 */}
              <TableRow className="bg-pink-50/40 font-bold border-t-2 border-pink-300">
                <TableCell className="text-center text-pink-900">合计</TableCell>
                <TableCell className="text-center text-pink-900">
                  {formatCurrency(totalTarget)}
                </TableCell>
                <TableCell className="text-center text-pink-900">
                  {formatCurrency(battlePersonalSalesTotal)}
                </TableCell>
                <TableCell className={`text-center ${teamDiff < 0 ? "text-red-600" : "text-pink-900"}`}>
                  {effectiveTeamTarget > 0 ? (
                    teamDiff < 0 ? `-${formatCurrency(Math.abs(teamDiff))}` : formatCurrency(teamDiff)
                  ) : "—"}
                </TableCell>
                <TableCell className="text-center text-pink-900">
                  {formatPercent(
                    totalTarget > 0 ? (teamTotal / totalTarget) * 100 : 0
                  )}
                </TableCell>
                <TableCell className="text-center text-pink-900">
                  {formatCurrency(totalSalaryCost)}
                </TableCell>
              </TableRow>

              {/* 团队汇总行 */}
              <TableRow className="bg-yellow-50 border-t border-yellow-200">
                <TableCell colSpan={6} className="py-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-center gap-8 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">团队总业绩</span>
                        <span className="text-lg font-bold text-blue-700">{formatCurrency(teamTotal)}</span>
                      </div>
                      <div className="h-6 w-px bg-yellow-300" />
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">团队目标</span>
                        <span className="text-lg font-bold text-emerald-700">{formatCurrency(effectiveTeamTarget)}</span>
                      </div>
                      <div className="h-6 w-px bg-yellow-300" />
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">团队差额</span>
                        <span className={`text-lg font-bold ${teamDiff < 0 ? "text-red-600" : "text-violet-700"}`}>
                          {teamDiff < 0 ? "-" : "+"}{formatCurrency(Math.abs(teamDiff))}
                        </span>
                      </div>
                      <div className="h-6 w-px bg-yellow-300" />
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">团队总完成率</span>
                        <span className={`text-lg font-bold ${effectiveTeamCompletionRate >= 100 ? "text-emerald-600" : "text-red-600"}`}>
                          {effectiveTeamTarget > 0 ? formatPercent(effectiveTeamCompletionRate) : "—"}
                        </span>
                      </div>
                    </div>
                    {/* 目标分配差额提示 */}
                    {unitTarget && Math.abs(targetGap) > 0 && (
                      <div className={`flex items-center justify-center gap-3 rounded-md border px-3 py-1.5 text-xs ${targetGap > 0 ? "border-amber-200 bg-amber-50/60 text-amber-700" : "border-red-200 bg-red-50/60 text-red-700"}`}>
                        <span>单位目标 {formatCurrency(unitTarget.targetAmount)}</span>
                        <span>vs</span>
                        <span>人员目标合计 {formatCurrency(totalTarget)}</span>
                        <span className="font-bold">
                          {targetGap > 0 ? `差额 +${formatCurrency(targetGap)}（未分配到个人）` : `差额 ${formatCurrency(targetGap)}（超出单位目标）`}
                        </span>
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>

              {battleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    该单位暂无在职人员
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* 单位总成本卡片 */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {currentUnit?.name} · {yearMonth.split("-")[0]}年{yearMonth.split("-")[1]}月 · 单位总人力成本
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  含薪资 + 社保（企业）+ 公积金（企业）+ 产品提成 - 请假扣款 + 其他调整
                </p>
              </div>
            </div>
            <p className="text-3xl font-bold text-primary">{formatCurrency(totalSalaryCost)}</p>
          </div>
        </CardContent>
      </Card>

      {/* 人员目标批量录入弹窗 */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              人员目标批量录入
            </DialogTitle>
            <DialogDescription>
              为 {currentUnit?.name} 在 {yearMonth.split("-")[0]}年{yearMonth.split("-")[1]}月
              录入销售岗位人员的业绩目标（非销售岗不在战报中显示，也不在此录入）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {battlePersonnel.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_180px] items-center gap-3 rounded-lg border p-3">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.position}</p>
                </div>
                <Input
                  type="number"
                  value={batchDraft[p.id] || 0}
                  onChange={(e) => setBatchDraft({ ...batchDraft, [p.id]: Number(e.target.value) })}
                  placeholder="目标金额"
                />
              </div>
            ))}
            {battlePersonnel.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">该单位暂无销售岗位在职人员</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button onClick={saveBatchTargets} disabled={battlePersonnel.length === 0}>
              <Save className="mr-2 h-4 w-4" />
              批量保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 实时薪资明细弹窗 */}
      <Dialog open={!!salaryDetailPerson} onOpenChange={(open) => !open && setSalaryDetailPerson(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>实时薪资明细 - {salaryDetailPerson?.name}</DialogTitle>
            <DialogDescription>
              {yearMonth.split("-")[0]}年{yearMonth.split("-")[1]}月 · 基于后台设置的绩效条件实时计算
            </DialogDescription>
          </DialogHeader>
          {salaryDetailPerson && (() => {
            const row = battleRows.find((r) => r.person.id === salaryDetailPerson.id);
            if (!row) return null;
            const { salary, person, totalCost } = row;
            return (
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">底薪</span>
                    <span className="font-medium">{formatCurrency(salary.baseSalary)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">绩效</span>
                    <span className="font-medium">{formatCurrency(salary.performance)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">岗位补贴</span>
                    <span className="font-medium">{formatCurrency(salary.positionAllowance)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border border-emerald-200 bg-emerald-50/30 px-3 py-2">
                    <span className="text-muted-foreground">管理提成</span>
                    <span className="font-medium text-emerald-600">{formatCurrency(salary.managementCommission)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border border-orange-200 bg-orange-50/30 px-3 py-2">
                    <span className="text-muted-foreground">个人提成</span>
                    <span className="font-medium text-orange-600">{formatCurrency(salary.personalCommission)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border border-violet-200 bg-violet-50/30 px-3 py-2">
                    <span className="text-muted-foreground">产品销售提成</span>
                    <span className="font-medium text-violet-600">{formatCurrency(salary.productCommission)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                    <span className="text-muted-foreground">请假扣款</span>
                    <span className="font-medium text-red-600">-{formatCurrency(salary.leaveDeduction)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">其他加项/减项</span>
                    <span className="font-medium">{formatCurrency(salary.otherBonus - salary.otherDeduction)}</span>
                  </div>
                </div>

                <div className="flex justify-between rounded-lg bg-blue-50 px-4 py-3">
                  <span className="font-semibold">实际月薪</span>
                  <span className="text-lg font-bold text-blue-600">{formatCurrency(salary.total)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                    <span className="text-muted-foreground">社保（企业）</span>
                    <span className="font-medium text-red-600">{formatCurrency(person.socialInsurance || 0)}</span>
                  </div>
                  <div className="flex justify-between rounded-md border border-cyan-200 bg-cyan-50/30 px-3 py-2">
                    <span className="text-muted-foreground">公积金（企业）</span>
                    <span className="font-medium text-cyan-600">{formatCurrency(person.housingFund || 0)}</span>
                  </div>
                </div>

                <div className="flex justify-between rounded-lg bg-primary/5 px-4 py-3">
                  <span className="font-semibold">单位人力成本</span>
                  <span className="text-lg font-bold text-primary">{formatCurrency(totalCost)}</span>
                </div>

                {/* 绩效条件 */}
                <div className="space-y-1.5 rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground">后台绩效条件：</p>
                  {person.salary.managementCommissionCondition && (
                    <p className="text-xs">· 管理提成：{person.salary.managementCommissionCondition}（团队超 ¥{person.salary.managementCommissionThreshold.toLocaleString()} 部分按 {person.salary.managementCommissionRate}%）</p>
                  )}
                  {person.salary.personalCommissionCondition && (
                    <p className="text-xs">· 个人提成：{person.salary.personalCommissionCondition}（个人超 ¥{person.salary.personalCommissionThreshold.toLocaleString()} 部分按 {person.salary.personalCommissionRate}%）</p>
                  )}
                  {person.salary.performanceCondition && (
                    <p className="text-xs">· 绩效：{person.salary.performanceCondition}</p>
                  )}
                  {person.salary.positionAllowanceCondition && (
                    <p className="text-xs">· 岗位补贴：{person.salary.positionAllowanceCondition}</p>
                  )}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSalaryDetailPerson(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 岗位分组配置弹窗 */}
      <Dialog open={labelConfigOpen} onOpenChange={(o) => { setLabelConfigOpen(o); if (!o) { setEditingLabelId(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              岗位分组配置
            </DialogTitle>
            <DialogDescription>
              按人员「岗位」字段匹配特殊分组。命中规则的人员在战报中会显示对应徽章，灰色斜体行展示。匹配规则：不区分大小写，岗位名包含「关键词」即生效。
            </DialogDescription>
          </DialogHeader>

          {/* 当前编辑表单 */}
          <div className="rounded-lg border-2 border-violet-200 bg-violet-50/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {editingLabelId ? "编辑规则" : "新增规则"}
              </p>
              {editingLabelId && (
                <Button variant="ghost" size="sm" onClick={() => { setEditingLabelId(null); setLabelDraft({ keyword: "", label: "", color: "gray", description: "" }); }}>
                  <X className="mr-1 h-3 w-3" />取消编辑
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">岗位关键词</Label>
                <Input
                  value={labelDraft.keyword}
                  onChange={(e) => setLabelDraft({ ...labelDraft, keyword: e.target.value })}
                  placeholder="如：外援 / 实习 / 兼职"
                />
                {unitPositions.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="text-[10px] text-muted-foreground">单位岗位参考：</span>
                    {unitPositions.map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setLabelDraft({ ...labelDraft, keyword: pos })}
                        className="rounded border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-violet-400 hover:text-violet-700"
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">显示标签</Label>
                <Input
                  value={labelDraft.label}
                  onChange={(e) => setLabelDraft({ ...labelDraft, label: e.target.value })}
                  placeholder="如：外援团 / 实习生"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">颜色</Label>
                <Select value={labelDraft.color} onValueChange={(v) => setLabelDraft({ ...labelDraft, color: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gray">灰色 (gray)</SelectItem>
                    <SelectItem value="blue">蓝色 (blue)</SelectItem>
                    <SelectItem value="violet">紫色 (violet)</SelectItem>
                    <SelectItem value="orange">橙色 (orange)</SelectItem>
                    <SelectItem value="red">红色 (red)</SelectItem>
                    <SelectItem value="emerald">绿色 (emerald)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">备注说明（可选）</Label>
                <Input
                  value={labelDraft.description}
                  onChange={(e) => setLabelDraft({ ...labelDraft, description: e.target.value })}
                  placeholder="如：外聘人员不参与个人目标考核"
                />
              </div>
            </div>
            {/* 预览 */}
            {labelDraft.label && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>预览：</span>
                <Badge variant="outline" className={({
                  gray: "bg-gray-100 text-gray-700 border-gray-300",
                  blue: "bg-blue-50 text-blue-700 border-blue-300",
                  violet: "bg-violet-50 text-violet-700 border-violet-300",
                  orange: "bg-orange-50 text-orange-700 border-orange-300",
                  red: "bg-red-50 text-red-700 border-red-300",
                  emerald: "bg-emerald-50 text-emerald-700 border-emerald-300",
                } as Record<string, string>)[labelDraft.color || "gray"] || "bg-gray-100 text-gray-700 border-gray-300"}>
                  {labelDraft.label}
                </Badge>
                {labelDraft.keyword && <span>· 匹配岗位包含「{labelDraft.keyword}」</span>}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={saveLabelDraft} disabled={!labelDraft.keyword.trim() || !labelDraft.label.trim()}>
                <Save className="mr-2 h-4 w-4" />
                {editingLabelId ? "保存修改" : "新增规则"}
              </Button>
            </div>
          </div>

          {/* 现有规则列表 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">现有规则（{positionGroupLabels.length}）</p>
            </div>
            {positionGroupLabels.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无规则，请在上方新增</p>
            ) : (
              <div className="space-y-2">
                {positionGroupLabels.map((rule) => {
                  const colorMap: Record<string, string> = {
                    gray: "bg-gray-100 text-gray-700 border-gray-300",
                    blue: "bg-blue-50 text-blue-700 border-blue-300",
                    violet: "bg-violet-50 text-violet-700 border-violet-300",
                    orange: "bg-orange-50 text-orange-700 border-orange-300",
                    red: "bg-red-50 text-red-700 border-red-300",
                    emerald: "bg-emerald-50 text-emerald-700 border-emerald-300",
                  };
                  const isEditing = editingLabelId === rule.id;
                  return (
                    <div
                      key={rule.id}
                      className={`rounded-lg border p-3 ${isEditing ? "border-violet-400 bg-violet-50/30" : "bg-card"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className={colorMap[rule.color || "gray"]}>
                            {rule.label}
                          </Badge>
                          <div className="text-sm">
                            <span className="text-muted-foreground">岗位包含：</span>
                            <span className="font-medium">{rule.keyword}</span>
                          </div>
                          {rule.description && (
                            <span className="text-xs text-muted-foreground">· {rule.description}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditLabel(rule)}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLabel(rule.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelConfigOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
