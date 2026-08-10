import { useState, useMemo } from "react";
import { useData } from "@/context/DataContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { EMPTY_SALARY, calculateMonthlySalary, getFixedSalary, filterByMonth, MONTHLY_WORK_DAYS, isSalesBattlePosition } from "@/lib/salary";
import type { Personnel, SalaryStructure } from "@/types";
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

// ????
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

// ????????
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
  all: "????",
  year: "???",
  quarter: "???",
  month: "??",
  custom: "???",
};

export default function PersonnelPage() {
  const { addPersonnel, updatePersonnel, deletePersonnel, enablePersonnelDistribution, products, monthlyAdjustments, productPersonCommissions, teamMgmtCommissionRules, performanceTargets, unitProductSettlements } = useData();
  const teamMgmtContext = useMemo(() => ({
    rules: teamMgmtCommissionRules,
    targets: performanceTargets,
    upsList: unitProductSettlements,
  }), [teamMgmtCommissionRules, performanceTargets, unitProductSettlements]);
  const { visiblePersonnel: personnel, visibleSalesUnits: salesUnits, visibleSalesRecords: salesRecords, canEditPersonnel, isReadOnly, role, canEditCost } = usePermissions();
  const [search, setSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState("all");
  /** all | missing ? ????????? */
  const [filterCommission, setFilterCommission] = useState<"all" | "missing">("all");
  /** none | desc | asc ? ?????? */
  const [salesSortOrder, setSalesSortOrder] = useState<"none" | "desc" | "asc">("none");
  const [salesRange, setSalesRange] = useState<SalesRange>("year");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Personnel | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [commissionPerson, setCommissionPerson] = useState<Personnel | null>(null);
  const [salaryDetailPerson, setSalaryDetailPerson] = useState<Personnel | null>(null);
  const [salaryDetailMonth, setSalaryDetailMonth] = useState(new Date().toISOString().slice(0, 7));
  const [distributionPerson, setDistributionPerson] = useState<Personnel | null>(null);
  const [distributionFrom, setDistributionFrom] = useState("");
  const [distributionResign, setDistributionResign] = useState("");
  const [distributionRate, setDistributionRate] = useState<number>(0);
  const [distributionSaving, setDistributionSaving] = useState(false);

  const [form, setForm] = useState(DEFAULT_FORM);

  // ????????????
  const isOrgDept = role === "org_department";
  const datesOnly = isOrgDept && !canEditPersonnel;

  /** ???????? / ????? / ??????????? */
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
          s.personnelId === person.id ||
          (!s.personnelId && (s.salesPersonName || '').trim() === person.name);
        if (!hitPerson) continue;
        if (s.productId) soldIds.add(s.productId);
      }
      // ???????????????
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

  const filteredPersonnel = useMemo(() => {
    return personnel.filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.position.toLowerCase().includes(search.toLowerCase());
      const matchUnit = filterUnit === "all" || p.salesUnitId === filterUnit;
      const missing = commissionStatusByPersonId[p.id]?.missingCount || 0;
      const matchCommission = filterCommission === "all" || missing > 0;
      return matchSearch && matchUnit && matchCommission;
    });
  }, [personnel, search, filterUnit, filterCommission, commissionStatusByPersonId]);

  const getUnitName = (id: string) => salesUnits.find((u) => u.id === id)?.name || "-";

  // ????????
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

  function handleToggleSalesSort() {
    setSalesSortOrder((prev) => {
      if (prev === 'none') return 'desc'
      if (prev === 'desc') return 'asc'
      return 'none'
    })
  }

  const displayedPersonnel = useMemo(() => {
    const list = [...filteredPersonnel]
    if (salesSortOrder === 'none') return list
    const dir = salesSortOrder === 'desc' ? -1 : 1
    list.sort((a, b) => {
      const ta = getPersonnelSales(a.id).total
      const tb = getPersonnelSales(b.id).total
      if (ta === tb) return a.name.localeCompare(b.name, 'zh')
      return (ta - tb) * dir
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
      salary: { ...person.salary },
      socialInsurance: person.socialInsurance || 0,
      housingFund: person.housingFund || 0,
      hireDate: person.hireDate,
      resignDate: person.resignDate || "",
      status: person.status,
    });
    setDialogOpen(true);
  };

  // ??????
  const updateSalary = (field: keyof SalaryStructure, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      salary: { ...prev.salary, [field]: value },
    }));
  };


  function isOnDutyPerson(person: { resignDate?: string; status?: string }) {
    const resign = (person.resignDate || '').slice(0, 10)
    if (resign) {
      const today = new Date().toISOString().slice(0, 10)
      return resign >= today
    }
    return person.status !== 'inactive'
  }

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
    // ??? null????????????undefined ?? JSON ????????
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
      alert("????: " + (error.message || "????"));
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deletePersonnel(deleteId);
        setDeleteId(null);
      } catch (error: any) {
        alert("????: " + (error.message || "????"));
      }
    }
  };

  function openDistribution(person: Personnel) {
    setDistributionPerson(person);
    const resign = (person.resignDate || "").slice(0, 10);
    let suggest = "";
    if (resign) {
      const [y, m] = resign.split("-").map(Number);
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      suggest = `${ny}-${String(nm).padStart(2, "0")}-01`;
    } else {
      const now = new Date();
      const nm = now.getMonth() + 2;
      const ny = nm > 12 ? now.getFullYear() + 1 : now.getFullYear();
      const month = nm > 12 ? nm - 12 : nm;
      suggest = `${ny}-${String(month).padStart(2, "0")}-01`;
    }
    setDistributionFrom(person.highCommissionFrom || suggest);
    setDistributionResign(resign);
    setDistributionRate(
      Number(person.salary?.personalCommissionRate) > 0
        ? Number(person.salary.personalCommissionRate)
        : 0,
    );
  }

  async function handleEnableDistribution() {
    if (!distributionPerson) return;
    const from = distributionFrom.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      alert("??????/???????-?-??");
      return;
    }
    if (
      !confirm(
        `???????\n??? ${from}??????????/??/??????????????\n????????????????? + ???????`,
      )
    ) {
      return;
    }
    setDistributionSaving(true);
    try {
      await enablePersonnelDistribution(distributionPerson.id, {
        highCommissionFrom: from,
        resignDate: distributionResign.trim() ? distributionResign.trim() : null,
        distributionPersonalRate: distributionRate > 0 ? distributionRate : null,
      });
      setDistributionPerson(null);
    } catch (error: any) {
      alert("??????: " + (error.message || "????"));
    } finally {
      setDistributionSaving(false);
    }
  }

  const showActions = canEditPersonnel || datesOnly;

  // ???????????
  const salaryDetail = useMemo(() => {
    if (!salaryDetailPerson) return null;
    const adj = monthlyAdjustments.find(
      (a) => a.personnelId === salaryDetailPerson.id && a.yearMonth === salaryDetailMonth
    );
    return calculateMonthlySalary(salaryDetailPerson, salesRecords, products, salaryDetailMonth, adj, productPersonCommissions, teamMgmtContext);
  }, [salaryDetailPerson, salaryDetailMonth, salesRecords, products, monthlyAdjustments, productPersonCommissions, teamMgmtContext]);

  // ?????
  const monthlyPersonnelSales = useMemo(() => {
    if (!salaryDetailPerson) return 0;
    return filterByMonth(salesRecords, salaryDetailMonth)
      .filter((s) => s.personnelId === salaryDetailPerson.id)
      .reduce((sum, s) => sum + s.totalAmount, 0);
  }, [salaryDetailPerson, salaryDetailMonth, salesRecords]);

  return (
    <div>
      <PageHeader
        title="????"
        description="???????????????????????????"
        action={
          showActions && !isReadOnly && (
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              ????
            </Button>
          )
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="???????..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterUnit} onValueChange={setFilterUnit}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="????" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">????</SelectItem>
            {salesUnits.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
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
            ? "??????"
            : `??????${missingCommissionPersonCount > 0 ? `?${missingCommissionPersonCount}??` : ""}`}
        </Button>
        <div className="flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <Select value={salesRange} onValueChange={(v) => setSalesRange(v as SalesRange)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="year">???</SelectItem>
              <SelectItem value="quarter">???</SelectItem>
              <SelectItem value="month">??</SelectItem>
              <SelectItem value="all">????</SelectItem>
              <SelectItem value="custom">???</SelectItem>
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
            <span className="text-muted-foreground text-sm">?</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-36 h-9"
            />
          </div>
        )}
        <Badge variant="secondary">? {filteredPersonnel.length} ?</Badge>
      </div>

      {filterCommission === "missing" ? (
        <Card className="mb-4 border-amber-300 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="font-medium">??????</span>
                <span className="text-sm text-amber-800/80">
                  {filteredPersonnel.length} ? ? {filteredPersonnel.reduce(
                    (n, p) => n + (commissionStatusByPersonId[p.id]?.missingCount || 0),
                    0,
                  )} ?????
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setFilterCommission("all")}
              >
                ??????
              </Button>
            </div>
            {filteredPersonnel.length === 0 ? (
              <div className="rounded-md border border-dashed border-amber-200 bg-white/70 px-3 py-6 text-center text-sm text-muted-foreground">
                ????/??????????????
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
                          {getUnitName(person.salesUnitId)} ? {person.position || "-"}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        <span className="mr-1 self-center text-xs text-muted-foreground">?????</span>
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
                        ???
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
                ? <strong>{missingCommissionPersonCount}</strong> ???{" "}
                <strong>{missingCommissionProductCount}</strong>{" "}
                ??????????????
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-amber-400 text-amber-900 hover:bg-amber-100"
                onClick={() => setFilterCommission("missing")}
              >
                ??????
              </Button>
            </div>
          )}
          <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-sm text-violet-900">
            <span className="font-medium">????????</span>
            ??????????????????????????????????????
            ?????????????
          </div>
        </>
      )}

      {/* Table?????????????????? */}
      {filterCommission !== "missing" && (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>??</TableHead>
                  <TableHead>????</TableHead>
                  <TableHead>??</TableHead>
                  <TableHead className="text-right">??</TableHead>
                  <TableHead className="text-right">????</TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="ml-auto flex flex-col items-end gap-0.5 rounded px-1 py-0.5 hover:bg-muted/80"
                      onClick={handleToggleSalesSort}
                      title="?????????"
                    >
                      <span className="inline-flex items-center gap-1 font-medium">
                        ????
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
                          ? `?${customStart} ~ ${customEnd}?`
                          : ""}
                        {salesSortOrder === "desc"
                          ? " ? ???"
                          : salesSortOrder === "asc"
                            ? " ? ???"
                            : ""}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead>??</TableHead>
                  <TableHead>????</TableHead>
                  <TableHead>????</TableHead>
                  <TableHead className="min-w-[220px]">??????????</TableHead>
                  <TableHead className="text-right">??</TableHead>
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
                        </div>
                      </TableCell>
                      <TableCell>{getUnitName(person.salesUnitId)}</TableCell>
                      <TableCell>{person.position}</TableCell>
                      <TableCell className="text-right">{formatCurrency(person.salary.baseSalary)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(fixed)}</TableCell>
                      <TableCell className="text-right font-medium text-blue-600">{formatCurrency(sales.total)}</TableCell>
                      <TableCell>
                        <Badge variant={isOnDutyPerson(person) ? "default" : "secondary"}>
                          {isOnDutyPerson(person) ? "??" : "??"}
                        </Badge>
                        {person.highCommissionFrom ? (
                          <Badge variant="outline" className="ml-1 border-orange-300 text-orange-700">
                            ?? {person.highCommissionFrom.slice(5)}
                          </Badge>
                        ) : null}
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
                                  ??? {st.configuredCount} ???
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {isSalesBattlePosition(person.position)
                                    ? "??????"
                                    : "????"}
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
                                {needWarn ? "???" : "????"}
                              </Button>
                            </div>
                          )
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="????" onClick={() => setSalaryDetailPerson(person)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {showActions && !isReadOnly ? (
                            <>
                              {canEditPersonnel && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-orange-700"
                                  title="???????"
                                  onClick={() => openDistribution(person)}
                                >
                                  ??
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
                      ????
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
              {editingPerson ? (datesOnly ? "???????" : "????") : "????"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* ???????????? */}
            {datesOnly ? (
              <>
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                  ????????????????????????
                </div>
                <div className="space-y-2">
                  <Label>??</Label>
                  <Input value={form.name} disabled />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>????</Label>
                    <Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>????</Label>
                    <div className="flex items-center gap-2">
                      <Input type="date" value={form.resignDate} onChange={(e) => setForm({ ...form, resignDate: e.target.value })} />
                      {form.resignDate ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm({ ...form, resignDate: '', status: 'active' })}
                        >
                          ??
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>??</Label>
                  <Select value={getFormDutyStatus(form.resignDate)} onValueChange={(v) => setForm({ ...form, status: v as Personnel["status"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">??</SelectItem>
                      <SelectItem value="inactive">??</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>?? *</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="??" />
                  </div>
                  <div className="space-y-2">
                    <Label>???? *</Label>
                    <Select value={form.salesUnitId} onValueChange={(v) => setForm({ ...form, salesUnitId: v })}>
                      <SelectTrigger><SelectValue placeholder="????" /></SelectTrigger>
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
                    <Label>??</Label>
                    <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="??????" />
                  </div>
                  <div className="space-y-2">
                    <Label>??</Label>
                    <Select value={getFormDutyStatus(form.resignDate)} onValueChange={(v) => setForm({ ...form, status: v as Personnel["status"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">??</SelectItem>
                        <SelectItem value="inactive">??</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>???</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="???" />
                  </div>
                  <div className="space-y-2">
                    <Label>??</Label>
                    <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="??" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>????</Label>
                    <Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>????</Label>
                    <div className="flex items-center gap-2">
                      <Input type="date" value={form.resignDate} onChange={(e) => setForm({ ...form, resignDate: e.target.value })} />
                      {form.resignDate ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm({ ...form, resignDate: '', status: 'active' })}
                        >
                          ??
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">??????????????????????????????</p>
                  </div>
                </div>

                {/* ???? */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">????</h4>
                    <Badge variant="secondary">
                      ?????{formatCurrency(getFixedSalary(form.salary))}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ?? = ?? + ?? + ???? + ???? + ??????????????????
                  </p>

                  {/* ?? */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">?? (?)</Label>
                      <Input type="number" value={form.salary.baseSalary} onChange={(e) => updateSalary("baseSalary", Number(e.target.value))} placeholder="0" />
                    </div>
                  </div>

                  {/* ?? */}
                  <div className="space-y-2 rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-700">??</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">???? (?)</Label>
                        <Input type="number" value={form.salary.performance} onChange={(e) => updateSalary("performance", Number(e.target.value))} placeholder="0" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">????</Label>
                        <Input value={form.salary.performanceCondition} onChange={(e) => updateSalary("performanceCondition", e.target.value)} placeholder="??????????80%????" />
                      </div>
                    </div>
                  </div>

                  {/* ???? */}
                  <div className="space-y-2 rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-purple-100 text-purple-700">????</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">???? (?)</Label>
                        <Input type="number" value={form.salary.positionAllowance} onChange={(e) => updateSalary("positionAllowance", Number(e.target.value))} placeholder="0" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">????</Label>
                        <Input value={form.salary.positionAllowanceCondition} onChange={(e) => updateSalary("positionAllowanceCondition", e.target.value)} placeholder="?????????????" />
                      </div>
                    </div>
                  </div>

                </div>

                {/* ????? */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">?????????????</h4>
                    <Badge variant="secondary">
                      ?????{formatCurrency((form.socialInsurance || 0) + (form.housingFund || 0))}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ??????????????????????
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 rounded-md bg-red-50/50 p-3">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-red-100 text-red-700">??</Badge>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">???? (?/?)</Label>
                        <Input type="number" value={form.socialInsurance} onChange={(e) => setForm({ ...form, socialInsurance: Number(e.target.value) })} placeholder="0" />
                        <p className="text-[10px] text-muted-foreground">??????????????????????</p>
                      </div>
                    </div>
                    <div className="space-y-2 rounded-md bg-cyan-50/50 p-3">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-cyan-100 text-cyan-700">???</Badge>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">????? (?/?)</Label>
                        <Input type="number" value={form.housingFund} onChange={(e) => setForm({ ...form, housingFund: Number(e.target.value) })} placeholder="0" />
                        <p className="text-[10px] text-muted-foreground">?????????????</p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>??</Button>
            <Button onClick={handleSubmit}>{editingPerson ? "??" : "??"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ?????? */}
      <Dialog open={!!salaryDetailPerson} onOpenChange={(open) => !open && setSalaryDetailPerson(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>???? - {salaryDetailPerson?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {salaryDetailPerson && salaryDetail && (
            <div className="space-y-3 py-2">
              {/* ????? */}
              <div className="flex items-center gap-2">
                <Label className="text-sm">??</Label>
                <Input
                  type="month"
                  value={salaryDetailMonth}
                  onChange={(e) => setSalaryDetailMonth(e.target.value)}
                  className="h-8 w-40"
                />
              </div>

              {/* ???? */}
              <div className="flex justify-between rounded-md border border-blue-200 bg-blue-50/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">?????</span>
                <span className="font-medium text-blue-600">{formatCurrency(monthlyPersonnelSales)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">??</span>
                  <span className="font-medium">{formatCurrency(salaryDetail.baseSalary)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">??</span>
                  <span className="font-medium">{formatCurrency(salaryDetail.performance)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">????</span>
                  <span className="font-medium">{formatCurrency(salaryDetail.positionAllowance)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">????</span>
                  <span className="font-medium text-emerald-600">{formatCurrency(salaryDetail.managementCommission)}</span>
                </div>
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">????</span>
                  <span className="font-medium text-orange-600">{formatCurrency(salaryDetail.personalCommission)}</span>
                </div>
                {salaryDetail.leaveDeduction > 0 && (
                  <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                    <span className="text-muted-foreground">????</span>
                    <span className="font-medium text-red-600">-{formatCurrency(salaryDetail.leaveDeduction)}</span>
                  </div>
                )}
                {salaryDetail.otherBonus > 0 && (
                  <div className="flex justify-between rounded-md border border-amber-200 bg-amber-50/30 px-3 py-2">
                    <span className="text-muted-foreground">????</span>
                    <span className="font-medium text-amber-600">+{formatCurrency(salaryDetail.otherBonus)}</span>
                  </div>
                )}
                {salaryDetail.otherDeduction > 0 && (
                  <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                    <span className="text-muted-foreground">????</span>
                    <span className="font-medium text-red-600">-{formatCurrency(salaryDetail.otherDeduction)}</span>
                  </div>
                )}
                <div className="flex justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">????</span>
                  <span className="font-bold text-blue-600">{formatCurrency(salaryDetail.total)}</span>
                </div>
              </div>

              {/* ????? */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between rounded-md border border-red-200 bg-red-50/30 px-3 py-2">
                  <span className="text-muted-foreground">????????</span>
                  <span className="font-medium text-red-600">{formatCurrency(salaryDetail.socialInsurance || 0)}</span>
                </div>
                <div className="flex justify-between rounded-md border border-cyan-200 bg-cyan-50/30 px-3 py-2">
                  <span className="text-muted-foreground">????????</span>
                  <span className="font-medium text-cyan-600">{formatCurrency(salaryDetail.housingFund || 0)}</span>
                </div>
              </div>

              {salaryDetailPerson.highCommissionFrom ? (
                <p className="text-xs text-orange-700">
                  ?????????????????? ? {salaryDetailPerson.highCommissionFrom}
                  ????????????????
                  {salaryDetail.fixedRatio < 1
                    ? ` ???????? ${(salaryDetail.fixedRatio * 100).toFixed(1)}%?`
                    : ""}
                </p>
              ) : null}

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">?????????????</span>
                <span className="ml-2 font-bold">
                  {formatCurrency(
                    salaryDetail.total
                      + (salaryDetail.socialInsurance || 0)
                      + (salaryDetail.housingFund || 0),
                  )}
                </span>
              </div>

              {/* ???? */}
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                ??????? / {MONTHLY_WORK_DAYS} = {formatCurrency(salaryDetailPerson.salary.baseSalary / MONTHLY_WORK_DAYS)} / ?
              </div>

              {/* ???? */}
              <div className="space-y-1.5 rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">?????</p>
                {salaryDetailPerson.salary.performanceCondition && (
                  <p className="text-xs">? ???{salaryDetailPerson.salary.performanceCondition}</p>
                )}
                {salaryDetailPerson.salary.positionAllowanceCondition && (
                  <p className="text-xs">? ?????{salaryDetailPerson.salary.positionAllowanceCondition}</p>
                )}
                {salaryDetailPerson.salary.managementCommissionCondition && (
                  <p className="text-xs">? ?????{salaryDetailPerson.salary.managementCommissionCondition}??????? {formatCurrency(salaryDetailPerson.salary.managementCommissionThreshold)} ??? {salaryDetailPerson.salary.managementCommissionRate}% ???</p>
                )}
                {salaryDetailPerson.salary.personalCommissionCondition && (
                  <p className="text-xs">? ?????{salaryDetailPerson.salary.personalCommissionCondition}??????? {formatCurrency(salaryDetailPerson.salary.personalCommissionThreshold)} ??? {salaryDetailPerson.salary.personalCommissionRate}% ???</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSalaryDetailPerson(null)}>??</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>????</AlertDialogTitle>
            <AlertDialogDescription>??????????????????</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>??</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              ????
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!distributionPerson}
        onOpenChange={(open) => !open && setDistributionPerson(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>??????? ? {distributionPerson?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              ???????????????? ? ??????????????????????????
            </p>
            <div className="space-y-1.5">
              <Label>????????</Label>
              <Input
                type="date"
                value={distributionResign}
                onChange={(e) => setDistributionResign(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>???/?????????????</Label>
              <Input
                type="date"
                value={distributionFrom}
                onChange={(e) => setDistributionFrom(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                ??????? 2026-07-18?6/17 ????????+????
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>???????? %?????????????</Label>
              <Input
                type="number"
                value={distributionRate}
                onChange={(e) => setDistributionRate(Number(e.target.value) || 0)}
                placeholder="? 30"
              />
              <p className="text-xs text-muted-foreground">
                ? 0 ???????????????????????????????
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDistributionPerson(null)}>
              ??
            </Button>
            <Button
              disabled={distributionSaving}
              onClick={() => void handleEnableDistribution()}
            >
              {distributionSaving ? "????" : "??????"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
