import type { SalaryStructure, SalesRecord, Personnel, Product, MonthlyAdjustment } from "@/types";

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
  return records.filter((s) => s.saleDate.startsWith(yearMonth));
}

/**
 * 计算个人销售额（给定销售记录）
 */
export function getPersonalSales(
  personId: string,
  salesRecords: SalesRecord[]
): number {
  return salesRecords
    .filter((s) => s.personnelId === personId)
    .reduce((sum, s) => sum + s.totalAmount, 0);
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
 * 计算管理提成金额
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
 * 计算个人提成金额
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
 * 月薪 = 底薪 + 绩效 + 岗位补贴 + 管理提成 + 个人提成 + 产品提成 - 请假扣款 + 其他加项 - 其他减项
 *
 * @param yearMonth 可选，按月过滤销售记录
 * @param adjustment 可选，月度调整（请假天数、其他加减项）
 */
export function calculateMonthlySalary(
  person: Personnel,
  salesRecords: SalesRecord[],
  products: Product[] = [],
  yearMonth?: string,
  adjustment?: MonthlyAdjustment
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
} {
  // 按月过滤销售记录
  const monthlyRecords = filterByMonth(salesRecords, yearMonth);

  const s = person.salary;
  const personalSales = getPersonalSales(person.id, monthlyRecords);
  const teamSales = getTeamSales(person.salesUnitId, monthlyRecords);

  const managementCommission = calcManagementCommission(s, teamSales);
  const personalCommission = calcPersonalCommission(s, personalSales);
  const productCommission = getPersonProductCommission(person.id, monthlyRecords, products);

  const leaveDeduction = adjustment
    ? calcLeaveDeduction(s.baseSalary, adjustment.leaveDays || 0)
    : 0;
  const otherBonus = adjustment?.otherBonus || 0;
  const otherDeduction = adjustment?.otherDeduction || 0;

  const total =
    s.baseSalary +
    s.performance +
    s.positionAllowance +
    managementCommission +
    personalCommission +
    productCommission -
    leaveDeduction +
    otherBonus -
    otherDeduction;

  return {
    baseSalary: s.baseSalary,
    performance: s.performance,
    positionAllowance: s.positionAllowance,
    managementCommission,
    personalCommission,
    productCommission,
    leaveDeduction,
    otherBonus,
    otherDeduction,
    total,
  };
}

/**
 * 计算固定部分月薪（底薪 + 绩效 + 岗位补贴，不含提成）
 */
export function getFixedSalary(salary: SalaryStructure): number {
  return salary.baseSalary + salary.performance + salary.positionAllowance;
}

// ===================== 薪酬成本汇总（含社保公积金） =====================

export interface UnitSalaryCost {
  unitId: string;
  activeCount: number;
  totalSalary: number; // 薪酬合计（不含社保公积金）
  totalSocialInsurance: number; // 社保合计
  totalHousingFund: number; // 公积金合计
  totalProductCommission: number; // 产品销售提成合计
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
 */
export function getUnitSalaryCost(
  unitId: string,
  personnel: Personnel[],
  salesRecords: SalesRecord[],
  products: Product[] = [],
  yearMonth?: string,
  monthlyAdjustments: MonthlyAdjustment[] = []
): UnitSalaryCost {
  const activeMembers = personnel.filter(
    (p) => p.salesUnitId === unitId && p.status === "active"
  );

  const details = activeMembers.map((p) => {
    const adj = monthlyAdjustments.find(
      (a) => a.personnelId === p.id && a.yearMonth === yearMonth
    );
    const calc = calculateMonthlySalary(p, salesRecords, products, yearMonth, adj);
    const socialInsurance = p.socialInsurance || 0;
    const housingFund = p.housingFund || 0;
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
 */
export function getTotalSalaryCost(
  unitIds: string[],
  personnel: Personnel[],
  salesRecords: SalesRecord[],
  products: Product[] = [],
  yearMonth?: string,
  monthlyAdjustments: MonthlyAdjustment[] = []
): {
  units: UnitSalaryCost[];
  grandTotal: number;
  grandSalary: number;
  grandSocialInsurance: number;
  grandHousingFund: number;
  grandProductCommission: number;
  grandLeaveDeduction: number;
  grandOtherAdjustment: number;
} {
  const units = unitIds.map((id) =>
    getUnitSalaryCost(id, personnel, salesRecords, products, yearMonth, monthlyAdjustments)
  );
  const grandTotal = units.reduce((sum, u) => sum + u.totalCost, 0);
  const grandSalary = units.reduce((sum, u) => sum + u.totalSalary, 0);
  const grandSocialInsurance = units.reduce((sum, u) => sum + u.totalSocialInsurance, 0);
  const grandHousingFund = units.reduce((sum, u) => sum + u.totalHousingFund, 0);
  const grandProductCommission = units.reduce((sum, u) => sum + u.totalProductCommission, 0);
  const grandLeaveDeduction = units.reduce((sum, u) => sum + u.totalLeaveDeduction, 0);
  const grandOtherAdjustment = units.reduce((sum, u) => sum + u.totalOtherAdjustment, 0);
  return {
    units,
    grandTotal,
    grandSalary,
    grandSocialInsurance,
    grandHousingFund,
    grandProductCommission,
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
