import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Clock,
  Download,
  FileUp,
  History,
  Paperclip,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { hrProfilesApi, laborCompaniesApi, getToken } from "@/lib/api";
import { calcCompanyTenureYears, formatCompanyTenure, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ContractAlert,
  HrProfile,
  HrProfileLog,
  HrReminders,
  LaborCompany,
  SignedDocument,
} from "@/types";

const HR_LOG_ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "新建", color: "bg-emerald-100 text-emerald-800" },
  update: { label: "修改", color: "bg-blue-100 text-blue-800" },
  delete: { label: "删除", color: "bg-red-100 text-red-800" },
  import: { label: "导入", color: "bg-violet-100 text-violet-800" },
  batch_create: { label: "一键建档", color: "bg-teal-100 text-teal-800" },
  batch_delete: { label: "批量删除", color: "bg-orange-100 text-orange-800" },
  upload_document: { label: "上传文档", color: "bg-sky-100 text-sky-800" },
  delete_document: { label: "删除文档", color: "bg-rose-100 text-rose-800" },
};

/** 左侧固定列像素宽（须与 left 累加一致，否则会盖住手机号等列） */
const HR_STICKY_W = {
  check: 40,
  index: 48,
  status: 84,
  name: 96,
  gender: 56,
} as const;

const HR_STICKY_CELL =
  "sticky z-20 box-border overflow-hidden bg-background";

function getHrStickyLeft(canEdit: boolean) {
  const check = canEdit ? HR_STICKY_W.check : 0;
  const index = check;
  const status = index + HR_STICKY_W.index;
  const name = status + HR_STICKY_W.status;
  const gender = name + HR_STICKY_W.name;
  return { check: 0, index, status, name, gender };
}

function hrStickyStyle(left: number, width: number): CSSProperties {
  return {
    left,
    width,
    minWidth: width,
    maxWidth: width,
  };
}
type ContractFilter = "all" | "due60" | "due30" | "expired" | "empty";
type ImportForceStatus = "table" | "active" | "inactive";

type ImportOptionsForm = {
  laborCompanyId: string;
  laborCompanyName: string;
  preferSelectedLaborCompany: boolean;
  autoCreateLaborCompany: boolean;
  forceStatus: ImportForceStatus;
};

type ImportPreviewItem = {
  excelRow: number;
  name: string;
  unitName: string;
  position: string;
  status: string;
  hireDate: string;
  resignDate: string;
  laborCompany: string;
  matchHint: string;
  matchOk: boolean;
  raw: Record<string, unknown>;
};

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
  hireDate: string;
  resignDate: string;
  companyTenure: string;
  regularizationDate: string;
  employmentType: string;
  maritalStatus: string;
  nativePlace: string;
  householdRegister: string;
  idAddress: string;
  graduationDate: string;
  emergencyRelation: string;
  internshipStartDate: string;
  internshipEndDate: string;
  contract1StartDate: string;
  contract1EndDate: string;
  contract2StartDate: string;
  contract2EndDate: string;
  contract3StartDate: string;
  contract3EndDate: string;
  bankBelong: string;
  companyEmail: string;
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
  hireDate: "",
  resignDate: "",
  companyTenure: "",
  regularizationDate: "",
  employmentType: "",
  maritalStatus: "",
  nativePlace: "",
  householdRegister: "",
  idAddress: "",
  graduationDate: "",
  emergencyRelation: "",
  internshipStartDate: "",
  internshipEndDate: "",
  contract1StartDate: "",
  contract1EndDate: "",
  contract2StartDate: "",
  contract2EndDate: "",
  contract3StartDate: "",
  contract3EndDate: "",
  bankBelong: "",
  companyEmail: "",
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdParts(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Excel 序列日 → YYYY-MM-DD（按 UTC 日历，与 Excel 显示日一致） */
function fromExcelSerial(n: number): string {
  if (!Number.isFinite(n) || n < 1 || n >= 80000) return "";
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const dt = new Date(utc);
  return ymdParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * SheetJS cellDates 常把「2018/6/20」解成 2018-06-19T15:59:17Z，
 * 用本地 getDate 会少一天；经 Excel 序列四舍五入可还原表格日历日。
 */
function calendarYmdFromDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const serial = Math.round(
    (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000,
  );
  return fromExcelSerial(serial);
}

/** 导入单元格：日期与超长数字统一成安全字符串 */
function normalizeImportCell(headerKey: string, v: unknown): unknown {
  if (v === undefined || v === null || v === "") return "";
  const isDateCol = /日期|时间|年月|起止|出生|入职|离职|转正|毕业|合同|实习/.test(
    headerKey,
  );
  const isLongNumCol = /身份证|银行卡|手机|电话|账号|账户/.test(headerKey);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return calendarYmdFromDate(v);
  }
  if (
    isDateCol &&
    typeof v === "number" &&
    Number.isFinite(v) &&
    v > 2000 &&
    v < 80000
  ) {
    return fromExcelSerial(v);
  }
  if (isLongNumCol) {
    if (typeof v === "number" && Number.isFinite(v)) {
      if (Math.abs(v) >= 1e14) return BigInt(Math.round(v)).toString();
      if (Number.isInteger(v)) return String(v);
      return String(v);
    }
    const s = String(v).trim();
    if (/^\d+\.0$/.test(s)) return s.slice(0, -2);
    return s;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (isDateCol && /^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const dt = new Date(s);
      if (!Number.isNaN(dt.getTime())) return calendarYmdFromDate(dt);
    }
  }
  return v;
}

function pickImportField(
  row: Record<string, unknown>,
  keys: string[],
): string {
  for (const k of keys) {
    const key = k.replace(/\s+/g, "");
    if (
      row[key] !== undefined
      && row[key] !== null
      && String(row[key]).trim() !== ""
    ) {
      return String(row[key]).trim();
    }
  }
  return "";
}

function parseImportWorkbook(buf: ArrayBuffer): Record<string, unknown>[] {
  // cellDates:false，保留 Excel 序列数字，避免 Date 时区把入职日提前一天
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  let sheet = wb.Sheets[wb.SheetNames[0]];
  for (const name of wb.SheetNames) {
    const s = wb.Sheets[name];
    const preview = XLSX.utils.sheet_to_json<Record<string, unknown>>(s, {
      defval: "",
      raw: true,
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
  return XLSX.utils
    .sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: true,
    })
    .map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        const key = String(k).replace(/\s+/g, "").replace(/\u00a0/g, "");
        out[key] = normalizeImportCell(key, v);
      }
      return out;
    })
    .filter((row) => Object.values(row).some((v) => String(v ?? "").trim() !== ""));
}

const IMPORT_SAMPLE_HEADERS = [
  "姓名",
  "入职时间",
  "司龄",
  "转正日期",
  "用工性质",
  "合同主体",
  "性别",
  "民族",
  "婚姻状况",
  "籍贯",
  "户籍",
  "身份证",
  "出生年月",
  "年龄",
  "身份证地址",
  "学历",
  "毕业院校",
  "毕业时间",
  "专业",
  "手机号码",
  "联系地址",
  "是否党员",
  "紧急联系人姓名",
  "与本人关系",
  "联系电话",
  "实习协议开始时间",
  "实习协议到期时间",
  "劳动合同1开始时间",
  "劳动合同1到期时间",
  "劳动合同2开始时间",
  "劳动合同2到期时间",
  "劳动合同3开始时间",
  "劳动合同3到期时间",
  "银行卡号",
  "所属银行",
  "开户行信息",
  "企业邮箱",
] as const;

function downloadImportSampleTemplate() {
  const sample: Record<string, string> = {
    姓名: "张三",
    入职时间: "2024-01-15",
    司龄: "2.0年",
    转正日期: "2024-04-15",
    用工性质: "全职",
    合同主体: "示例劳务公司",
    性别: "男",
    民族: "汉",
    婚姻状况: "未婚",
    籍贯: "北京",
    户籍: "北京",
    身份证: "110101199001011234",
    出生年月: "1990-01-01",
    年龄: "36",
    身份证地址: "北京市东城区示例路1号",
    学历: "本科",
    毕业院校: "示例大学",
    毕业时间: "2012-06-30",
    专业: "市场营销",
    手机号码: "13800138000",
    联系地址: "北京市朝阳区示例街2号",
    是否党员: "群众",
    紧急联系人姓名: "李四",
    与本人关系: "亲属",
    联系电话: "13900139000",
    实习协议开始时间: "",
    实习协议到期时间: "",
    劳动合同1开始时间: "2024-01-15",
    劳动合同1到期时间: "2027-01-14",
    劳动合同2开始时间: "",
    劳动合同2到期时间: "",
    劳动合同3开始时间: "",
    劳动合同3到期时间: "",
    银行卡号: "6222021234567890123",
    所属银行: "工商银行",
    开户行信息: "北京分行营业部",
    企业邮箱: "zhangsan@example.com",
  };
  const note = [
    ["使用说明"],
    ["1. 「样例数据」表头顺序与档案表一致，请勿改列名"],
    ["2. 「姓名」必须与「人员管理」中已有人员完全一致（导入不会新建人员）"],
    ["3. 同名多人时可额外增加「部门」或「销售单位公司」列，名称需与系统销售单位一致"],
    ["4. 「合同主体」需在签署公司字典中，或导入时勾选自动创建"],
    ["5. 日期建议用 YYYY-MM-DD，如 2024-01-15"],
    ["6. 请把样例「张三」改成人员管理中真实存在的姓名后再导入"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(note), "使用说明");
  const ws = XLSX.utils.json_to_sheet([sample], {
    header: [...IMPORT_SAMPLE_HEADERS],
  });
  XLSX.utils.book_append_sheet(wb, ws, "样例数据");
  XLSX.writeFile(wb, "人事档案批量导入样表.xlsx");
}

/** 列表展示：统一成 YYYY-MM-DD */
function displayDate(v: string | null | undefined): string {
  if (!v) return "—";
  const s = String(v).trim();
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return calendarYmdFromDate(dt);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const cn = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/);
  if (cn) {
    const d = cn[3] ? cn[3].padStart(2, "0") : "01";
    return `${cn[1]}-${cn[2].padStart(2, "0")}-${d}`;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 2000 && n < 80000) return fromExcelSerial(n);
  }
  const slash = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
  }
  return s;
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
  const [laborCompanyFilter, setLaborCompanyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [contractFilter, setContractFilter] = useState<ContractFilter>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HrProfile | null>(null);
  const [form, setForm] = useState<HrForm>(EMPTY_FORM);
  const [newLaborName, setNewLaborName] = useState("");
  const [laborCompanyManageOpen, setLaborCompanyManageOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importOptions, setImportOptions] = useState<ImportOptionsForm>({
    laborCompanyId: "",
    laborCompanyName: "",
    preferSelectedLaborCompany: true,
    autoCreateLaborCompany: true,
    forceStatus: "table",
  });
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const [importFileName, setImportFileName] = useState("");
  const [importPreviewList, setImportPreviewList] = useState<ImportPreviewItem[]>(
    [],
  );
  const [docUploading, setDocUploading] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [profileLogs, setProfileLogs] = useState<HrProfileLog[]>([]);
  const [profileLogsLoading, setProfileLogsLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allLogs, setAllLogs] = useState<HrProfileLog[]>([]);
  const [allLogsLoading, setAllLogsLoading] = useState(false);

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
      setSelectedIds([]);
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
      if (laborCompanyFilter === "empty") {
        if (row.laborCompanyId) return false;
      } else if (laborCompanyFilter !== "all" && row.laborCompanyId !== laborCompanyFilter) {
        return false;
      }
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
        row.laborCompanyName || laborNameMap.get(row.laborCompanyId) || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    list,
    search,
    unitFilter,
    laborCompanyFilter,
    statusFilter,
    contractFilter,
    unitNameMap,
    laborNameMap,
  ]);

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
      hireDate: row.hireDate || "",
      resignDate: row.resignDate || "",
      companyTenure: row.companyTenure || "",
      regularizationDate: row.regularizationDate || "",
      employmentType: row.employmentType || "",
      maritalStatus: row.maritalStatus || "",
      nativePlace: row.nativePlace || "",
      householdRegister: row.householdRegister || "",
      idAddress: row.idAddress || "",
      graduationDate: row.graduationDate || "",
      emergencyRelation: row.emergencyRelation || "",
      internshipStartDate: row.internshipStartDate || "",
      internshipEndDate: row.internshipEndDate || "",
      contract1StartDate: row.contract1StartDate || "",
      contract1EndDate: row.contract1EndDate || "",
      contract2StartDate: row.contract2StartDate || "",
      contract2EndDate: row.contract2EndDate || "",
      contract3StartDate: row.contract3StartDate || "",
      contract3EndDate: row.contract3EndDate || "",
      bankBelong: row.bankBelong || "",
      companyEmail: row.companyEmail || "",
    });
    setNewLaborName("");
    setProfileLogs([]);
    setDialogOpen(true);
    void loadProfileLogs(row.id);
  }

  async function loadProfileLogs(profileId: string) {
    setProfileLogsLoading(true);
    try {
      const logs = await hrProfilesApi.profileLogs(profileId);
      setProfileLogs(logs);
    } catch {
      setProfileLogs([]);
    } finally {
      setProfileLogsLoading(false);
    }
  }

  async function openHistoryDialog() {
    setHistoryOpen(true);
    setAllLogsLoading(true);
    try {
      const logs = await hrProfilesApi.logs(200);
      setAllLogs(logs);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "加载操作记录失败");
      setAllLogs([]);
    } finally {
      setAllLogsLoading(false);
    }
  }

  function getDutyStatusFromResign(resignDate: string): "active" | "inactive" {
    const resign = resignDate.trim().slice(0, 10);
    if (!resign) return "active";
    const today = new Date().toISOString().slice(0, 10);
    return resign < today ? "inactive" : "active";
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

  async function handleDeleteLaborCompany(companyId: string) {
    const company = laborCompanies.find((c) => c.id === companyId);
    if (!company) return;
    const ok = window.confirm(
      `确定删除签署公司「${company.name}」？\n`
        + "若有人事档案使用该公司，将清空其签署公司字段，档案本身不会删除。",
    );
    if (!ok) return;
    try {
      await laborCompaniesApi.delete(companyId);
      setLaborCompanies((prev) => prev.filter((c) => c.id !== companyId));
      if (laborCompanyFilter === companyId) setLaborCompanyFilter("all");
      if (form.laborCompanyId === companyId) {
        setForm({ ...form, laborCompanyId: "" });
      }
      if (importOptions.laborCompanyId === companyId) {
        setImportOptions({
          ...importOptions,
          laborCompanyId: "",
          laborCompanyName: "",
        });
      }
      await loadData();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "删除签署公司失败");
    }
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const hireDate = form.hireDate.trim();
      const resignDate = form.resignDate.trim();
      const companyTenure = calcCompanyTenureYears(hireDate, resignDate);
      await hrProfilesApi.update(editing.id, {
        gender: form.gender,
        contractStartDate: form.contractStartDate,
        contractEndDate: form.contractEndDate,
        idNumber: form.idNumber,
        birthDate: form.birthDate,
        ethnicity: form.ethnicity,
        politicalStatus: form.politicalStatus,
        education: form.education,
        school: form.school,
        major: form.major,
        bankAccount: form.bankAccount,
        bankName: form.bankName,
        address: form.address,
        emergencyContact: form.emergencyContact,
        emergencyPhone: form.emergencyPhone,
        laborCompanyId: form.laborCompanyId,
        hireDate,
        resignDate: resignDate || null,
        status: getDutyStatusFromResign(resignDate),
        companyTenure,
        regularizationDate: form.regularizationDate,
        employmentType: form.employmentType,
        maritalStatus: form.maritalStatus,
        nativePlace: form.nativePlace,
        householdRegister: form.householdRegister,
        idAddress: form.idAddress,
        graduationDate: form.graduationDate,
        emergencyRelation: form.emergencyRelation,
        internshipStartDate: form.internshipStartDate,
        internshipEndDate: form.internshipEndDate,
        contract1StartDate: form.contract1StartDate,
        contract1EndDate: form.contract1EndDate,
        contract2StartDate: form.contract2StartDate,
        contract2EndDate: form.contract2EndDate,
        contract3StartDate: form.contract3StartDate,
        contract3EndDate: form.contract3EndDate,
        bankBelong: form.bankBelong,
        companyEmail: form.companyEmail,
      } as Parameters<typeof hrProfilesApi.update>[1] & {
        hireDate: string;
        resignDate: string | null;
        status: "active" | "inactive";
      });
      setDialogOpen(false);
      await loadData();
      await refreshAll();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: HrProfile) {
    if (!confirm(`确认删除「${row.name}」的人事档案？不会删除人员管理中的人员。`)) return;
    try {
      await hrProfilesApi.delete(row.id);
      setSelectedIds((prev) => prev.filter((id) => id !== row.id));
      await loadData();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  }

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const selectedInFiltered = useMemo(
    () => selectedIds.filter((id) => filteredIds.includes(id)),
    [selectedIds, filteredIds],
  );
  const isAllFilteredSelected =
    filteredIds.length > 0 && selectedInFiltered.length === filteredIds.length;
  const isSomeFilteredSelected =
    selectedInFiltered.length > 0 && !isAllFilteredSelected;

  function handleToggleSelectAll(checked: boolean | "indeterminate") {
    if (checked === true) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
  }

  function handleToggleSelectRow(id: string, checked: boolean | "indeterminate") {
    if (checked === true) {
      setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      return;
    }
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) {
      alert("请先勾选要删除的人事档案");
      return;
    }
    if (
      !confirm(
        `确认删除已选 ${selectedIds.length} 条人事档案？\n人员管理中手动录入的人员数据会保留。此操作不可恢复。`,
      )
    ) {
      return;
    }
    setDeletingSelected(true);
    setImportResult("");
    try {
      const result = await hrProfilesApi.batchDelete(selectedIds);
      setImportResult(`已删除人事档案 ${result.deleted} 条（人员管理手动数据已保留）`);
      setSelectedIds([]);
      await loadData();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingSelected(false);
    }
  }

  async function handleSelectImportFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const rows = parseImportWorkbook(buf);
      if (rows.length === 0) {
        alert("表格无数据，请确认第一行是表头（含「姓名」列）");
        return;
      }

      const unitIdByName = new Map(
        salesUnits.map((u) => [u.name.trim().toLowerCase(), u.id] as const),
      );

      const preview = rows.map((row, i) => {
        const name = pickImportField(row, ["姓名", "员工姓名", "name", "Name"]);
        const unitName = pickImportField(row, [
          "销售单位公司",
          "销售单位",
          "部门",
          "单位",
          "所属单位",
          "salesUnit",
          "department",
        ]);
        const status = pickImportField(row, ["状态", "status"]);
        const hireDate = pickImportField(row, ["入职时间", "入职日期", "hireDate"]);
        const resignDate = pickImportField(row, ["离职日期", "resignDate"]);
        const laborCompany = pickImportField(row, [
          "合同主体",
          "劳动合同签署公司",
          "劳动签署公司",
          "劳动合同公司",
          "签署公司",
          "laborCompany",
        ]);
        const position = pickImportField(row, ["职位", "岗位", "用工性质", "position"]);

        let matchHint = "";
        let matchOk = false;
        if (!name) {
          matchHint = "缺少姓名";
        } else {
          const candidates = personnel.filter(
            (p) => String(p.name || "").trim() === name,
          );
          if (candidates.length === 0) {
            matchOk = true;
            matchHint = "将写入人事（不同步人员管理）";
          } else if (!unitName) {
            if (candidates.length === 1) {
              matchOk = true;
              matchHint = "可匹配人员管理";
            } else {
              matchHint = `同名 ${candidates.length} 人，请补充部门`;
            }
          } else {
            const unitId = unitIdByName.get(unitName.trim().toLowerCase()) || "";
            const matched = unitId
              ? candidates.filter((p) => p.salesUnitId === unitId)
              : [];
            if (matched.length === 1) {
              matchOk = true;
              matchHint = "可匹配人员管理";
            } else if (matched.length > 1) {
              matchHint = "同单位下匹配到多人";
            } else if (candidates.length === 1) {
              matchOk = true;
              matchHint = "可匹配人员管理";
            } else {
              matchOk = true;
              matchHint = "将写入人事（不同步人员管理）";
            }
          }
        }

        return {
          excelRow: i + 1,
          name,
          unitName,
          position,
          status,
          hireDate,
          resignDate,
          laborCompany,
          matchHint,
          matchOk,
          raw: row,
        };
      });

      setImportFileName(file.name);
      setImportPreviewList(preview);
      setImportDialogOpen(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "读取表格失败";
      alert(msg);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleConfirmImport() {
    if (importPreviewList.length === 0) {
      alert("请先选择表格并预览数据");
      return;
    }
    setImporting(true);
    setImportResult("");
    try {
      const selectedName =
        importOptions.laborCompanyName.trim()
        || laborCompanies.find((c) => c.id === importOptions.laborCompanyId)?.name
        || "";
      const result = await hrProfilesApi.importRows(
        importPreviewList.map((item) => item.raw),
        {
          laborCompanyId: importOptions.laborCompanyId || undefined,
          laborCompanyName: selectedName || undefined,
          preferSelectedLaborCompany: importOptions.preferSelectedLaborCompany,
          autoCreateLaborCompany: importOptions.autoCreateLaborCompany,
          forceStatus:
            importOptions.forceStatus === "table" ? "" : importOptions.forceStatus,
        },
      );
      setImportResult(
        `成功 ${result.success} 条，失败 ${result.failed} 条` +
          (result.errors.length
            ? `。失败明细：${result.errors
                .slice(0, 10)
                .map((e) => `第${e.row}行${e.name ? `「${e.name}」` : ""} ${e.reason}`)
                .join("；")}${result.errors.length > 10 ? "…" : ""}`
            : ""),
      );
      setImportDialogOpen(false);
      setImportPreviewList([]);
      setImportFileName("");
      const companies = await laborCompaniesApi.list();
      setLaborCompanies(companies);
      await loadData();
      await refreshAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "导入失败";
      setImportResult(`导入失败：${msg}`);
      alert(msg);
    } finally {
      setImporting(false);
    }
  }

  function clearImportPreview() {
    setImportPreviewList([]);
    setImportFileName("");
  }

  function openImportDialog() {
    setImportOptions((prev) => ({
      ...prev,
      laborCompanyId: laborCompanyFilter !== "all" && laborCompanyFilter !== "empty"
        ? laborCompanyFilter
        : prev.laborCompanyId,
      laborCompanyName:
        laborCompanyFilter !== "all" && laborCompanyFilter !== "empty"
          ? (laborCompanies.find((c) => c.id === laborCompanyFilter)?.name || "")
          : prev.laborCompanyName,
      forceStatus:
        statusFilter === "active" || statusFilter === "inactive"
          ? statusFilter
          : prev.forceStatus,
    }));
    clearImportPreview();
    setImportDialogOpen(true);
  }

  function patchListProfile(updated: HrProfile) {
    setList((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    setEditing((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  async function handleUploadDocument(file: File) {
    if (!editing) return;
    if (file.size > 12 * 1024 * 1024) {
      alert("单个文件不能超过 12MB");
      return;
    }
    setDocUploading(true);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const updated = await hrProfilesApi.uploadDocument(editing.id, {
        fileName: file.name,
        contentBase64,
        mimeType: file.type || "application/octet-stream",
      });
      patchListProfile(updated);
      void loadProfileLogs(editing.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "上传失败");
    } finally {
      setDocUploading(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  }

  async function handleDeleteDocument(doc: SignedDocument) {
    if (!editing) return;
    if (!confirm(`确认删除文档「${doc.fileName}」？`)) return;
    try {
      const updated = await hrProfilesApi.deleteDocument(editing.id, doc.id);
      patchListProfile(updated);
      void loadProfileLogs(editing.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleDownloadDocument(profileId: string, doc: SignedDocument) {
    try {
      const token = getToken();
      const res = await fetch(hrProfilesApi.downloadDocumentUrl(profileId, doc.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const raw = await res.text();
        let msg = "下载失败";
        try {
          msg = JSON.parse(raw)?.error || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "下载失败");
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
  const stickyLeft = getHrStickyLeft(canEdit);

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="人事管理"
        description="可独立导入人事档案：匹配到人员管理则关联；匹配不到只建人事档。入离职日期只保存在人事档案，不会改写人员管理表格。业绩归属单位仅关联人员时显示。签署公司≠销售单位。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void openHistoryDialog()}
            >
              <History className="mr-2 h-4 w-4" />
              操作记录
            </Button>
            {canEdit ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleSelectImportFile(f);
                  }}
                />
                <Button
                  variant="outline"
                  disabled={importing || deletingSelected}
                  onClick={openImportDialog}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  {importing ? "导入中…" : "批量导入表格"}
                </Button>
                <Button
                  variant="outline"
                  onClick={downloadImportSampleTemplate}
                >
                  <Download className="mr-2 h-4 w-4" />
                  下载导入样表
                </Button>
                <Button
                  variant="destructive"
                  disabled={deletingSelected || loading || selectedIds.length === 0}
                  onClick={() => void handleDeleteSelected()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deletingSelected
                    ? "删除中…"
                    : selectedIds.length > 0
                      ? `删除所选（${selectedIds.length}）`
                      : "删除所选"}
                </Button>
              </>
            ) : null}
          </div>
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
            <SelectValue placeholder="业绩归属单位" />
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
        <Select value={laborCompanyFilter} onValueChange={setLaborCompanyFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="劳动合同签署公司" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部签署公司</SelectItem>
            <SelectItem value="empty">未填签署公司</SelectItem>
            {laborCompanies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setLaborCompanyManageOpen(true)}
          >
            管理签署公司
          </Button>
        )}
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
          <Table className="min-w-max border-separate border-spacing-0">
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead
                      className={cn(HR_STICKY_CELL, "px-2")}
                      style={hrStickyStyle(stickyLeft.check, HR_STICKY_W.check)}
                    >
                      <Checkbox
                        checked={
                          isAllFilteredSelected
                            ? true
                            : isSomeFilteredSelected
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={handleToggleSelectAll}
                        aria-label="全选当前列表"
                        disabled={filtered.length === 0 || deletingSelected}
                      />
                    </TableHead>
                  )}
                  <TableHead
                    className={HR_STICKY_CELL}
                    style={hrStickyStyle(stickyLeft.index, HR_STICKY_W.index)}
                  >
                    序号
                  </TableHead>
                  <TableHead
                    className={HR_STICKY_CELL}
                    style={hrStickyStyle(stickyLeft.status, HR_STICKY_W.status)}
                  >
                    状态
                  </TableHead>
                  <TableHead
                    className={cn(HR_STICKY_CELL, "truncate")}
                    style={hrStickyStyle(stickyLeft.name, HR_STICKY_W.name)}
                  >
                    姓名
                  </TableHead>
                  <TableHead
                    className={cn(
                      HR_STICKY_CELL,
                      "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]",
                    )}
                    style={hrStickyStyle(stickyLeft.gender, HR_STICKY_W.gender)}
                  >
                    性别
                  </TableHead>
                  <TableHead className="min-w-[128px]">手机号</TableHead>
                  <TableHead className="min-w-[140px]">劳动合同签署公司</TableHead>
                  <TableHead className="min-w-[120px]">业绩归属单位</TableHead>
                  <TableHead className="min-w-[80px]">职位</TableHead>
                  <TableHead className="min-w-[80px]">用工性质</TableHead>
                  <TableHead className="min-w-[110px]">入职日期</TableHead>
                  <TableHead className="min-w-[110px]">离职日期</TableHead>
                  <TableHead className="min-w-[72px]">司龄</TableHead>
                  <TableHead className="min-w-[110px]">转正日期</TableHead>
                  <TableHead className="min-w-[110px]">合同提醒到期</TableHead>
                  <TableHead className="min-w-[100px]">合同提醒</TableHead>
                  <TableHead className="min-w-[110px]">劳动合同1起</TableHead>
                  <TableHead className="min-w-[110px]">劳动合同1止</TableHead>
                  <TableHead className="min-w-[110px]">劳动合同2起</TableHead>
                  <TableHead className="min-w-[110px]">劳动合同2止</TableHead>
                  <TableHead className="min-w-[110px]">劳动合同3起</TableHead>
                  <TableHead className="min-w-[110px]">劳动合同3止</TableHead>
                  <TableHead className="min-w-[120px]">签署文档</TableHead>
                  <TableHead className="min-w-[160px]">身份证</TableHead>
                  <TableHead className="min-w-[110px]">出生年月</TableHead>
                  <TableHead className="min-w-[52px]">年龄</TableHead>
                  <TableHead className="min-w-[52px]">民族</TableHead>
                  <TableHead className="min-w-[80px]">婚姻状况</TableHead>
                  <TableHead className="min-w-[80px]">籍贯</TableHead>
                  <TableHead className="min-w-[80px]">户籍</TableHead>
                  <TableHead className="min-w-[80px]">是否党员</TableHead>
                  <TableHead className="min-w-[64px]">学历</TableHead>
                  <TableHead className="min-w-[120px]">毕业院校</TableHead>
                  <TableHead className="min-w-[110px]">毕业时间</TableHead>
                  <TableHead className="min-w-[100px]">专业</TableHead>
                  <TableHead className="min-w-[140px]">企业邮箱</TableHead>
                  <TableHead className="min-w-[160px]">银行卡号</TableHead>
                  <TableHead className="min-w-[100px]">所属银行</TableHead>
                  <TableHead className="min-w-[120px]">开户行</TableHead>
                  <TableHead className="min-w-[140px]">身份证地址</TableHead>
                  <TableHead className="min-w-[140px]">联系地址</TableHead>
                  <TableHead className="min-w-[100px]">紧急联系人</TableHead>
                  <TableHead className="min-w-[64px]">关系</TableHead>
                  <TableHead className="min-w-[110px]">紧急电话</TableHead>
                  <TableHead className="min-w-[100px]">最近操作</TableHead>
                  {canEdit && <TableHead className="min-w-[100px]">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={canEdit ? 46 : 44}
                      className="py-10 text-center text-muted-foreground"
                    >
                      加载中…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canEdit ? 46 : 44}
                      className="py-10 text-center text-muted-foreground"
                    >
                      暂无人事档案。可点「批量导入表格」（须先在人员管理存在同名人员）。
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row, index) => (
                    <TableRow
                      key={row.id}
                      data-state={selectedIds.includes(row.id) ? "selected" : undefined}
                    >
                      {canEdit && (
                        <TableCell
                          className={cn(HR_STICKY_CELL, "px-2")}
                          style={hrStickyStyle(stickyLeft.check, HR_STICKY_W.check)}
                        >
                          <Checkbox
                            checked={selectedIds.includes(row.id)}
                            onCheckedChange={(checked) => handleToggleSelectRow(row.id, checked)}
                            aria-label={`选择 ${row.name}`}
                            disabled={deletingSelected}
                          />
                        </TableCell>
                      )}
                      <TableCell
                        className={HR_STICKY_CELL}
                        style={hrStickyStyle(stickyLeft.index, HR_STICKY_W.index)}
                      >
                        {index + 1}
                      </TableCell>
                      <TableCell
                        className={HR_STICKY_CELL}
                        style={hrStickyStyle(stickyLeft.status, HR_STICKY_W.status)}
                      >
                        <Badge variant={row.status === "active" ? "default" : "secondary"}>
                          {row.status === "active" ? "在职" : "离职"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(HR_STICKY_CELL, "truncate font-medium")}
                        style={hrStickyStyle(stickyLeft.name, HR_STICKY_W.name)}
                        title={row.name}
                      >
                        {row.name}
                      </TableCell>
                      <TableCell
                        className={cn(
                          HR_STICKY_CELL,
                          "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]",
                        )}
                        style={hrStickyStyle(stickyLeft.gender, HR_STICKY_W.gender)}
                      >
                        {row.gender || "—"}
                      </TableCell>
                      <TableCell className="min-w-[128px] tabular-nums">
                        {row.phone || "—"}
                      </TableCell>
                      <TableCell>
                        {row.laborCompanyName
                          || laborNameMap.get(row.laborCompanyId)
                          || "未设置"}
                      </TableCell>
                      <TableCell>
                        {unitNameMap.get(row.salesUnitId) || "—"}
                      </TableCell>
                      <TableCell>{row.position || "—"}</TableCell>
                      <TableCell>{row.employmentType || "—"}</TableCell>
                      <TableCell className="tabular-nums">{displayDate(row.hireDate)}</TableCell>
                      <TableCell className="tabular-nums">{displayDate(row.resignDate)}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatCompanyTenure(row.hireDate, row.resignDate) || "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {displayDate(row.regularizationDate)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular-nums",
                          row.contractAlert === "due60" || row.contractAlert === "due30"
                            ? "bg-amber-100"
                            : "",
                          row.contractAlert === "expired" ? "bg-red-100" : "",
                        )}
                      >
                        {displayDate(row.contractEndDate)}
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
                      <TableCell className="tabular-nums">
                        {displayDate(row.contract1StartDate)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {displayDate(row.contract1EndDate)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {displayDate(row.contract2StartDate)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {displayDate(row.contract2EndDate)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {displayDate(row.contract3StartDate)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {displayDate(row.contract3EndDate)}
                      </TableCell>
                      <TableCell>
                        {(row.signedDocuments || []).length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {(row.signedDocuments || []).slice(0, 3).map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                className="flex max-w-[160px] items-center gap-1 truncate text-left text-xs text-primary hover:underline"
                                onClick={() => void handleDownloadDocument(row.id, doc)}
                                title={doc.fileName}
                              >
                                <Paperclip className="h-3 w-3 shrink-0" />
                                <span className="truncate">{doc.fileName}</span>
                              </button>
                            ))}
                            {(row.signedDocuments || []).length > 3 && (
                              <span className="text-xs text-muted-foreground">
                                +{(row.signedDocuments || []).length - 3} 个
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.idNumber || "—"}</TableCell>
                      <TableCell className="tabular-nums">{displayDate(row.birthDate)}</TableCell>
                      <TableCell>{row.age ?? "—"}</TableCell>
                      <TableCell>{row.ethnicity || "—"}</TableCell>
                      <TableCell>{row.maritalStatus || "—"}</TableCell>
                      <TableCell>{row.nativePlace || "—"}</TableCell>
                      <TableCell>{row.householdRegister || "—"}</TableCell>
                      <TableCell>{row.politicalStatus || "—"}</TableCell>
                      <TableCell>{row.education || "—"}</TableCell>
                      <TableCell>{row.school || "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {displayDate(row.graduationDate)}
                      </TableCell>
                      <TableCell>{row.major || "—"}</TableCell>
                      <TableCell>{row.companyEmail || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.bankAccount || "—"}</TableCell>
                      <TableCell>{row.bankBelong || "—"}</TableCell>
                      <TableCell>{row.bankName || "—"}</TableCell>
                      <TableCell className="max-w-[160px] truncate" title={row.idAddress}>
                        {row.idAddress || "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={row.address}>
                        {row.address || "—"}
                      </TableCell>
                      <TableCell>{row.emergencyContact || "—"}</TableCell>
                      <TableCell>{row.emergencyRelation || "—"}</TableCell>
                      <TableCell>{row.emergencyPhone || "—"}</TableCell>
                      <TableCell className="min-w-[100px]">
                        {row.lastOperator ? (
                          <div className="space-y-0.5">
                            <div className="text-sm font-medium">{row.lastOperator}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.lastOperatedAt
                                ? formatDateTime(row.lastOperatedAt)
                                : "—"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
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
        </CardContent>
      </Card>

      <Dialog open={laborCompanyManageOpen} onOpenChange={setLaborCompanyManageOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>管理劳动合同签署公司</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            可删除误识别项（例如把合同日期当成公司名）。删除字典不会删人事档案，仅清空相关档案的签署公司字段。
          </p>
          <div className="max-h-[360px] space-y-2 overflow-y-auto">
            {laborCompanies.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无签署公司</p>
            ) : (
              laborCompanies.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <span className="min-w-0 flex-1 break-all text-sm">{c.name}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-destructive"
                    onClick={() => void handleDeleteLaborCompany(c.id)}
                  >
                    删除
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLaborCompanyManageOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑人事档案</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>劳动合同签署公司</Label>
              <Select
                value={form.laborCompanyId || "__none__"}
                onValueChange={(v) =>
                  setForm({ ...form, laborCompanyId: v === "__none__" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="独立维护，勿与销售单位混用" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未设置</SelectItem>
                  {laborCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Input
                    placeholder="真实签署公司全称（≠销售单位名）"
                    value={newLaborName}
                    onChange={(e) => setNewLaborName(e.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleAddLaborCompany()}>
                    新增
                  </Button>
                  {form.laborCompanyId ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => void handleDeleteLaborCompany(form.laborCompanyId)}
                    >
                      删除当前字典项
                    </Button>
                  ) : null}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                与「销售单位管理」无关；请按劳动合同上的公司名称维护。误识别的日期等可删字典项。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>业绩归属单位（人员管理）</Label>
              <Input
                disabled
                value={
                  editing?.salesUnitId
                    ? (unitNameMap.get(editing.salesUnitId) || "—")
                    : "—"
                }
              />
              <p className="text-xs text-muted-foreground">
                只读：已关联人员管理时显示其销售单位；未关联则为空白。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>入职日期（在职起）</Label>
              <Input
                type="date"
                value={form.hireDate}
                onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>离职日期（在职止）</Label>
              <Input
                type="date"
                value={form.resignDate}
                onChange={(e) => setForm({ ...form, resignDate: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                清空表示在职。入离职仅写入人事档案，不会修改人员管理中的入离职日期；成本计停仍以人员管理为准。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>司龄（自动）</Label>
              <Input
                readOnly
                value={
                  formatCompanyTenure(form.hireDate, form.resignDate) || "—"
                }
              />
              <p className="text-xs text-muted-foreground">
                按入职日自动计算，保留一位小数；在职算到今天，已离职算到离职日。
              </p>
            </div>
            {(
              [
                ["gender", "性别"],
                ["regularizationDate", "转正日期"],
                ["employmentType", "用工性质"],
                ["maritalStatus", "婚姻状况"],
                ["nativePlace", "籍贯"],
                ["householdRegister", "户籍"],
                ["idNumber", "身份证"],
                ["birthDate", "出生年月"],
                ["ethnicity", "民族"],
                ["politicalStatus", "是否党员/政治面貌"],
                ["idAddress", "身份证地址"],
                ["education", "学历"],
                ["school", "毕业院校"],
                ["graduationDate", "毕业时间"],
                ["major", "专业"],
                ["companyEmail", "企业邮箱"],
                ["contract1StartDate", "劳动合同1开始"],
                ["contract1EndDate", "劳动合同1到期"],
                ["contract2StartDate", "劳动合同2开始"],
                ["contract2EndDate", "劳动合同2到期"],
                ["contract3StartDate", "劳动合同3开始"],
                ["contract3EndDate", "劳动合同3到期"],
                ["internshipStartDate", "实习协议开始"],
                ["internshipEndDate", "实习协议到期"],
                ["bankAccount", "银行卡号"],
                ["bankBelong", "所属银行"],
                ["bankName", "开户行信息"],
                ["emergencyContact", "紧急联系人姓名"],
                ["emergencyRelation", "与本人关系"],
                ["emergencyPhone", "紧急联系电话"],
              ] as Array<[keyof HrForm, string]>
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={
                    key.includes("Date") || key.includes("Start") || key.includes("End")
                      ? "date"
                      : "text"
                  }
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="sm:col-span-2 space-y-1.5">
              <Label>联系地址</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            {editing && (
              <div className="sm:col-span-2 space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="flex items-center gap-1">
                    <Paperclip className="h-4 w-4" />
                    签署文档
                  </Label>
                  <div>
                    <input
                      ref={docInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.zip"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadDocument(f);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={docUploading}
                      onClick={() => docInputRef.current?.click()}
                    >
                      <Upload className="mr-1 h-3.5 w-3.5" />
                      {docUploading ? "上传中…" : "上传文档"}
                    </Button>
                  </div>
                </div>
                {(editing.signedDocuments || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    尚未上传。支持 PDF / Word / 图片，单文件 ≤ 12MB。
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {(editing.signedDocuments || []).map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm"
                      >
                        <span className="truncate" title={doc.fileName}>
                          {doc.fileName}
                        </span>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleDownloadDocument(editing.id, doc)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => void handleDeleteDocument(doc)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {editing && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="flex items-center gap-1">
                  <History className="h-4 w-4" />
                  操作记录
                </Label>
                <span className="text-xs text-muted-foreground">
                  {editing.lastOperator
                    ? `最近：${editing.lastOperator}${
                        editing.lastOperatedAt
                          ? ` · ${formatDateTime(editing.lastOperatedAt)}`
                          : ""
                      }`
                    : "暂无操作人"}
                </span>
              </div>
              {profileLogsLoading ? (
                <p className="text-xs text-muted-foreground">加载中…</p>
              ) : profileLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无记录（保存后开始记录）</p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {profileLogs.map((log) => {
                    const cfg = HR_LOG_ACTION_LABELS[log.action] || {
                      label: log.action,
                      color: "bg-gray-100 text-gray-700",
                    };
                    return (
                      <div key={log.id} className="rounded border px-2 py-1.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={cfg.color}>{cfg.label}</Badge>
                          <span className="font-medium">{log.operator || "未知"}</span>
                          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                          {log.summary}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            批量导入按档案表头：姓名、入职时间、司龄、转正日期、用工性质、合同主体、性别…企业邮箱。可先下载样表，选择文件后预览再确认导入。
            合同提醒取已填期次中到期最晚的一期。签署公司≠销售单位。
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

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) clearImportPreview();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>批量导入设置</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadImportSampleTemplate}
              >
                <Download className="mr-2 h-4 w-4" />
                下载导入样表
              </Button>
              <p className="text-xs text-muted-foreground">
                样表表头与档案表一致：姓名、入职时间、司龄、转正日期、用工性质、合同主体…企业邮箱。姓名须与人员管理一致。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>劳动合同签署公司</Label>
              <Select
                value={importOptions.laborCompanyId || "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    setImportOptions((prev) => ({
                      ...prev,
                      laborCompanyId: "",
                      laborCompanyName: "",
                    }));
                    return;
                  }
                  const company = laborCompanies.find((c) => c.id === v);
                  setImportOptions((prev) => ({
                    ...prev,
                    laborCompanyId: v,
                    laborCompanyName: company?.name || "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择签署公司" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不预设（按表格「合同主体」）</SelectItem>
                  {laborCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="mt-2"
                placeholder="或输入新公司名（可自动创建到字典）"
                value={importOptions.laborCompanyName}
                onChange={(e) => {
                  const name = e.target.value;
                  const matched = laborCompanies.find(
                    (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase(),
                  );
                  setImportOptions((prev) => ({
                    ...prev,
                    laborCompanyName: name,
                    laborCompanyId: matched?.id || "",
                  }));
                }}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={importOptions.preferSelectedLaborCompany}
                onCheckedChange={(v) =>
                  setImportOptions((prev) => ({
                    ...prev,
                    preferSelectedLaborCompany: Boolean(v),
                  }))
                }
              />
              <span>
                优先使用上方所选/填写的签署公司
                <span className="block text-xs text-muted-foreground">
                  勾选后覆盖表格中的「合同主体」列；不勾选则表格有值用表格，否则用所选。
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={importOptions.autoCreateLaborCompany}
                onCheckedChange={(v) =>
                  setImportOptions((prev) => ({
                    ...prev,
                    autoCreateLaborCompany: Boolean(v),
                  }))
                }
              />
              <span>
                自动创建/匹配签署公司名字
                <span className="block text-xs text-muted-foreground">
                  表格或输入的公司名若不在字典中，自动写入「劳动合同签署公司」字典。
                </span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label>在职 / 离职（整批）</Label>
              <Select
                value={importOptions.forceStatus}
                onValueChange={(v) =>
                  setImportOptions((prev) => ({
                    ...prev,
                    forceStatus: v as ImportForceStatus,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">按表格状态/离职日期</SelectItem>
                  <SelectItem value="active">全部按在职导入（清空离职日）</SelectItem>
                  <SelectItem value="inactive">全部按离职导入</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                导入离职表选「离职」，导入在职表选「在职」，可保证档案状态与人员管理一致。
              </p>
            </div>

            {importPreviewList.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">数据预览</span>
                    <span className="ml-2 text-muted-foreground">
                      {importFileName} · 共 {importPreviewList.length} 行 · 预计可匹配{" "}
                      {importPreviewList.filter((r) => r.matchOk).length} 行
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={importing}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    重新选择表格
                  </Button>
                </div>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">行</TableHead>
                        <TableHead>姓名</TableHead>
                        <TableHead>部门/单位</TableHead>
                        <TableHead>职位</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>入职</TableHead>
                        <TableHead>离职</TableHead>
                        <TableHead>合同主体</TableHead>
                        <TableHead>匹配预检</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreviewList.map((row) => (
                        <TableRow key={`${row.excelRow}-${row.name}`}>
                          <TableCell>{row.excelRow}</TableCell>
                          <TableCell>{row.name || "—"}</TableCell>
                          <TableCell>{row.unitName || "—"}</TableCell>
                          <TableCell>{row.position || "—"}</TableCell>
                          <TableCell>{row.status || "—"}</TableCell>
                          <TableCell>{row.hireDate || "—"}</TableCell>
                          <TableCell>{row.resignDate || "—"}</TableCell>
                          <TableCell>{row.laborCompany || "—"}</TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "text-xs",
                                row.matchOk ? "text-emerald-700" : "text-red-600",
                              )}
                            >
                              {row.matchHint}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  预检仅供参考；仍可确认导入。匹配失败的行会在导入结果中列出原因。
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                请先选择表格，系统会展示导入数据预览，确认后再写入。
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              disabled={importing}
              onClick={() => {
                setImportDialogOpen(false);
                clearImportPreview();
              }}
            >
              取消
            </Button>
            {importPreviewList.length === 0 ? (
              <Button
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="mr-2 h-4 w-4" />
                选择表格并预览
              </Button>
            ) : (
              <Button disabled={importing} onClick={() => void handleConfirmImport()}>
                <Upload className="mr-2 h-4 w-4" />
                {importing
                  ? "导入中…"
                  : `确认导入（${importPreviewList.length}）`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              人事档案操作记录
              <Badge variant="secondary">{allLogs.length} 条</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto py-2">
            {allLogsLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
            ) : allLogs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <History className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p>暂无操作记录</p>
              </div>
            ) : (
              allLogs.map((log) => {
                const cfg = HR_LOG_ACTION_LABELS[log.action] || {
                  label: log.action,
                  color: "bg-gray-100 text-gray-700",
                };
                return (
                  <div key={log.id} className="space-y-1 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={cfg.color}>{cfg.label}</Badge>
                      {log.profileName ? (
                        <span className="text-sm font-medium">{log.profileName}</span>
                      ) : null}
                      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">操作人：</span>
                      <span className="font-medium">{log.operator || "未知"}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {log.summary}
                    </p>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
