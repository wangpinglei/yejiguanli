/** 活动默认成本扣除（服务端：新建/新同步时固化） */

export type ActivityCostType = "fixed" | "percentage";

export type ActivityCostRuleRow = {
  activityName: string;
  costType: ActivityCostType;
  costValue: number;
};

export function normalizeActivityName(name: string | null | undefined): string {
  return String(name || "").trim();
}

export function isBlankActivity(name: string | null | undefined): boolean {
  const n = normalizeActivityName(name);
  return !n || n === "无活动";
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function calcActivityCostDeduction(
  rule: Pick<ActivityCostRuleRow, "costType" | "costValue"> | null | undefined,
  orderAmount: number,
): number | null {
  if (!rule) return null;
  const amount = Math.max(0, Number(orderAmount) || 0);
  const value = Number(rule.costValue);
  if (!Number.isFinite(value) || value < 0) return null;
  if (rule.costType === "percentage") {
    return roundMoney(Math.min(amount, amount * (value / 100)));
  }
  return roundMoney(Math.min(amount, value));
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
      "SELECT activity_name, cost_type, cost_value FROM activity_cost_rules WHERE activity_name = ? LIMIT 1",
    )
    .get(name) as
    | { activity_name?: string; cost_type?: string; cost_value?: number }
    | undefined;
  if (!row?.activity_name) return null;
  const costType = row.cost_type === "percentage" ? "percentage" : "fixed";
  return {
    activityName: String(row.activity_name),
    costType,
    costValue: Number(row.cost_value) || 0,
  };
}

/**
 * 新建单时：已有数字覆盖（含 0）用覆盖；否则按活动规则固化；再否则 null（读时按产品）。
 */
export function resolveCostOverrideForNewSale(options: {
  db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };
  activityName: string | null | undefined;
  orderAmount: number;
  explicitOverride: number | null | undefined;
}): number | null {
  if (options.explicitOverride !== undefined && options.explicitOverride !== null) {
    const n = Number(options.explicitOverride);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }
  const rule = getActivityCostRuleFromDb(options.db, options.activityName);
  return calcActivityCostDeduction(rule, options.orderAmount);
}
