import { calcSaleCommissionReward } from "@/lib/commissionReward";
import {
  isDistributionDay,
  resolvePayForMonth,
  resolvePpcListForSaleDate,
} from "@/lib/compensation";
import { getPersonTeamMgmtCommission } from "@/lib/teamMgmtCommission";
import {
  getUnitFixedPayRatioInMonth,
  personBelongsToUnitInMonth,
} from "@/lib/unitAssignment";
import type {
  SalaryStructure,
  SalesRecord,
  Personnel,
  Product,
  MonthlyAdjustment,
  ProductPersonCommission,
  TeamMgmtCommissionRule,
  PerformanceTarget,
  UnitProductSettlement,
} from "@/types";

/** 团队管理提成计算上下文（传入后用人头分摊替代旧管理提成） */
export type TeamMgmtSalaryContext = {
  rules: TeamMgmtCommissionRule[];
  targets: PerformanceTarget[];
  upsList: UnitProductSettlement[];
};

// 每月法定计薪天数（中国劳动法标准）
export const MONTHLY_WORK_DAYS = 21.75;

// 默认空薪资结构
export const EMPTY_SALARY: SalaryStructure = {
  baseSalary: 0,
  performance: 0,
  performanceCondition: "",
  positionAllowance: 0,
  positionAllowanceCondition: "",
  managementCommissionRate: 0,
  managementCommissionThreshold: 0,
  managementCommissionCondition: "",
  personalCommissionRate: 0,
  personalCommissionThreshold: 0,
  personalCommissionCondition: "",
};

/**
 * 按年月过滤销售记录
 * yearMonth 格式: "2026-08"
 */
export function filterByMonth(records: SalesRecord[], yearMonth?: string): SalesRecord[] {
  if (!yearMonth) return records;
  return records.filter((s) => (s.saleDate || "").startsWith(yearMonth));
}

/** 某年月的起止日期 YYYY-MM-DD */
function getYearMonthRange(yearMonth: string): { start: string; end: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * 判断人员在指定月份是否应计入人力成本 / 提成
 * - 有 yearMonth：按入职/离职日落在该月是否在岗（不依赖 status 字段）
 * - 无 yearMonth：与人员管理「在岗」一致（离职日未到 or status 非 inactive）
 */
export function isPersonnelOnDutyInMonth(
  person: { hireDate?: string; resignDate?: string; status?: string },
  yearMonth?: string,
): boolean {
  const hire = (person.hireDate || "").slice(0, 10);
  const resign = (person.resignDate || "").slice(0, 10);

  if (yearMonth) {
    const { start, end } = getYearMonthRange(yearMonth);
    if (hire && hire > end) return false;
    // 离职日早于当月 1 日 → 当月不计
    if (resign && resign < start) return false;
    return true;
  }

  if (resign) {
    const today = new Date().toISOString().slice(0, 10);
    return resign >= today;
  }
  return person.status !== "inactive";
}

/**
 * 计算个人销售额（给定销售记录）
 * 优先按 personnelId；无 id 时按销售人员姓名匹配（导入/同步未挂人员时）
 */
export function getPersonalSales(
  personId: string,
  salesRecords: SalesRecord[],
  personName?: string
): number {
  const name = (personName || "").trim();
  return salesRecords
    .filter((s) => {
      if (s.personnelId === personId) return true;
      if (!s.personnelId && name && (s.salesPersonName || "").trim() === name) {
        return true;
      }
      return false;
    })
    .reduce((sum, s) => sum + s.totalAmount, 0);
}

/** 非销售岗位关键词（命中则战报一定不展示；「销售」开头的岗位优先放行） */
const NON_SALES_POSITION_KEYWORDS = [
  "组织部",
  "组织",
  "售后",
  "人事",
  "财务",
  "行政",
  "后勤",
  "客服",
  "技术支持",
  "研发",
  "运维",
  "产品运营",
  "设计师",
  "法务",
  "军工",
] as const;

/** 销售相关岗位关键词（白名单：必须命中才展示） */
const SALES_POSITION_KEYWORDS = [
  "销售",
  "顾问",
  "业务员",
  "业务经理",
  "客户经理",
  "外援",
] as const;

/**
 * 是否应作为「销售相关岗位」进入战报名单
 * 规则：含「销售」→ 是；命中非销售词 → 否；否则必须命中销售相关词
 * 注意：有当月业绩的非销售岗仍应进战报，见 shouldShowOnBattleReport
 */
export function isSalesBattlePosition(position?: string): boolean {
  const pos = (position || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!pos) return false;
  // 含「销售」优先视为销售岗
  if (pos.includes("销售")) return true;
  if (NON_SALES_POSITION_KEYWORDS.some((k) => pos.includes(k.toLowerCase()))) {
    return false;
  }
  return SALES_POSITION_KEYWORDS.some((k) => pos.includes(k.toLowerCase()));
}

/**
 * 是否出现在单位战报：销售相关岗位，或当月本单位有个人业绩（如服务中心等）
 */
export function shouldShowOnBattleReport(
  person: { id: string; name: string; position?: string },
  monthUnitSales: SalesRecord[],
): boolean {
  if (isSalesBattlePosition(person.position)) return true;
  return getPersonalSales(person.id, monthUnitSales, person.name) > 0;
}

/**
 * 人员在指定年月是否处于「在职期间」
 * - 入职日晚于该月最后一天 → 未入职
 * - 离职日早于该月第一天 → 已离职
 * - 有离职日且离职日落在该月或之后 → 该月仍算在职（含月中离职）
 * - 无离职日但 status=inactive → 不按在职算（由调用方结合当月业绩兜底）
 */
export function wasEmployedInMonth(
  person: { hireDate?: string; resignDate?: string; status?: string },
  yearMonth: string
): boolean {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return person.status !== "inactive";
  const [y, m] = yearMonth.split("-").map(Number);
  const monthStart = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

  const hire = (person.hireDate || "").slice(0, 10);
  const resign = (person.resignDate || "").slice(0, 10);

  if (hire && hire > monthEnd) return false;
  if (resign) return resign >= monthStart;
  if (person.status === "inactive") return false;
  return true;
}

/**
 * 计算团队销售额（给定单位下所有人员的销售记录）
 */
export function getTeamSales(
  salesUnitId: string,
  salesRecords: SalesRecord[]
): number {
  return salesRecords
    .filter((s) => s.salesUnitId === salesUnitId)
    .reduce((sum, s) => sum + s.totalAmount, 0);
}

/**
 * 计算管理提成金额（原始，基于人员默认薪资结构）
 * = max(0, 团队销售额 - 起算门槛) x 管理提成比例 / 100
 */
export function calcManagementCommission(
  salary: SalaryStructure,
  teamSales: number
): number {
  if (teamSales <= salary.managementCommissionThreshold) return 0;
  return (
    (teamSales - salary.managementCommissionThreshold) *
    (salary.managementCommissionRate / 100)
  );
}

/**
 * 计算个人提成金额（原始，基于人员默认薪资结构）
 * = max(0, 个人销售额 - 起算门槛) x 个人提成比例 / 100
 */
export function calcPersonalCommission(
  salary: SalaryStructure,
  personalSales: number
): number {
  if (personalSales <= salary.personalCommissionThreshold) return 0;
  return (
    (personalSales - salary.personalCommissionThreshold) *
    (salary.personalCommissionRate / 100)
  );
}

/**
 * 按产品逐个计算管理提成（优先使用产品级配置，fallback 到默认薪资）
 * 遍历该人员本月有销售记录的每个产品：
 *   - 若存在 ProductPersonConfig（单位×产品×人员），用该产品的专属比例/门槛
 *   - 否则 fallback 到人员默认 SalaryStructure 的统一设置
 */
export function calcManagementCommissionByProduct(
  person: Personnel,
  monthlyRecords: SalesRecord[],
  _products: Product[],
  ppcList: ProductPersonCommission[]
): number {
  const s = person.salary || EMPTY_SALARY;
  // 找出该人员本月涉及的所有产品 ID
  const productIds = new Set(monthlyRecords.filter((r) => r.personnelId === person.id).map((r) => r.productId));
  // 也加上所有产品（用于计算团队销售额中各产品的占比）
  // const allProductIds = new Set(monthlyRecords.map((r) => r.productId));

  let totalMgmt = 0;

  // 对每个有专属配置的产品，用产品级参数计算
  const configuredProducts = new Set<string>();
  ppcList
    .filter((ppc) => ppc.personnelId === person.id && ppc.salesUnitId === person.salesUnitId)
    .forEach((ppc) => {
      if (!productIds.has(ppc.productId)) return; // 该人本月没卖这个产品
      configuredProducts.add(ppc.productId);
      // 管理提成：基于该产品在团队中的销售额
      const productTeamSales = monthlyRecords
        .filter((r) => r.productId === ppc.productId && r.salesUnitId === person.salesUnitId)
        .reduce((sum, r) => sum + r.totalAmount, 0);
      if (productTeamSales > (ppc.managementCommissionThreshold || 0)) {
        totalMgmt += (productTeamSales - ppc.managementCommissionThreshold) * (ppc.managementCommissionRate / 100);
      }
    });

  // 对于没有专属配置的产品，用默认薪资结构的统一参数（按剩余团队销售额计算）
  const unconfiguredTeamSales = monthlyRecords
    .filter((r) => !configuredProducts.has(r.productId) && r.salesUnitId === person.salesUnitId)
    .reduce((sum, r) => sum + r.totalAmount, 0);
  if (unconfiguredTeamSales > (s.managementCommissionThreshold || 0) && (s.managementCommissionRate || 0) > 0) {
    totalMgmt += (unconfiguredTeamSales - s.managementCommissionThreshold) * (s.managementCommissionRate / 100);
  }

  return totalMgmt;
}

/**
 * 按产品逐个计算个人提成（优先使用产品级配置，fallback 到默认薪资）
 * - 若人员启用了分销分段：按每笔成交日选择「常规快照」或「当前分销」提成配置
 * - percentage: max(0, 销售额 - 门槛) × 比例%（同一方案内按月汇总门槛）
 * - fixed: 销售数量 × 每件提成金额
 * - 另加：特殊时段按件奖励（rewardAmount × 数量，按销售日匹配区间）
 */
export function calcPersonalCommissionByProduct(
  person: Personnel,
  monthlyRecords: SalesRecord[],
  _products: Product[],
  ppcList: ProductPersonCommission[]
): number {
  const personRecords = monthlyRecords.filter((r) => r.personnelId === person.id);
  if (personRecords.length === 0) return 0;

  // 按「常规 / 分销」拆开，各自汇总门槛，避免跨段混算
  const regularRecords: SalesRecord[] = [];
  const distributionRecords: SalesRecord[] = [];
  for (const r of personRecords) {
    if (isDistributionDay(person, r.saleDate || "")) distributionRecords.push(r);
    else regularRecords.push(r);
  }

  let total = 0;
  if (regularRecords.length > 0) {
    total += calcPersonalCommissionForRecords(
      person,
      regularRecords,
      resolvePpcListForSaleDate(
        person,
        regularRecords[0]?.saleDate || "1900-01-01",
        ppcList,
      ),
      true,
    );
  }
  if (distributionRecords.length > 0) {
    total += calcPersonalCommissionForRecords(
      person,
      distributionRecords,
      resolvePpcListForSaleDate(
        person,
        distributionRecords[0]?.saleDate || "9999-12-31",
        ppcList,
      ),
      false,
    );
  }
  return total;
}

function calcPersonalCommissionForRecords(
  person: Personnel,
  personRecords: SalesRecord[],
  personPpcList: ProductPersonCommission[],
  useRegularSalaryFallback: boolean,
): number {
  if (personRecords.length === 0) return 0;

  const s = useRegularSalaryFallback
    ? (person.regularCompensation?.salary || person.salary || EMPTY_SALARY)
    : (person.salary || EMPTY_SALARY);

  let totalPersonal = 0;

  const productSalesMap = new Map<string, number>();
  const productQtyMap = new Map<string, number>();
  personRecords.forEach((r) => {
    productSalesMap.set(r.productId, (productSalesMap.get(r.productId) || 0) + r.totalAmount);
    productQtyMap.set(r.productId, (productQtyMap.get(r.productId) || 0) + (r.quantity || 0));
  });

  const configuredProducts = new Set<string>();
  const saleUnitIds = new Set(personRecords.map((r) => r.salesUnitId).filter(Boolean));
  const scopedPpc = personPpcList.filter(
    (ppc) =>
      ppc.personnelId === person.id &&
      (ppc.salesUnitId === person.salesUnitId || saleUnitIds.has(ppc.salesUnitId)),
  );

  const productUnitKeys = new Map<string, Set<string>>();
  personRecords.forEach((r) => {
    if (!r.productId) return;
    if (!productUnitKeys.has(r.productId)) productUnitKeys.set(r.productId, new Set());
    if (r.salesUnitId) productUnitKeys.get(r.productId)!.add(r.salesUnitId);
  });

  productUnitKeys.forEach((unitIds, productId) => {
    unitIds.forEach((unitId) => {
      const ppc = scopedPpc.find(
        (x) => x.productId === productId && x.salesUnitId === unitId,
      ) || scopedPpc.find(
        (x) => x.productId === productId && x.salesUnitId === person.salesUnitId,
      );
      if (!ppc) return;

      const unitRecords = personRecords.filter(
        (r) => r.productId === productId && r.salesUnitId === unitId,
      );
      const sales = unitRecords.reduce((sum, r) => sum + r.totalAmount, 0);
      const qty = unitRecords.reduce((sum, r) => sum + (r.quantity || 0), 0);
      if (sales <= 0 && qty <= 0) return;
      configuredProducts.add(productId);
      if (ppc.personalCommissionType === "fixed") {
        totalPersonal += qty * (ppc.personalCommissionAmount || 0);
        return;
      }
      if (sales > (ppc.personalCommissionThreshold || 0)) {
        totalPersonal +=
          (sales - ppc.personalCommissionThreshold) * (ppc.personalCommissionRate / 100);
      }
    });
  });

  let unconfiguredSales = 0;
  productSalesMap.forEach((sales, pid) => {
    if (!configuredProducts.has(pid)) unconfiguredSales += sales;
  });
  if (unconfiguredSales > (s.personalCommissionThreshold || 0) && (s.personalCommissionRate || 0) > 0) {
    totalPersonal += (unconfiguredSales - s.personalCommissionThreshold) * (s.personalCommissionRate / 100);
  }

  for (const r of personRecords) {
    const ppc = scopedPpc.find(
      (x) => x.productId === r.productId && x.salesUnitId === r.salesUnitId,
    ) || scopedPpc.find((x) => x.productId === r.productId);
    totalPersonal += calcSaleCommissionReward(r, ppc);
  }

  return totalPersonal;
}

/**
 * 计算请假扣款
 * 日薪 = 底薪 / 21.75
 * 扣款 = 日薪 x 请假天数
 */
export function calcLeaveDeduction(baseSalary: number, leaveDays: number): number {
  if (leaveDays <= 0) return 0;
  return (baseSalary / MONTHLY_WORK_DAYS) * leaveDays;
}

/**
 * 计算实际月薪（含动态提成、请假扣款、月度调整）
 * 月薪 = 底薪 + 绩效 + 岗位补贴 + 管理提成 + 个人提成 - 请假扣款 + 其他加项 - 其他减项
 * （已不再计入旧「产品级销售提成」）
 *
 * @param yearMonth 可选，按月过滤销售记录
 * @param adjustment 可选，月度调整（请假天数、其他加减项）
 */
export function calculateMonthlySalary(
  person: Personnel,
  salesRecords: SalesRecord[],
  products: Product[] = [],
  yearMonth?: string,
  adjustment?: MonthlyAdjustment,
  productPersonCommissions?: ProductPersonCommission[],
  teamMgmtContext?: TeamMgmtSalaryContext,
  forUnitId?: string,
): {
  baseSalary: number;
  performance: number;
  positionAllowance: number;
  managementCommission: number;
  personalCommission: number;
  productCommission: number;
  leaveDeduction: number;
  otherBonus: number;
  otherDeduction: number;
  total: number;
  socialInsurance: number;
  housingFund: number;
  fixedRatio: number;
} {
  // 按月过滤销售记录
  const monthlyRecords = filterByMonth(salesRecords, yearMonth);

  const pay = yearMonth
    ? resolvePayForMonth(person, yearMonth)
    : {
        salary: person.salary || EMPTY_SALARY,
        socialInsurance: person.socialInsurance || 0,
        housingFund: person.housingFund || 0,
        isDistribution: false,
        fixedRatio: 1,
      };
  const s = pay.salary || EMPTY_SALARY;
  let fixedRatio = Number.isFinite(pay.fixedRatio) ? pay.fixedRatio : 1;
  // 按单位归属时间轴切分固定人力成本
  if (forUnitId && yearMonth) {
    fixedRatio = getUnitFixedPayRatioInMonth(person, forUnitId, yearMonth);
  }
  const personalSales = getPersonalSales(person.id, monthlyRecords, person.name);

  // 个人提成：优先产品×单位×人员配置（按成交日分段）
  const usePpc = productPersonCommissions !== undefined;
  const personalCommission = usePpc
    ? calcPersonalCommissionByProduct(person, monthlyRecords, products, productPersonCommissions)
    : calcPersonalCommission(s, personalSales);

  // 管理提成：仅团队规则分摊；未传上下文则为 0（停用旧每人×产品管理提成）
  const mgmtUnitId = forUnitId || person.salesUnitId;
  const managementCommission = teamMgmtContext && yearMonth
    ? getPersonTeamMgmtCommission(
        person.id,
        mgmtUnitId,
        yearMonth,
        salesRecords,
        teamMgmtContext.upsList,
        teamMgmtContext.targets,
        teamMgmtContext.rules,
      )
    : 0;

  // 旧产品级提成已废弃
  const productCommission = 0;

  const baseSalary = (s.baseSalary || 0) * fixedRatio;
  const performance = (s.performance || 0) * fixedRatio;
  const positionAllowance = (s.positionAllowance || 0) * fixedRatio;

  const leaveDeduction = adjustment
    ? calcLeaveDeduction(s.baseSalary, adjustment.leaveDays || 0)
    : 0;
  const otherBonus = adjustment?.otherBonus || 0;
  const otherDeduction = adjustment?.otherDeduction || 0;

  const total =
    baseSalary +
    performance +
    positionAllowance +
    managementCommission +
    personalCommission -
    leaveDeduction +
    otherBonus -
    otherDeduction;

  return {
    baseSalary,
    performance,
    positionAllowance,
    managementCommission,
    personalCommission,
    productCommission,
    leaveDeduction,
    otherBonus,
    otherDeduction,
    total,
    socialInsurance: (pay.socialInsurance || 0) * fixedRatio,
    housingFund: (pay.housingFund || 0) * fixedRatio,
    fixedRatio,
  };
}

/**
 * 计算固定部分月薪（底薪 + 绩效 + 岗位补贴，不含提成）
 */
export function getFixedSalary(salary: SalaryStructure): number {
  const s = salary || EMPTY_SALARY;
  return (Number(s.baseSalary) || 0)
    + (Number(s.performance) || 0)
    + (Number(s.positionAllowance) || 0);
}

// ===================== 薪酬成本汇总（含社保公积金） =====================

export interface UnitSalaryCost {
  unitId: string;
  activeCount: number;
  totalSalary: number; // 薪酬合计（不含社保公积金）
  totalSocialInsurance: number; // 社保合计
  totalHousingFund: number; // 公积金合计
  totalProductCommission: number; // 产品销售提成合计（产品级，已逐步废弃）
  totalSalesCommission: number; // 销售提成合计 = 管理提成 + 个人提成（单位×人员）
  totalLeaveDeduction: number; // 请假扣款合计
  totalOtherAdjustment: number; // 其他调整净额合计
  totalCost: number; // 总人力成本 = 薪酬 + 社保 + 公积金
  details: {
    personId: string;
    name: string;
    position: string;
    baseSalary: number;
    performance: number;
    positionAllowance: number;
    managementCommission: number;
    personalCommission: number;
    productCommission: number;
    leaveDeduction: number;
    otherBonus: number;
    otherDeduction: number;
    salaryTotal: number; // 薪酬小计
    socialInsurance: number;
    housingFund: number;
    total: number; // 含社保公积金的总成本
    adjustment?: MonthlyAdjustment;
  }[];
}

/**
 * 计算某个销售单位的在职人员薪酬总成本（含社保公积金）
 * @param yearMonth 可选，按月过滤销售记录
 * @param monthlyAdjustments 可选，月度调整列表
 * @param productPersonCommissions 可选，产品×单位×人员提成（成本管理配置）；传入后个人/管理提成按此计算
 */
export function getUnitSalaryCost(
  unitId: string,
  personnel: Personnel[],
  salesRecords: SalesRecord[],
  products: Product[] = [],
  yearMonth?: string,
  monthlyAdjustments: MonthlyAdjustment[] = [],
  productPersonCommissions?: ProductPersonCommission[],
  teamMgmtContext?: TeamMgmtSalaryContext,
): UnitSalaryCost {
  const monthlySales = filterByMonth(salesRecords, yearMonth);
  // 当月在该单位有成交的人员（销售记录侧），避免「有提成预估但成本为 0」
  const salesPersonIdSet = new Set(
    monthlySales
      .filter((r) => r.salesUnitId === unitId && r.personnelId)
      .map((r) => r.personnelId),
  );

  const memberMap = new Map<string, Personnel>();
  personnel.forEach((p) => {
    const belongsUnit = yearMonth
      ? personBelongsToUnitInMonth(p, unitId, yearMonth)
      : p.salesUnitId === unitId;
    const hasSalesHere = salesPersonIdSet.has(p.id);
    if (!belongsUnit && !hasSalesHere) return;
    // 本单位成员：按月在岗；仅因有销售挂进来的：始终计入（保证提成进成本）
    if (belongsUnit && !isPersonnelOnDutyInMonth(p, yearMonth) && !hasSalesHere) return;
    memberMap.set(p.id, p);
  });
  const activeMembers = Array.from(memberMap.values());

  const details = activeMembers.map((p) => {
    const adj = monthlyAdjustments.find(
      (a) => a.personnelId === p.id && a.yearMonth === yearMonth
    );
    // 提成只认本单位成交；固定成本按归属时间轴切到本单位
    const unitSalesRecords = salesRecords.filter((r) => r.salesUnitId === unitId);
    const calc = calculateMonthlySalary(
      p,
      unitSalesRecords,
      products,
      yearMonth,
      adj,
      productPersonCommissions,
      teamMgmtContext,
      unitId,
    );
    const socialInsurance = calc.socialInsurance;
    const housingFund = calc.housingFund;
    const total = calc.total + socialInsurance + housingFund;
    return {
      personId: p.id,
      name: p.name,
      position: p.position,
      baseSalary: calc.baseSalary,
      performance: calc.performance,
      positionAllowance: calc.positionAllowance,
      managementCommission: calc.managementCommission,
      personalCommission: calc.personalCommission,
      productCommission: calc.productCommission,
      leaveDeduction: calc.leaveDeduction,
      otherBonus: calc.otherBonus,
      otherDeduction: calc.otherDeduction,
      salaryTotal: calc.total,
      socialInsurance,
      housingFund,
      total,
      adjustment: adj,
    };
  });

  const totalSalary = details.reduce((sum, d) => sum + d.salaryTotal, 0);
  const totalSocialInsurance = details.reduce((sum, d) => sum + d.socialInsurance, 0);
  const totalHousingFund = details.reduce((sum, d) => sum + d.housingFund, 0);
  const totalProductCommission = details.reduce((sum, d) => sum + d.productCommission, 0);
  const totalSalesCommission = details.reduce(
    (sum, d) => sum + d.managementCommission + d.personalCommission,
    0
  );
  const totalLeaveDeduction = details.reduce((sum, d) => sum + d.leaveDeduction, 0);
  const totalOtherAdjustment = details.reduce((sum, d) => sum + d.otherBonus - d.otherDeduction, 0);
  const totalCost = totalSalary + totalSocialInsurance + totalHousingFund;

  return {
    unitId,
    activeCount: activeMembers.length,
    totalSalary,
    totalSocialInsurance,
    totalHousingFund,
    totalProductCommission,
    totalSalesCommission,
    totalLeaveDeduction,
    totalOtherAdjustment,
    totalCost,
    details,
  };
}

/**
 * 计算多个销售单位的薪酬总成本（含社保公积金）
 * @param yearMonth 可选，按月过滤销售记录
 * @param monthlyAdjustments 可选，月度调整列表
 * @param productPersonCommissions 可选，产品×单位×人员提成配置
 */
export function getTotalSalaryCost(
  unitIds: string[],
  personnel: Personnel[],
  salesRecords: SalesRecord[],
  products: Product[] = [],
  yearMonth?: string,
  monthlyAdjustments: MonthlyAdjustment[] = [],
  productPersonCommissions?: ProductPersonCommission[],
  teamMgmtContext?: TeamMgmtSalaryContext,
): {
  units: UnitSalaryCost[];
  grandTotal: number;
  /** 薪酬成本（不含社保公积金） */
  grandSalary: number;
  grandSocialInsurance: number;
  grandHousingFund: number;
  /** 社保公积金成本 = 社保 + 公积金 */
  grandSocialHousingFund: number;
  grandProductCommission: number;
  grandSalesCommission: number;
  grandLeaveDeduction: number;
  grandOtherAdjustment: number;
} {
  const units = unitIds.map((id) =>
    getUnitSalaryCost(
      id,
      personnel,
      salesRecords,
      products,
      yearMonth,
      monthlyAdjustments,
      productPersonCommissions,
      teamMgmtContext,
    )
  );
  const grandTotal = units.reduce((sum, u) => sum + u.totalCost, 0);
  const grandSalary = units.reduce((sum, u) => sum + u.totalSalary, 0);
  const grandSocialInsurance = units.reduce((sum, u) => sum + u.totalSocialInsurance, 0);
  const grandHousingFund = units.reduce((sum, u) => sum + u.totalHousingFund, 0);
  /** 社保 + 公积金（与薪酬成本分列） */
  const grandSocialHousingFund = grandSocialInsurance + grandHousingFund;
  const grandProductCommission = units.reduce((sum, u) => sum + u.totalProductCommission, 0);
  const grandSalesCommission = units.reduce((sum, u) => sum + u.totalSalesCommission, 0);
  const grandLeaveDeduction = units.reduce((sum, u) => sum + u.totalLeaveDeduction, 0);
  const grandOtherAdjustment = units.reduce((sum, u) => sum + u.totalOtherAdjustment, 0);
  return {
    units,
    grandTotal,
    /** 薪酬成本（底薪/绩效/补贴/提成/请假与其他调整，不含社保公积金） */
    grandSalary,
    grandSocialInsurance,
    grandHousingFund,
    grandSocialHousingFund,
    grandProductCommission,
    grandSalesCommission,
    grandLeaveDeduction,
    grandOtherAdjustment,
  };
}

// ===================== 产品成本计算 =====================

/**
 * 计算产品的实际单位成本
 * - fixed: 直接返回 unitCost
 * - percentage: 返回 unitPrice x costRate / 100
 */
export function calcUnitCost(product: Product): number {
  if (product.costType === "percentage") {
    return product.unitPrice * ((product.costRate || 0) / 100);
  }
  return product.unitCost || 0;
}

// ===================== 产品销售提成计算 =====================

/**
 * 计算单笔销售记录的产品提成
 * - percentage: 提成 = 销售总额 x 提成比例 / 100
 * - fixed: 提成 = 销售数量 x 每件提成金额
 */
export function calcProductCommission(
  product: Product | undefined,
  quantity: number,
  totalAmount: number
): number {
  if (!product) return 0;
  if (product.commissionType === "fixed") {
    return quantity * (product.commissionAmount || 0);
  }
  // percentage
  return totalAmount * ((product.commissionRate || 0) / 100);
}

/**
 * 计算全部销售记录的产品提成总额
 */
export function getTotalProductCommission(
  salesRecords: SalesRecord[],
  products: Product[]
): number {
  return salesRecords.reduce((sum, s) => {
    const product = products.find((p) => p.id === s.productId);
    return sum + calcProductCommission(product, s.quantity, s.totalAmount);
  }, 0);
}

/**
 * 按销售单位计算产品提成
 */
export function getUnitProductCommission(
  salesUnitId: string,
  salesRecords: SalesRecord[],
  products: Product[]
): number {
  const unitSales = salesRecords.filter((s) => s.salesUnitId === salesUnitId);
  return getTotalProductCommission(unitSales, products);
}

/**
 * 按销售人员计算产品提成
 */
export function getPersonProductCommission(
  personId: string,
  salesRecords: SalesRecord[],
  products: Product[]
): number {
  const personSales = salesRecords.filter((s) => s.personnelId === personId);
  return getTotalProductCommission(personSales, products);
}
