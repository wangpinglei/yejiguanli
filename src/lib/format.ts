// 格式化货币
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
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
