// 格式化货币
export function formatCurrency(amount: number): string {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safe);
}

// 格式化数字
export function formatNumber(num: number): string {
  return new Intl.NumberFormat("zh-CN").format(num);
}

// 格式化百分比
export function formatPercent(num: number): string {
  return `${num.toFixed(1)}%`;
}

// 格式化日期
export function formatDate(date: string): string {
  if (!date) return "-";
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 格式化日期时间
export function formatDateTime(date: string): string {
  if (!date) return "-";
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 按入职日自动计算司龄（年），保留一位小数；在职算到今天，已离职算到离职日。
 * 无有效入职日时返回空字符串。
 */
export function calcCompanyTenureYears(
  hireDate?: string,
  resignDate?: string,
): string {
  const hire = (hireDate || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hire)) return "";
  const resign = (resignDate || "").trim().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const end =
    /^\d{4}-\d{2}-\d{2}$/.test(resign) && resign < today ? resign : today;
  const startMs = Date.parse(`${hire}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return "0.0";
  }
  const years = (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000);
  return years.toFixed(1);
}

/** 列表展示用司龄，如 2.5年 */
export function formatCompanyTenure(
  hireDate?: string,
  resignDate?: string,
): string {
  const years = calcCompanyTenureYears(hireDate, resignDate);
  return years ? `${years}年` : "";
}

// 获取月份名称
export function getMonthName(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月`;
}

// 获取年月
export function getYearMonth(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 获取当前年月
export function getCurrentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
