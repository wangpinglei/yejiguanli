import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { personnelApi } from "@/lib/api";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { EMPTY_SALARY, calculateMonthlySalary, getFixedSalary, filterByMonth, MONTHLY_WORK_DAYS, isSalesBattlePosition, getPersonalSales, getInternalSalesRecipientId } from "@/lib/salary";
import type { Personnel, PersonnelUnitAssignment, SalaryStructure } from "@/types";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  CalendarRange,
  Percent,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Merge,
  ArrowRightLeft,
  RefreshCw,
  Stethoscope,
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
import MPersonProductCommission from "./Personnel/components/m-person-product-commission";

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
  const { addPersonnel, updatePersonnel, deletePersonnel, mergePersonnel, transferPersonnel, refreshAll, products, monthlyAdjustments, productPersonCommissions, teamMgmtCommissionRules, performanceTargets, unitProductSettlements } = useData();
  const teamMgmtContext = useMemo(() => ({
    rules: teamMgmtCommissionRules,
    targets: performanceTargets,
    upsList: unitProductSettlements,
  }), [teamMgmtCommissionRules, performanceTargets, unitProductSettlements]);
  const { visiblePersonnel: personnel, visibleSalesUnits: salesUnits, visibleSalesRecords: salesRecords, canEditPersonnel, isReadOnly, role, canEditCost } = usePermissions();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState(() => searchParams.get("unit") || "all");
  /** all | active | inactive — 在职/离职（与列表「在岗/离职」一致） */
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  /** all | missing — 缺产品提成配置筛选 */
  const [filterCommission, setFilterCommission] = useState<"all" | "missing">("all");
  /** none | desc | asc — 销售总额排序 */
  const [salesSortOrder, setSalesSortOrder] = useState<"none" | "desc" | "asc">("none");
  const [salesRange, setSalesRange] = useState<SalesRange>("year");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Personnel | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeKeepId, setMergeKeepId] = useState("");
  const [mergeRemoveId, setMergeRemoveId] = useState("");
  const [merging, setMerging] = useState(false);
  const [transferPerson, setTransferPerson] = useState<Personnel | null>(null);
  const [transferUnitId, setTransferUnitId] = useState("");
  const [transferDate, setTransferDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [transferRemark, setTransferRemark] = useState("");
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    const unit = searchParams.get("unit");
    if (!unit || salesUnits.length === 0) return;
    if (salesUnits.some((u) => u.id === unit)) {
      setFilterUnit(unit);
      setFilterStatus("all");
    }
  }, [searchParams, salesUnits]);
  const [editingAssignment, setEditingAssignment] = useState<PersonnelUnitAssignment | null>(null);
  const [editAssignmentUnitId, setEditAssignmentUnitId] = useState("");
  const [editAssignmentStart, setEditAssignmentStart] = useState("");
  const [editAssignmentEnd, setEditAssignmentEnd] = useState("");
  const [editAssignmentRemark, setEditAssignmentRemark] = useState("");
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [reconcilingUnits, setReconcilingUnits] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisName, setDiagnosisName] = useState("");
  const [diagnosisMonth, setDiagnosisMonth] = useState("2026-08");
  const [diagnosisOnlyIssues, setDiagnosisOnlyIssues] = useState(true);
  const [diagnosisResult, setDiagnosisResult] = useState<Awaited<
    ReturnType<typeof personnelApi.unitDiagnosis>
  > | null>(null);
  const [commissionPerson, setCommissionPerson] = useState<Personnel | null>(null);
  const [salaryDetailPerson, setSalaryDetailPerson] = useState<Personnel | null>(null);
  const [salaryDetailMonth, setSalaryDetailMonth] = useState(new Date().toISOString().slice(0, 7));

  const [form, setForm] = useState(DEFAULT_FORM);

  // 组织部只能编辑入离职日期
  const isOrgDept = role === "org_department";
  const isSuperadmin = role === "superadmin";
  const datesOnly = isOrgDept && !canEditPersonnel;

  /** 每人：已售产品数 / 已配提成数 / 缺少提成的产品数与名称 */
  const commissionStatusByPersonId = useMemo(() => {
    const map: Record<
      string,
      {
        soldCount: number
        configuredCount: number
        missingCount: number
        missingNames: string[]
        missingProductIds: string[]
      }
    > = {};

    const productNameById = new Map(products.map((p) => [p.id, p.name || '']));

    for (const person of personnel) {
      const soldIds = new Set<string>();
      for (const s of salesRecords) {
        const hitPerson =
          s.personnelId === person.id
          || (s.collaborators || []).some((c) => c.personnelId === person.id)
          || (!s.personnelId
            && (!s.collaborators || s.collaborators.length === 0)
            && (s.salesPersonName || '').trim() === person.name);
        if (!hitPerson) continue;
        if (s.productId) soldIds.add(s.productId);
      }
      // 已配置的产品也计入「相关产品」
      for (const ppc of productPersonCommissions) {
        if (ppc.personnelId === person.id) soldIds.add(ppc.productId);
      }

      const missingPairs: { id: string; name: string }[] = []
      let configuredCount = 0
      for (const productId of soldIds) {
        const hasPpc = productPersonCommissions.some(
          (x) =>
            x.personnelId === person.id &&
            x.productId === productId &&
            x.salesUnitId === person.salesUnitId,
        )
        if (hasPpc) {
          configuredCount += 1
        } else {
          missingPairs.push({
            id: productId,
            name: productNameById.get(productId) || productId,
          })
        }
      }
      missingPairs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      map[person.id] = {
        soldCount: soldIds.size,
        configuredCount,
        missingCount: missingPairs.length,
        missingNames: missingPairs.map((x) => x.name),
        missingProductIds: missingPairs.map((x) => x.id),
      }
    }
    return map;
  }, [personnel, salesRecords, productPersonCommissions, products]);

  const missingCommissionPersonCount = useMemo(() => {
    return personnel.filter((p) => (commissionStatusByPersonId[p.id]?.missingCount || 0) > 0).length
  }, [personnel, commissionStatusByPersonId])

  const missingCommissionProductCount = useMemo(() => {
    return personnel.reduce(
      (sum, p) => sum + (commissionStatusByPersonId[p.id]?.missingCount || 0),
      0,
    )
  }, [personnel, commissionStatusByPersonId])

  /** 同名（去空格）出现 2 次及以上 → 疑似重复人员 */
  const duplicateNameSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of personnel) {
      const key = (p.name || "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const dup = new Set<string>();
    for (const [name, n] of counts) {
      if (n >= 2) dup.add(name);
    }
    return dup;
  }, [personnel]);

  const duplicatePersonCount = useMemo(
    () => personnel.filter((p) => duplicateNameSet.has((p.name || "").trim())).length,
    [personnel, duplicateNameSet],
  );

  function isOnDutyPerson(person: { resignDate?: string; status?: string }) {
    const resign = (person.resignDate || '').slice(0, 10)
    if (resign) {
      const today = new Date().toISOString().slice(0, 10)
      return resign >= today
    }
    return person.status !== 'inactive'
  }

  const filteredPersonnel = useMemo(() => {
    return personnel.filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.position.toLowerCase().includes(search.toLowerCase());
      const matchUnit = filterUnit === "all" || p.salesUnitId === filterUnit;
      const onDuty = isOnDutyPerson(p);
      const matchStatus =
        filterStatus === "all"
        || (filterStatus === "active" && onDuty)
        || (filterStatus === "inactive" && !onDuty);
      const missing = commissionStatusByPersonId[p.id]?.missingCount || 0;
      const matchCommission = filterCommission === "all" || missing > 0;
      return matchSearch && matchUnit && matchStatus && matchCommission;
    });
  }, [personnel, search, filterUnit, filterStatus, filterCommission, commissionStatusByPersonId]);

  const getUnitName = (id: string) => salesUnits.find((u) => u.id === id)?.name || "-";

  // 销售总额时间范围
  const activeDateRange = useMemo(
    () => getDateRange(salesRange, customStart, customEnd),
    [salesRange, customStart, customEnd]
  );

  const salesTotalByPersonId = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {}
    for (const p of personnel) {
      map[p.id] = { count: 0, total: 0 }
    }
    for (const s of salesRecords) {
      const pid = s.personnelId
      if (!pid || !map[pid]) continue
      if (activeDateRange) {
        const d = (s.saleDate || '').slice(0, 10)
        if (d < activeDateRange.start || d > activeDateRange.end) continue
      }
      map[pid].count += 1
      map[pid].total += s.totalAmount || 0
    }
    return map
  }, [personnel, salesRecords, activeDateRange])

  function getPersonnelSales(personId: string) {
    return salesTotalByPersonId[personId] || { count: 0, total: 0 }
  }

  /** 按姓名分组的疑似重复名单（用于提示与合并预选） */
  const duplicateGroups = useMemo(() => {
    const map = new Map<string, Personnel[]>();
    for (const p of personnel) {
      const key = (p.name || "").trim();
      if (!key || !duplicateNameSet.has(key)) continue;
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    return Array.from(map.entries())
      .map(([name, people]) => ({
        name,
        people: [...people].sort((a, b) => {
          const salesDiff = getPersonnelSales(b.id).total - getPersonnelSales(a.id).total;
          if (salesDiff !== 0) return salesDiff;
          return (a.hireDate || "").localeCompare(b.hireDate || "");
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [personnel, duplicateNameSet, salesTotalByPersonId]);

  /** 合并下拉：同名重复的排前面，方便找到 */
  const mergeCandidatePersonnel = useMemo(() => {
    const dup = personnel.filter((p) => duplicateNameSet.has((p.name || "").trim()));
    const rest = personnel.filter((p) => !duplicateNameSet.has((p.name || "").trim()));
    const byName = (a: Personnel, b: Personnel) =>
      (a.name || "").localeCompare(b.name || "", "zh")
      || getUnitName(a.salesUnitId).localeCompare(getUnitName(b.salesUnitId), "zh");
    return [...dup.sort(byName), ...rest.sort(byName)];
  }, [personnel, duplicateNameSet, salesUnits]);

  function handleToggleSalesSort() {
    setSalesSortOrder((prev) => {
      if (prev === 'none') return 'desc'
      if (prev === 'desc') return 'asc'
      return 'none'
    })
  }

  const displayedPersonnel = useMemo(() => {
    const list = [...filteredPersonnel]
    if (salesSortOrder !== 'none') {
      const dir = salesSortOrder === 'desc' ? -1 : 1
      list.sort((a, b) => {
        const ta = getPersonnelSales(a.id).total
        const tb = getPersonnelSales(b.id).total
        if (ta === tb) return a.name.localeCompare(b.name, 'zh')
        return (ta - tb) * dir
      })
      return list
    }
    list.sort((a, b) => {
      const aOn = isOnDutyPerson(a)
      const bOn = isOnDutyPerson(b)
      if (aOn !== bOn) return aOn ? -1 : 1
      if (!aOn && !bOn) {
        const da = (a.resignDate || '').slice(0, 10)
        const db = (b.resignDate || '').slice(0, 10)
        if (da !== db) return db.localeCompare(da)
      }
      return a.name.localeCompare(b.name, 'zh')
    })
    return list
  }, [filteredPersonnel, salesSortOrder, salesTotalByPersonId])

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
      salary: { ...EMPTY_SALARY, ...person.salary },
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

  function getFormDutyStatus(resignDate: string): Personnel['status'] {
    const resign = resignDate.trim()
    if (!resign) return 'active'
    const today = new Date().toISOString().slice(0, 10)
    return resign < today ? 'inactive' : 'active'
  }

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.salesUnitId) return;
    const resignDate = form.resignDate.trim();
    const status = getFormDutyStatus(resignDate);
    // 显式传 null，服务端才能清空离职日（undefined 会被 JSON 省略并保留旧值）
    const data = { ...form, resignDate: resignDate ? resignDate : null, status } as typeof form & {
      resignDate: string | null;
    };
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

  function openMergeDialog(preferKeepId?: string, preferRemoveId?: string) {
    if (preferKeepId || preferRemoveId) {
      setMergeKeepId(preferKeepId || "");
      setMergeRemoveId(preferRemoveId || "");
      setMergeOpen(true);
      return;
    }
    // 从「去合并」进入：仅一对同名时自动预选（销售额高的保留）
    if (duplicateGroups.length === 1 && duplicateGroups[0].people.length === 2) {
      const [keep, remove] = duplicateGroups[0].people;
      setMergeKeepId(keep.id);
      setMergeRemoveId(remove.id);
    } else {
      setMergeKeepId("");
      setMergeRemoveId("");
    }
    setMergeOpen(true);
  }

  /** 选中某一组同名：默认销售额高的保留，另一条删除；多于 2 人只预填保留 */
  function selectDuplicateGroup(people: Personnel[]) {
    if (people.length < 2) return;
    setMergeKeepId(people[0].id);
    setMergeRemoveId(people.length === 2 ? people[1].id : "");
  }

  function openMergeForPerson(person: Personnel) {
    const name = (person.name || "").trim();
    const others = personnel.filter(
      (p) => p.id !== person.id && (p.name || "").trim() === name,
    );
    // 默认保留当前点的这条，另一条作被合并（若同名多人则留给用户再选）
    setMergeKeepId(person.id);
    setMergeRemoveId(others.length === 1 ? others[0].id : "");
    setMergeOpen(true);
  }

  function openTransfer(person: Personnel) {
    const fresh = personnel.find((p) => p.id === person.id) || person;
    setTransferPerson(fresh);
    setTransferUnitId("");
    setTransferDate(new Date().toISOString().slice(0, 10));
    setTransferRemark("");
  }

  const transferAssignmentRows = useMemo(() => {
    if (!transferPerson?.unitAssignments?.length) return [];
    return [...transferPerson.unitAssignments].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
  }, [transferPerson]);

  async function handleTransfer() {
    if (!transferPerson) return;
    if (!transferUnitId) {
      alert("请选择目标部门");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
      alert("请填写调动生效日");
      return;
    }
    if (transferUnitId === transferPerson.salesUnitId) {
      alert("目标部门与当前所属单位相同");
      return;
    }
    const fromName = getUnitName(transferPerson.salesUnitId);
    const toName = getUnitName(transferUnitId);
    if (
      !confirm(
        `确认将「${transferPerson.name}」于 ${transferDate} 从「${fromName}」转到「${toName}」？\n\n`
        + "调动日前的业绩与人力成本仍归原部门；从调动日起归新部门。",
      )
    ) {
      return;
    }
    setTransferring(true);
    try {
      const updated = await transferPersonnel(transferPerson.id, {
        salesUnitId: transferUnitId,
        effectiveDate: transferDate,
        remark: transferRemark.trim() || undefined,
      });
      setTransferPerson(updated);
      setTransferUnitId("");
      setTransferRemark("");
      setTransferDate(new Date().toISOString().slice(0, 10));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "转岗失败");
    } finally {
      setTransferring(false);
    }
  }

  async function handleReconcileUnitData() {
    if (
      !window.confirm(
        "将清洗调岗/归属时间轴：\n"
          + "· 删除与人事单位不一致的「至今」段\n"
          + "· 截断重叠时间段\n"
          + "· 补全与人事一致的当前归属段\n\n"
          + "不会修改销售记录。是否继续？",
      )
    ) {
      return;
    }
    setReconcilingUnits(true);
    try {
      const report = await personnelApi.reconcileUnitData();
      await refreshAll();
      alert(
        `${report.message}\n\n`
          + `重叠截断：${report.overlapFixed} 条\n`
          + `删除错误调岗段：${report.assignmentsDeleted} 条\n`
          + `补全/重建归属段：${report.assignmentFixed} 条`
          + (report.remainingIssues.length > 0
            ? `\n\n仍须人工检查：\n${report.remainingIssues.join('\n')}`
            : ''),
      );
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "清洗失败");
    } finally {
      setReconcilingUnits(false);
    }
  }

  function openEditAssignment(row: PersonnelUnitAssignment) {
    setEditingAssignment(row);
    setEditAssignmentUnitId(row.salesUnitId);
    setEditAssignmentStart(String(row.startDate || "").slice(0, 10));
    setEditAssignmentEnd(row.endDate ? String(row.endDate).slice(0, 10) : "");
    setEditAssignmentRemark(row.remark || "");
  }

  async function handleSaveAssignment() {
    if (!transferPerson || !editingAssignment) return;
    if (!editAssignmentUnitId) {
      alert("请选择归属单位");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editAssignmentStart)) {
      alert("请填写有效的开始日");
      return;
    }
    if (editAssignmentEnd && editAssignmentEnd <= editAssignmentStart) {
      alert("结束日须晚于开始日");
      return;
    }
    setSavingAssignment(true);
    try {
      const updated = await personnelApi.updateAssignment(
        transferPerson.id,
        editingAssignment.id,
        {
          salesUnitId: editAssignmentUnitId,
          startDate: editAssignmentStart,
          endDate: editAssignmentEnd || null,
          remark: editAssignmentRemark.trim() || undefined,
        },
      );
      setTransferPerson(updated);
      setEditingAssignment(null);
      await refreshAll();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingAssignment(false);
    }
  }

  async function handleDeleteAssignment(assignmentId: string) {
    if (!transferPerson) return;
    const row = transferPerson.unitAssignments?.find((a) => a.id === assignmentId);
    if (
      !window.confirm(
        `确认删除这条归属记录？\n${getUnitName(row?.salesUnitId || "")} · `
          + `${formatDate(row?.startDate || "")} → `
          + `${row?.endDate ? formatDate(row.endDate) : "至今"}`,
      )
    ) {
      return;
    }
    setTransferring(true);
    try {
      const updated = await personnelApi.deleteAssignment(
        transferPerson.id,
        assignmentId,
      );
      setTransferPerson(updated);
      await refreshAll();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "删除失败");
    } finally {
      setTransferring(false);
    }
  }

  async function loadUnitDiagnosis(
    name = diagnosisName,
    month = diagnosisMonth,
    onlyIssues = diagnosisOnlyIssues,
  ) {
    setDiagnosisLoading(true);
    try {
      const result = await personnelApi.unitDiagnosis({
        name: name.trim() || undefined,
        yearMonth: month,
        onlyIssues,
      });
      setDiagnosisResult(result);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "加载诊断失败");
    } finally {
      setDiagnosisLoading(false);
    }
  }

  function openUnitDiagnosis(name?: string) {
    const nextName = name ?? diagnosisName;
    if (name !== undefined) setDiagnosisName(name);
    setDiagnosisOpen(true);
    void loadUnitDiagnosis(nextName, diagnosisMonth, diagnosisOnlyIssues);
  }

  async function handleMerge() {
    if (!mergeKeepId || !mergeRemoveId) {
      alert("请选择保留人员与被合并人员");
      return;
    }
    if (mergeKeepId === mergeRemoveId) {
      alert("保留人员与被合并人员不能相同");
      return;
    }
    const keep = personnel.find((p) => p.id === mergeKeepId);
    const remove = personnel.find((p) => p.id === mergeRemoveId);
    if (!keep || !remove) return;
    if (
      !confirm(
        `确认将「${remove.name}」（${remove.position || "无职位"}）合并到「${keep.name}」（${keep.position || "无职位"}）？\n\n`
        + `会迁移销售/提成等到保留人，然后删除被合并人员。冲突项保留「${keep.name}」侧。此操作不可撤销。`,
      )
    ) {
      return;
    }
    setMerging(true);
    try {
      const result = await mergePersonnel(mergeKeepId, mergeRemoveId);
      const s = result.stats;
      alert(
        `${result.message}\n`
        + `销售 ${s.sales} 条；提成迁入 ${s.commissionsMoved}`
        + (s.commissionsDropped ? `（冲突丢弃 ${s.commissionsDropped}）` : "")
        + `；调整迁入 ${s.adjustmentsMoved}`
        + (s.adjustmentsDropped ? `（冲突丢弃 ${s.adjustmentsDropped}）` : "")
        + (s.hrRelinked ? "；人事档案已改挂保留人" : "")
        + (s.hrDropped ? "；重复人事档案已删" : "")
        + (s.fieldsFilled.length ? `；补全：${s.fieldsFilled.join("、")}` : ""),
      );
      setMergeOpen(false);
      setMergeKeepId("");
      setMergeRemoveId("");
    } catch (error: any) {
      alert("合并失败: " + (error.message || "未知错误"));
    } finally {
      setMerging(false);
    }
  }

  const showActions = canEditPersonnel || datesOnly;

  const mergeKeepPerson = personnel.find((p) => p.id === mergeKeepId) || null;
  const mergeRemovePerson = personnel.find((p) => p.id === mergeRemoveId) || null;

  // 薪资明细计算（按月度）
  const salaryDetail = useMemo(() => {
    if (!salaryDetailPerson) return null;
    const adj = monthlyAdjustments.find(
      (a) => a.personnelId === salaryDetailPerson.id && a.yearMonth === salaryDetailMonth
    );
    return calculateMonthlySalary(
      salaryDetailPerson,
      salesRecords,
      products,
      salaryDetailMonth,
      adj,
      productPersonCommissions,
      teamMgmtContext,
      undefined,
      { allPersonnel: personnel },
    );
  }, [salaryDetailPerson, salaryDetailMonth, salesRecords, products, monthlyAdjustments, productPersonCommissions, teamMgmtContext, personnel]);

  const internalSalesPartnerSources = useMemo(() => {
    if (!salaryDetailPerson) return [];
    return personnel.filter(
      (p) =>
        p.id !== salaryDetailPerson.id
        && getInternalSalesRecipientId(p, false) === salaryDetailPerson.id
        && (p.salary.internalSalesCommissionRate || 0) > 0,
    );
  }, [salaryDetailPerson, personnel]);

  // 月度销售额（含订单分业绩）
  const monthlyPersonnelSales = useMemo(() => {
    if (!salaryDetailPerson) return 0;
    return getPersonalSales(
      salaryDetailPerson.id,
      filterByMonth(salesRecords, salaryDetailMonth),
      salaryDetailPerson.name,
    );
  }, [salaryDetailPerson, salaryDetailMonth, salesRecords]);

  return (
    <div>
      <PageHeader
        title="人员管理"
        description="管理各销售单位人员信息、入离职时间、薪资结构与销售业绩"
        action={
          showActions && !isReadOnly && (
            <div className="flex flex-wrap gap-2">
              {isSuperadmin && (
                <>
                  <Button
                    variant="outline"
                    disabled={diagnosisLoading}
                    onClick={() => openUnitDiagnosis()}
                  >
                    <Stethoscope className={`mr-2 h-4 w-4 ${diagnosisLoading ? "animate-pulse" : ""}`} />
                    查看归属诊断
                  </Button>
                  <Button
                    variant="outline"
                    disabled={reconcilingUnits}
                    onClick={() => void handleReconcileUnitData()}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${reconcilingUnits ? "animate-spin" : ""}`} />
                    {reconcilingUnits ? "清洗中…" : "清洗调岗记录"}
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={() => openMergeDialog()}>
                <Merge className="mr-2 h-4 w-4" />
                合并人员
              </Button>
              <Button onClick={openAdd}>
                <Plus className="mr-2 h-4 w-4" />
                新增人员
              </Button>
            </div>
          )
        }
      />

      {duplicatePersonCount > 0 && canEditPersonnel && !isReadOnly && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            检测到 {duplicateNameSet.size} 个同名、共 {duplicatePersonCount} 条人员，可能是重复录入
            {duplicateGroups.length > 0 && (
              <>
                ：
                {duplicateGroups.map((g, idx) => (
                  <span key={g.name}>
                    {idx > 0 ? "；" : ""}
                    <button
                      type="button"
                      className="font-medium underline underline-offset-2 hover:text-amber-700"
                      onClick={() => {
                        selectDuplicateGroup(g.people);
                        setMergeOpen(true);
                      }}
                    >
                      {g.name}（{g.people.length} 条）
                    </button>
                  </span>
                ))}
              </>
            )}
            。
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-300 bg-white"
            onClick={() => openMergeDialog()}
          >
            <Merge className="mr-1 h-3.5 w-3.5" />
            去合并
          </Button>
        </div>
      )}

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
        <Select
          value={filterStatus}
          onValueChange={(v) => setFilterStatus(v as "all" | "active" | "inactive")}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="在职状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">在职</SelectItem>
            <SelectItem value="inactive">离职</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={filterCommission === "missing" ? "default" : "outline"}
          size="sm"
          className={
            filterCommission === "missing"
              ? "h-9 border-amber-500 bg-amber-500 hover:bg-amber-600"
              : "h-9 border-amber-400 text-amber-900 hover:bg-amber-50"
          }
          onClick={() =>
            setFilterCommission((prev) => (prev === "missing" ? "all" : "missing"))
          }
        >
          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
          {filterCommission === "missing"
            ? "显示全部人员"
            : `未配提成清单${missingCommissionPersonCount > 0 ? `（${missingCommissionPersonCount}人）` : ""}`}
        </Button>
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

      {filterCommission === "missing" ? (
        <Card className="mb-4 border-amber-300 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="font-medium">未配提成清单</span>
                <span className="text-sm text-amber-800/80">
                  {filteredPersonnel.length} 人 · {filteredPersonnel.reduce(
                    (n, p) => n + (commissionStatusByPersonId[p.id]?.missingCount || 0),
                    0,
                  )} 个产品待配
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setFilterCommission("all")}
              >
                返回全部人员
              </Button>
            </div>
            {filteredPersonnel.length === 0 ? (
              <div className="rounded-md border border-dashed border-amber-200 bg-white/70 px-3 py-6 text-center text-sm text-muted-foreground">
                当前单位/搜索条件下，没有未配提成的人
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPersonnel.map((person) => {
                  const st = commissionStatusByPersonId[person.id]
                  const names = st?.missingNames || []
                  return (
                    <div
                      key={person.id}
                      className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-white p-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-[140px] shrink-0">
                        <div className="font-medium text-foreground">{person.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {getUnitName(person.salesUnitId)} · {person.position || "-"}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        <span className="mr-1 self-center text-xs text-muted-foreground">未配产品：</span>
                        {names.map((name) => (
                          <Badge
                            key={`${person.id}-${name}`}
                            className="border border-red-200 bg-red-50 font-normal text-red-700 hover:bg-red-50"
                          >
                            {name}
                          </Badge>
                        ))}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 shrink-0 bg-amber-500 hover:bg-amber-600"
                        onClick={() => setCommissionPerson(person)}
                      >
                        <Percent className="mr-1 h-3.5 w-3.5" />
                        去配置
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {missingCommissionPersonCount > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                有 <strong>{missingCommissionPersonCount}</strong> 人、共{" "}
                <strong>{missingCommissionProductCount}</strong>{" "}
                个「人员×产品」未配个人提成
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-amber-400 text-amber-900 hover:bg-amber-100"
                onClick={() => setFilterCommission("missing")}
              >
                一键查看清单
              </Button>
            </div>
          )}
          <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-sm text-violet-900">
            <span className="font-medium">个人提成怎么配：</span>
            点「一键筛选未配提成」可直接看到每人缺哪些产品；再到「提成配置」按产品设置。
            团队管理提成请到成本管理。
          </div>
        </>
      )}

      {/* Table：清单模式下隐藏，避免和未配清单重复 */}
      {filterCommission !== "missing" && (
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
                    <button
                      type="button"
                      className="ml-auto flex flex-col items-end gap-0.5 rounded px-1 py-0.5 hover:bg-muted/80"
                      onClick={handleToggleSalesSort}
                      title="点击按销售总额排序"
                    >
                      <span className="inline-flex items-center gap-1 font-medium">
                        销售总额
                        {salesSortOrder === "desc" ? (
                          <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
                        ) : salesSortOrder === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </span>
                      <span className="text-[10px] font-normal text-blue-600">
                        {RANGE_LABELS[salesRange]}
                        {salesRange === "custom" && customStart && customEnd
                          ? `（${customStart} ~ ${customEnd}）`
                          : ""}
                        {salesSortOrder === "desc"
                          ? " · 高→低"
                          : salesSortOrder === "asc"
                            ? " · 低→高"
                            : ""}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>入职日期</TableHead>
                  <TableHead>离职日期</TableHead>
                  <TableHead className="min-w-[220px]">个人提成（未配产品）</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedPersonnel.map((person) => {
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
                          {duplicateNameSet.has((person.name || "").trim()) && (
                            <Badge
                              variant="outline"
                              className="border-amber-400 text-amber-800"
                            >
                              同名
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{getUnitName(person.salesUnitId)}</TableCell>
                      <TableCell>{person.position}</TableCell>
                      <TableCell className="text-right">{formatCurrency(person.salary.baseSalary)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(fixed)}</TableCell>
                      <TableCell className="text-right font-medium text-blue-600">{formatCurrency(sales.total)}</TableCell>
                      <TableCell>
                        <Badge variant={isOnDutyPerson(person) ? "default" : "secondary"}>
                          {isOnDutyPerson(person) ? "在岗" : "离职"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(person.hireDate)}</TableCell>
                      <TableCell className="text-muted-foreground">{person.resignDate ? formatDate(person.resignDate) : "-"}</TableCell>
                      <TableCell className="min-w-[220px]">
                        {(() => {
                          const st = commissionStatusByPersonId[person.id] || {
                            soldCount: 0,
                            configuredCount: 0,
                            missingCount: 0,
                            missingNames: [] as string[],
                            missingProductIds: [] as string[],
                          }
                          const needWarn = st.missingCount > 0
                          return (
                            <div className="flex flex-col items-start gap-1.5">
                              {needWarn ? (
                                <div className="flex max-w-[280px] flex-wrap gap-1">
                                  {st.missingNames.slice(0, 6).map((name) => (
                                    <Badge
                                      key={name}
                                      className="border border-red-200 bg-red-50 font-normal text-red-700 hover:bg-red-50"
                                    >
                                      {name}
                                    </Badge>
                                  ))}
                                  {st.missingNames.length > 6 ? (
                                    <Badge
                                      variant="secondary"
                                      className="font-normal"
                                    >
                                      +{st.missingNames.length - 6}
                                    </Badge>
                                  ) : null}
                                </div>
                              ) : st.soldCount > 0 ? (
                                <span className="text-xs text-emerald-700">
                                  已配齐 {st.configuredCount} 个产品
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {isSalesBattlePosition(person.position)
                                    ? "暂无关联产品"
                                    : "非销售岗"}
                                </span>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                className={
                                  needWarn
                                    ? "h-8 border-amber-400 text-amber-800 hover:bg-amber-50"
                                    : "h-8 border-violet-300 text-violet-700 hover:bg-violet-50"
                                }
                                onClick={() => setCommissionPerson(person)}
                              >
                                <Percent className="mr-1 h-3.5 w-3.5" />
                                {needWarn ? "去配置" : "提成配置"}
                              </Button>
                            </div>
                          )
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="薪资明细" onClick={() => setSalaryDetailPerson(person)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {showActions && !isReadOnly ? (
                            <>
                              {canEditPersonnel
                                && duplicateNameSet.has((person.name || "").trim()) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="合并同名人员"
                                  onClick={() => openMergeForPerson(person)}
                                >
                                  <Merge className="h-4 w-4 text-amber-700" />
                                </Button>
                              )}
                              {canEditPersonnel && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs"
                                  title="调岗"
                                  onClick={() => openTransfer(person)}
                                >
                                  调岗
                                </Button>
                              )}
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
                {displayedPersonnel.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      )}

      <MPersonProductCommission
        person={commissionPerson}
        open={!!commissionPerson}
        onOpenChange={(open) => {
          if (!open) setCommissionPerson(null);
        }}
        canEdit={showActions && !isReadOnly && (canEditPersonnel || canEditCost)}
      />

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
                    <div className="flex items-center gap-2">
                      <Input type="date" value={form.resignDate} onChange={(e) => setForm({ ...form, resignDate: e.target.value })} />
                      {form.resignDate ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm({ ...form, resignDate: '', status: 'active' })}
                        >
                          清除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select value={getFormDutyStatus(form.resignDate)} onValueChange={(v) => setForm({ ...form, status: v as Personnel["status"] })}>
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
                    {editingPerson ? (
                      <>
                        <Input
                          readOnly
                          value={getUnitName(form.salesUnitId)}
                        />
                        <p className="text-xs text-muted-foreground">
                          调整部门请用行内「调岗」，并填写调动生效日。
                        </p>
                      </>
                    ) : (
                      <Select value={form.salesUnitId} onValueChange={(v) => setForm({ ...form, salesUnitId: v })}>
                        <SelectTrigger><SelectValue placeholder="选择单位" /></SelectTrigger>
                        <SelectContent>
                          {salesUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>职位</Label>
                    <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="如：销售经理" />
                  </div>
                  <div className="space-y-2">
                    <Label>状态</Label>
                    <Select value={getFormDutyStatus(form.resignDate)} onValueChange={(v) => setForm({ ...form, status: v as Personnel["status"] })}>
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
                    <div className="flex items-center gap-2">
                      <Input type="date" value={form.resignDate} onChange={(e) => setForm({ ...form, resignDate: e.target.value })} />
                      {form.resignDate ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm({ ...form, resignDate: '', status: 'active' })}
                        >
                          清除
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">可点「清除」去掉离职日；离职日已过显示离职，未来日期仍为在岗</p>
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

                  {/* 提成默认（无产品级配置时使用） */}
                  <div className="space-y-2 rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-orange-100 text-orange-700">提成默认</Badge>
                      <span className="text-xs text-muted-foreground">产品级未配置时使用；内部销售不计业绩</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">个人/分销提成 (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={form.salary.personalCommissionRate}
                          onChange={(e) => updateSalary('personalCommissionRate', Number(e.target.value))}
                          placeholder="如：25"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">内部销售提成 (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={form.salary.internalSalesCommissionRate}
                          onChange={(e) =>
                            updateSalary('internalSalesCommissionRate', Number(e.target.value))
                          }
                          placeholder="如：5"
                        />
                      </div>
                    </div>
                    {(form.salary.internalSalesCommissionRate || 0) > 0 && (
                      <div className="space-y-1">
                        <Label className="text-xs">内部销售受益人</Label>
                        <Select
                          value={form.salary.internalSalesCommissionRecipientId || '__self__'}
                          onValueChange={(v) =>
                            updateSalary(
                              'internalSalesCommissionRecipientId',
                              v === '__self__' ? '' : v,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择受益人" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__self__">成交人本人</SelectItem>
                            {personnel
                              .filter(
                                (p) =>
                                  p.status === 'active'
                                  && p.salesUnitId === form.salesUnitId
                                  && p.id !== editingPerson?.id,
                              )
                              .map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                  {p.position ? `（${p.position}）` : ''}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">
                          仅显示本单位在职同事；固定搭档时选对应内部销售
                        </p>
                      </div>
                    )}
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
                {salaryDetail.internalSalesCommission > 0 && (
                  <div className="flex justify-between rounded-md border border-sky-200 bg-sky-50/30 px-3 py-2 col-span-2">
                    <div>
                      <span className="text-muted-foreground">内部销售提成</span>
                      {internalSalesPartnerSources.length > 0 && (
                        <p className="text-[10px] text-sky-700 mt-0.5">
                          含搭档：{internalSalesPartnerSources.map((p) => p.name).join('、')}
                        </p>
                      )}
                    </div>
                    <span className="font-medium text-sky-600">
                      {formatCurrency(salaryDetail.internalSalesCommission)}
                    </span>
                  </div>
                )}
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
                {(salaryDetailPerson.salary.internalSalesCommissionRate || 0) > 0 && (() => {
                  const recipientId = getInternalSalesRecipientId(salaryDetailPerson, false);
                  const recipientName =
                    recipientId === salaryDetailPerson.id
                      ? '成交人本人'
                      : (personnel.find((p) => p.id === recipientId)?.name || '指定销售');
                  return (
                    <p className="text-xs">
                      · 内部销售提成：
                      {salaryDetailPerson.salary.internalSalesCommissionCondition || '关联内部销售，不计业绩'}
                      （按 {salaryDetailPerson.salary.internalSalesCommissionRate}% 计算，不计入业额
                      {recipientId !== salaryDetailPerson.id ? `，发给 ${recipientName}` : ''}）
                    </p>
                  );
                })()}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSalaryDetailPerson(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 转岗 */}
      <Dialog
        open={!!transferPerson}
        onOpenChange={(open) => {
          if (!open) setTransferPerson(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              人员转岗
            </DialogTitle>
          </DialogHeader>
          {transferPerson && (
            <div className="space-y-4 py-1">
              <p className="text-sm text-muted-foreground">
                「{transferPerson.name}」当前：{getUnitName(transferPerson.salesUnitId)}。
                调动日前业绩与人力成本留在原部门，从调动日起归新部门。
                若成本仍出现在旧单位，请检查下方是否有多条「至今」记录，可编辑或删除多余段。
              </p>

              {transferAssignmentRows.length > 0 && (
                <div className="space-y-2">
                  <Label>归属 / 调岗记录</Label>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>归属单位</TableHead>
                          <TableHead>开始日</TableHead>
                          <TableHead>结束日</TableHead>
                          <TableHead>说明</TableHead>
                          <TableHead>操作人</TableHead>
                          <TableHead>记录时间</TableHead>
                          {isSuperadmin && <TableHead className="w-[120px]">操作</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transferAssignmentRows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{getUnitName(row.salesUnitId)}</TableCell>
                            <TableCell>{formatDate(row.startDate)}</TableCell>
                            <TableCell>
                              {row.endDate ? formatDate(row.endDate) : "至今"}
                            </TableCell>
                            <TableCell className="max-w-[120px] truncate">
                              {row.remark || "—"}
                            </TableCell>
                            <TableCell>{row.operator || "—"}</TableCell>
                            <TableCell className="text-muted-foreground text-xs">
                              {row.createdAt ? formatDateTime(row.createdAt) : "—"}
                            </TableCell>
                            {isSuperadmin && (
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2"
                                    disabled={transferring || savingAssignment}
                                    onClick={() => openEditAssignment(row)}
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-destructive hover:text-destructive"
                                    disabled={transferring || savingAssignment}
                                    onClick={() => {
                                      if (transferAssignmentRows.length <= 1) {
                                        alert(
                                          "至少保留一条归属记录。\n"
                                            + "若单位不对，请点「编辑」改归属单位，不必删除。",
                                        );
                                        return;
                                      }
                                      void handleDeleteAssignment(row.id);
                                    }}
                                  >
                                    删除
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    结束日为空表示当前仍在该单位。成本管理按此时间轴切分固定薪；
                    {isSuperadmin
                      ? " 单位填错可直接点「编辑」改归属单位，不必删记录。"
                      : ""}
                  </p>
                </div>
              )}

              <div className="space-y-2 border-t pt-4">
                <Label className="text-base font-medium">新建调动</Label>
              </div>
              <div className="space-y-2">
                <Label>目标部门 *</Label>
                <Select value={transferUnitId || undefined} onValueChange={setTransferUnitId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择目标部门" />
                  </SelectTrigger>
                  <SelectContent>
                    {salesUnits
                      .filter((u) => u.id !== transferPerson.salesUnitId)
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>调动生效日 *</Label>
                <Input
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>备注</Label>
                <Input
                  value={transferRemark}
                  onChange={(e) => setTransferRemark(e.target.value)}
                  placeholder="可选"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferPerson(null)} disabled={transferring}>
              取消
            </Button>
            <Button onClick={() => void handleTransfer()} disabled={transferring}>
              {transferring ? "提交中…" : "确认转岗"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 合并人员 */}
      <Dialog
        open={mergeOpen}
        onOpenChange={(open) => {
          setMergeOpen(open);
          if (!open) {
            setMergeKeepId("");
            setMergeRemoveId("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="h-5 w-5" />
              合并人员
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              将「被合并人员」的销售、提成、月度调整、业绩目标迁到「保留人员」，并删除被合并人员。
              同产品提成 / 同月调整冲突时保留「保留人员」侧；空白字段会用被合并人员补全。
            </p>

            {duplicateGroups.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                <p className="text-xs font-medium text-amber-950">
                  疑似重复名单（点一组即可填入下方）
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {duplicateGroups.map((g) => (
                    <button
                      key={g.name}
                      type="button"
                      className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-left text-sm hover:border-amber-400 hover:bg-amber-50"
                      onClick={() => selectDuplicateGroup(g.people)}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <Badge className="bg-amber-100 text-amber-800 text-xs">{g.name}</Badge>
                        <span className="text-xs text-muted-foreground">{g.people.length} 条</span>
                      </div>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {g.people.map((p, idx) => (
                          <li key={p.id}>
                            {idx === 0 ? "建议保留" : "可删除"}：
                            {getUnitName(p.salesUnitId)} · {p.position || "无职位"} · 入职{" "}
                            {formatDate(p.hireDate) || "—"} · 销售{" "}
                            {formatCurrency(getPersonnelSales(p.id).total)}
                          </li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>保留人员（合并后留下）</Label>
              <Select value={mergeKeepId || undefined} onValueChange={setMergeKeepId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择保留人员" />
                </SelectTrigger>
                <SelectContent>
                  {mergeCandidatePersonnel.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={p.id === mergeRemoveId}>
                      {p.name} · {getUnitName(p.salesUnitId)} · {p.position || "无职位"}
                      {duplicateNameSet.has((p.name || "").trim()) ? " · 同名" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mergeKeepPerson && (
                <p className="text-xs text-muted-foreground">
                  底薪 {formatCurrency(mergeKeepPerson.salary.baseSalary)} · 固定月薪{" "}
                  {formatCurrency(getFixedSalary(mergeKeepPerson.salary))} · 入职{" "}
                  {formatDate(mergeKeepPerson.hireDate) || "—"} · 销售{" "}
                  {formatCurrency(getPersonnelSales(mergeKeepPerson.id).total)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>被合并人员（合并后删除）</Label>
              <Select value={mergeRemoveId || undefined} onValueChange={setMergeRemoveId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择将被删除的人员" />
                </SelectTrigger>
                <SelectContent>
                  {mergeCandidatePersonnel.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={p.id === mergeKeepId}>
                      {p.name} · {getUnitName(p.salesUnitId)} · {p.position || "无职位"}
                      {duplicateNameSet.has((p.name || "").trim()) ? " · 同名" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mergeRemovePerson && (
                <p className="text-xs text-muted-foreground">
                  底薪 {formatCurrency(mergeRemovePerson.salary.baseSalary)} · 固定月薪{" "}
                  {formatCurrency(getFixedSalary(mergeRemovePerson.salary))} · 入职{" "}
                  {formatDate(mergeRemovePerson.hireDate) || "—"} · 销售{" "}
                  {formatCurrency(getPersonnelSales(mergeRemovePerson.id).total)}
                </p>
              )}
            </div>
            {mergeKeepPerson
              && mergeRemovePerson
              && (mergeKeepPerson.name || "").trim() !== (mergeRemovePerson.name || "").trim() && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                注意：两人姓名不同，请确认确为同一人后再合并。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={merging} onClick={() => setMergeOpen(false)}>
              取消
            </Button>
            <Button
              disabled={merging || !mergeKeepId || !mergeRemoveId}
              onClick={() => void handleMerge()}
            >
              {merging ? "合并中…" : "确认合并"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingAssignment}
        onOpenChange={(open) => {
          if (!open) setEditingAssignment(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              编辑归属记录
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-2">
              <Label>归属单位 *</Label>
              <Select
                value={editAssignmentUnitId || undefined}
                onValueChange={setEditAssignmentUnitId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择单位" />
                </SelectTrigger>
                <SelectContent>
                  {salesUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>开始日 *</Label>
              <Input
                type="date"
                value={editAssignmentStart}
                onChange={(e) => setEditAssignmentStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>结束日（留空表示至今）</Label>
              <Input
                type="date"
                value={editAssignmentEnd}
                onChange={(e) => setEditAssignmentEnd(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>说明</Label>
              <Input
                value={editAssignmentRemark}
                onChange={(e) => setEditAssignmentRemark(e.target.value)}
                placeholder="可选"
              />
            </div>
            {!editAssignmentEnd && (
              <p className="text-xs text-muted-foreground">
                当前段无结束日时，保存后会同步更新人员管理里的「所属单位」。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingAssignment}
              onClick={() => setEditingAssignment(null)}
            >
              取消
            </Button>
            <Button disabled={savingAssignment} onClick={() => void handleSaveAssignment()}>
              {savingAssignment ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={diagnosisOpen} onOpenChange={setDiagnosisOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>单位归属诊断</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            对照「人事所属单位」「归属时间轴」「当月成交挂账」，排查成本为何出现在某单位（如海南）。
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="diagnosisName">姓名（可选）</Label>
              <Input
                id="diagnosisName"
                placeholder="如：李燚、星雨"
                value={diagnosisName}
                onChange={(e) => setDiagnosisName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="diagnosisMonth">月份</Label>
              <Input
                id="diagnosisMonth"
                type="month"
                value={diagnosisMonth}
                onChange={(e) => setDiagnosisMonth(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={diagnosisOnlyIssues}
                onChange={(e) => setDiagnosisOnlyIssues(e.target.checked)}
              />
              仅显示有异常
            </label>
            <Button
              disabled={diagnosisLoading}
              onClick={() => void loadUnitDiagnosis()}
            >
              {diagnosisLoading ? "查询中…" : "查询"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {["李燚", "星雨", "卞星雨"].map((n) => (
              <Button
                key={n}
                variant="secondary"
                size="sm"
                onClick={() => openUnitDiagnosis(n)}
              >
                {n}
              </Button>
            ))}
          </div>
          {diagnosisResult && (
            <div className="space-y-4 pt-2">
              <p className="text-sm font-medium">
                {diagnosisResult.yearMonth} · 共 {diagnosisResult.items.length} 人
              </p>
              {diagnosisResult.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">未找到符合条件的人员。</p>
              ) : (
                diagnosisResult.items.map((item) => (
                  <Card key={item.personnelId}>
                    <CardContent className="space-y-3 pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{item.name}</span>
                        <Badge variant="outline">人事：{item.hrUnitName}</Badge>
                        {item.belongsUnitsInMonth.length > 0 && (
                          <Badge variant="secondary">
                            当月归属：{item.belongsUnitsInMonth.join("、")}
                          </Badge>
                        )}
                      </div>
                      {item.issues.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                          {item.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      )}
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">归属时间轴</p>
                        {item.assignments.length === 0 ? (
                          <p className="text-sm text-muted-foreground">无记录（按人事当前单位）</p>
                        ) : (
                          <ul className="space-y-1 text-sm">
                            {item.assignments.map((a, idx) => (
                              <li key={`${a.unitId}-${a.startDate}-${idx}`}>
                                {a.unitName} · {a.startDate}
                                {a.endDate ? ` → ${a.endDate}` : " → 至今"}
                                {a.isOpen ? "（当前段）" : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">当月成交挂账</p>
                        {item.salesSummaryInMonth.length === 0 ? (
                          <p className="text-sm text-muted-foreground">无成交</p>
                        ) : (
                          <ul className="space-y-1 text-sm">
                            {item.salesSummaryInMonth.map((s) => (
                              <li key={s.unitName}>
                                {s.unitName}：整单 {s.wholeOrder} 笔
                                {s.splitShare > 0 ? `，分业绩 ${s.splitShare} 笔` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
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
