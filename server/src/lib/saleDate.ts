function isRealYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function expandTwoDigitYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

/** 与 src/lib/salesDuplicate.ts 的 normalizeSaleDate 保持一致 */
export function normalizeSaleDate(value: unknown): string {
  const s = String(value || "").trim();
  if (!s) return "";
  const ymd = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (isRealYmd(year, month, day)) return formatYmd(year, month, day);
  }
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\D|$)/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = expandTwoDigitYear(Number(mdy[3]));
    if (isRealYmd(year, month, day)) return formatYmd(year, month, day);
  }
  return s.slice(0, 10);
}
