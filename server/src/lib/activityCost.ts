/** 活动默认成本扣除（服务端：新建/新同步时固化） */

import { normalizeSaleDate } from "./saleDate";

export type ActivityCostType = "fixed" | "percentage";

export type ActivityCostRuleRow = {
  activityName: string;
  costType: ActivityCostType;
  costValue: number;
  startDate: string;
  endDate: string;
};

export function normalizeActivityName(name: string | null | undefined): string {
  return String(name || "").trim();
}

export function activityNameMatchKey(name: string | null | undefined): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")");
}

export function isBlankActivity(name: string | null | undefined): boolean {
  const n = normalizeActivityName(name);
  return !n || n === "无活动";
}

/** 取 YYYY-MM-DD，非法则空串 */
export function normalizeRuleDate(value: string | null | undefined): string {
  const s = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * 成交日是否在规则有效期内。
 * 起/止任一侧为空则该侧不限制（兼容旧数据）；两侧都空 = 始终有效。
 */
export function isSaleDateInActivityRule(
  saleDate: string | null | undefined,
  rule: Pick<ActivityCostRuleRow, "startDate" | "endDate">,
): boolean {
  const day =
    normalizeSaleDate(saleDate ?? undefined) || normalizeRuleDate(saleDate);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const start = normalizeRuleDate(rule.startDate);
  const end = normalizeRuleDate(rule.endDate);
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

/** 实收不足固定额或按比例扣光时返回 null（定金等小单本单不扣）。 */
export function calcActivityCostDeduction(
  rule: Pick<ActivityCostRuleRow, "costType" | "costValue"> | null | undefined,
  orderAmount: number,
): number | null {
  if (!rule) return null;
  const amount = Math.max(0, Number(orderAmount) || 0);
  if (amount <= 0) return null;
  const value = Number(rule.costValue);
  if (!Number.isFinite(value) || value < 0) return null;
  if (rule.costType === "percentage") {
    const deducted = roundMoney(Math.min(amount, amount * (value / 100)));
    if (deducted >= amount) return null;
    return deducted;
  }
  if (amount <= value) return null;
  return roundMoney(Math.min(amount, value));
}

type ActivityCostRuleDbRow = {
  activity_name?: string;
  cost_type?: string;
  cost_value?: number;
  start_date?: string;
  end_date?: string;
};

function rowToActivityCostRuleRow(row: ActivityCostRuleDbRow): ActivityCostRuleRow {
  const costType = row.cost_type === "percentage" ? "percentage" : "fixed";
  return {
    activityName: String(row.activity_name || ""),
    costType,
    costValue: Number(row.cost_value) || 0,
    startDate: normalizeRuleDate(row.start_date),
    endDate: normalizeRuleDate(row.end_date),
  };
}

function listActivityCostRulesFromDb(db: {
  prepare: (sql: string) => { all?: () => unknown[] };
}): ActivityCostRuleRow[] {
  const stmt = db.prepare(
    `SELECT activity_name, cost_type, cost_value, start_date, end_date
       FROM activity_cost_rules`,
  );
  if (!stmt.all) return [];
  const rows = stmt.all() as ActivityCostRuleDbRow[];
  return rows.filter((r) => r.activity_name).map(rowToActivityCostRuleRow);
}

/** 从 DB 取活动规则；无则 null */
export function getActivityCostRuleFromDb(
  db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } },
  activityName: string | null | undefined,
): ActivityCostRuleRow | null {
  if (isBlankActivity(activityName)) return null;
  const name = normalizeActivityName(activityName);
  const row = db
    .prepare(
      `SELECT activity_name, cost_type, cost_value, start_date, end_date
       FROM activity_cost_rules WHERE activity_name = ? LIMIT 1`,
    )
    .get(name) as ActivityCostRuleDbRow | undefined;
  if (!row?.activity_name) return null;
  return rowToActivityCostRuleRow(row);
}

/** 同步/新建：活动名 + 成交日匹配（含宽松比对与同期唯一规则兜底） */
export function getActivityCostRuleForSale(
  db: {
    prepare: (
      sql: string,
    ) => { get: (...args: unknown[]) => unknown; all?: () => unknown[] };
  },
  activityName: string | null | undefined,
  saleDate: string | null | undefined,
): ActivityCostRuleRow | null {
  if (isBlankActivity(activityName)) return null;
  const rules = listActivityCostRulesFromDb(db);
  if (!rules.length) return null;
  const key = activityNameMatchKey(activityName);
  const exact = rules.find((r) => activityNameMatchKey(r.activityName) === key);
  if (exact && isSaleDateInActivityRule(saleDate, exact)) return exact;
  const dated = rules.filter((r) => isSaleDateInActivityRule(saleDate, r));
  if (dated.length === 1) return dated[0];
  return null;
}

/**
 * 新建单时：已有数字覆盖（含 0）用覆盖；
 * 否则活动规则且成交日落在有效期内 → 固化；再否则 null（读时按产品 / 可再手工）。
 */
export function resolveCostOverrideForNewSale(options: {
  db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };
  activityName: string | null | undefined;
  orderAmount: number;
  saleDate: string | null | undefined;
  explicitOverride: number | null | undefined;
}): number | null {
  if (options.explicitOverride !== undefined && options.explicitOverride !== null) {
    const n = Number(options.explicitOverride);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }
  const rule = getActivityCostRuleForSale(
    options.db,
    options.activityName,
    options.saleDate,
  );
  if (!rule) return null;
  return calcActivityCostDeduction(rule, options.orderAmount);
}
