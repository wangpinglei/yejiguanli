// ===================== 类型定义 =====================

// 用户角色
export type UserRole =
  | "superadmin"
  | "group_admin" // 集团管理
  | "military_cadre" // 军工干部（只读）
  | "org_department" // 组织部（人员入离职 + 成本录入）
  | "unit_leader" // 单位负责人
  | "unit_manager"; // 单位管理员

// 销售单位（公司/部门/团队）
export interface SalesUnit {
  id: string;
  name: string;
  type: "company" | "department" | "team";
  address: string;
  contact: string;
  contactPhone: string;
  createdAt: string;
  description: string;
  // 角色分配
  groupAdminId?: string; // 集团管理
  militaryCadreId?: string; // 军工干部
  orgDeptId?: string; // 组织部
  unitLeaderId?: string; // 单位负责人
}

// 薪资结构（月薪 = 底薪 + 绩效 + 岗位补贴 + 管理提成 + 个人提成）
export interface SalaryStructure {
  // 底薪
  baseSalary: number;
  // 绩效
  performance: number;
  performanceCondition: string; // 绩效发放条件描述
  // 岗位补贴
  positionAllowance: number;
  positionAllowanceCondition: string; // 岗位补贴条件描述
  // 管理提成
  managementCommissionRate: number; // 管理提成比例（%）
  managementCommissionThreshold: number; // 管理提成起算门槛（团队销售额达到此值才开始计算）
  managementCommissionCondition: string; // 管理提成条件描述
  // 个人提成
  personalCommissionRate: number; // 个人提成比例（%）
  personalCommissionThreshold: number; // 个人提成起算门槛（个人销售额达到此值才开始计算）
  personalCommissionCondition: string; // 个人提成条件描述
}

// 人员
export interface Personnel {
  id: string;
  name: string;
  salesUnitId: string;
  position: string;
  phone: string;
  email: string;
  salary: SalaryStructure; // 薪资结构
  socialInsurance: number; // 社保（企业承担部分，月度 ¥）
  housingFund: number; // 公积金（企业承担部分，月度 ¥）
  hireDate: string; // 入职日期
  resignDate?: string; // 离职日期
  status: "active" | "inactive";
}

// 产品
export interface Product {
  id: string;
  name: string;
  category: string;
  salesUnitId?: string; // 默认归属销售单位（编辑产品时设定，用于结算分组与默认匹配）
  unitPrice: number;
  // 成本设置
  costType: "percentage" | "fixed"; // 成本方式：按售价百分比 / 固定金额
  unitCost: number; // 固定成本金额（¥），当 costType 为 fixed 时生效
  costRate: number; // 成本比例（%），当 costType 为 percentage 时生效（如 60 表示成本为售价的 60%）
  description: string;
  // 销售提成设置
  commissionType: "percentage" | "fixed"; // 提成方式：按销售额百分比 / 按件固定金额
  commissionRate: number; // 提成比例（%），当 commissionType 为 percentage 时生效
  commissionAmount: number; // 每件提成金额（¥），当 commissionType 为 fixed 时生效
  commissionNote: string; // 提成条件说明
  // 产品结算设置（实际结算收入，可能与售价不同）
  settlementType?: "percentage" | "fixed"; // 结算方式：按售价百分比 / 固定金额
  settlementRate?: number; // 结算比例（%），当 settlementType 为 percentage 时生效（如 80 表示结算为售价的 80%）
  settlementAmount?: number; // 每件结算金额（¥），当 settlementType 为 fixed 时生效
  settlementNote?: string; // 结算说明
}

// 销售记录
export interface SalesRecord {
  id: string;
  salesUnitId: string;
  personnelId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  saleDate: string;
  remark: string;
  // 生态圈同步标记
  synced?: boolean; // 是否来自生态圈同步
  externalOrderId?: string; // 生态圈订单号
  customerName?: string; // 客户名称
  salesUnitName?: string; // 销售单位名称（同步时可能未匹配到单位ID）
  salesPersonName?: string; // 销售人员姓名（同步时可能未匹配到人员ID）
  productName?: string; // 产品名称（同步时可能未匹配到产品ID）
  syncedAt?: string; // 同步时间
  // 批量导入扩展字段
  orderNumber?: string; // 订单编号
  productModule?: string; // 产品模块
  orderAmount?: number; // 订单金额（原价）
  orderType?: string; // 订单类型（新购/续费/升级等）
  activityName?: string; // 参加活动（如：小游戏风月庆）
}

// 生态圈同步的订单（后端存储格式）
export interface SyncedOrder {
  id: string;
  externalOrderId: string;
  synced: boolean;
  salesUnitId: string;
  salesUnitName: string;
  personnelId: string;
  salesPersonName: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  saleDate: string;
  customerName: string;
  remark: string;
  syncedAt: string;
  updatedAt?: string;
}

// 成本项（动态行）
export interface CostItem {
  id: string;
  category: string;
  amount: number;
  description: string;
}

// 成本记录
export interface CostRecord {
  id: string;
  salesUnitId: string;
  date: string;
  items: CostItem[];
  totalCost: number;
  remark: string;
  createdAt: string; // 录入时间
  createdBy?: string; // 录入人姓名
  changeReason?: string; // 最近一次变更原因
}

// 收入项（动态行，用于其他收入录入）
export interface IncomeItem {
  id: string;
  category: string;
  amount: number;
  description: string;
}

// 其他收入记录（非业绩收入）
export interface IncomeRecord {
  id: string;
  salesUnitId: string;
  date: string; // 录入日期（月度固定模式下表示起始日期）
  items: IncomeItem[];
  totalAmount: number;
  remark: string;
  createdAt: string;
  createdBy?: string;
  changeReason?: string;
  // 月度固定模式：录入一次自动按月生效
  isRecurring?: boolean; // 是否为月度固定收入
  recurringMonths?: number[]; // 适用月份（1-12），默认 [1,2,3,4,5,6,7,8,9,10,11,12]
  recurringStartDate?: string; // 月度固定起始日期（可选）
  recurringEndDate?: string; // 月度固定结束日期（可选）
}

// 收入结算记录（按单位×月度，记录预估与实际结算）
export interface RevenueSettlement {
  id: string;
  salesUnitId: string;
  yearMonth: string; // "2026-08"
  estimatedAmount: number; // 预估收入（自动从销售记录计算）
  actualAmount?: number; // 实际结算金额（手动纠正后填入）
  isAdjusted: boolean; // 是否已手动调整
  remark?: string; // 调整说明
  adjustedBy?: string; // 调整人
  adjustedAt?: string; // 调整时间
  createdAt: string;
}

// 单位×产品结算设置（每个销售单位对每个产品的结算比例/金额）
export interface UnitProductSettlement {
  id: string;
  salesUnitId: string;
  productId: string;
  settlementType: "percentage" | "fixed"; // 按售价百分比 / 固定金额
  settlementRate?: number; // 结算比例（%），当 settlementType 为 percentage 时生效
  settlementAmount?: number; // 每件结算金额（¥），当 settlementType 为 fixed 时生效
  note?: string; // 结算说明
  createdAt: string;
  updatedAt?: string;
}

// 单位×产品×人员提成设置（每个销售人员在不同产品上的管理/个人提成比例）
export interface ProductPersonCommission {
  id: string;
  salesUnitId: string;
  productId: string;
  personnelId: string;
  // 管理提成（按团队销售额计算）
  managementCommissionRate: number; // %
  managementCommissionThreshold: number; // 起算门槛 ¥
  managementCommissionCondition: string; // 条件描述
  // 个人提成（按个人销售额计算）
  personalCommissionRate: number; // %
  personalCommissionThreshold: number; // 起算门槛 ¥
  personalCommissionCondition: string; // 条件描述
  createdAt: string;
  updatedAt?: string;
}

// 成本变更日志
export interface CostChangeLog {
  id: string;
  costRecordId: string;
  action: "create" | "update" | "delete";
  reason: string; // 变更原因
  operator: string; // 操作人姓名
  operatorId: string; // 操作人ID
  timestamp: string; // 变更时间
  summary: string; // 变更摘要
  costRecordRemark?: string; // 成本记录备注（便于识别）
}

// 系统通知
export interface AppNotification {
  id: string;
  type: "cost_change";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

// 月度人员调整（请假扣款、其他加项/减项）
export interface MonthlyAdjustment {
  id: string;
  personnelId: string;
  yearMonth: string; // "2026-08"
  leaveDays: number; // 请假天数
  otherBonus: number; // 其他加项（奖金等）
  otherDeduction: number; // 其他减项（罚款等）
  note: string; // 备注
  createdAt: string;
  createdBy?: string;
}

// 月度业绩目标（战报表用）
export interface PerformanceTarget {
  id: string;
  salesUnitId: string; // 销售单位
  yearMonth: string; // "2026-08"
  personnelId?: string; // 为空表示单位整体目标
  targetAmount: number; // 目标金额
  note: string; // 备注
  createdAt: string;
  createdBy?: string;
}

// 岗位分组标签（战报中按岗位匹配的备注徽章）
export interface PositionGroupLabel {
  id: string;
  // 岗位关键词（任意一个匹配即生效，不区分大小写，支持"包含"匹配）
  keyword: string;
  // 战报表中显示的标签文字
  label: string;
  // 颜色主题：gray / blue / violet / orange / red / emerald
  color: string;
  // 备注说明（用于配置列表展示）
  description?: string;
  createdAt: string;
}

// 仪表盘统计
export interface DashboardStats {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMargin: number;
  totalUnits: number;
  totalPersonnel: number;
  totalSales: number;
  activePersonnel: number;
}

// 月度趋势数据
export interface MonthlyTrend {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
}
