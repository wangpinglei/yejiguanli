type FindUnitId = (name: string) => string;
type FindPersonnelId = (name: string, unitId: string) => string;

type ParsedShare = {
  personnelId: string;
  salesUnitId?: string;
  sharePercent?: number;
  shareAmount?: number;
};

/**
 * 解析「无锡运营中心·孙彪 50% / 云拆单·李燚 50%」类销售人员字段为分业绩 JSON
 * 返回 serializePerformanceSplit 格式字符串；无法解析则返回空字符串
 */
export function parsePerformanceSplitText(
  text: string,
  findUnitId: FindUnitId,
  findPersonnelId: FindPersonnelId,
): string {
  const raw = (text || "").trim();
  if (!raw || !raw.includes("·")) return "";

  const parts = raw.split(/[/／、;；]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";

  const shares: ParsedShare[] = [];
  for (const part of parts) {
    const percentMatch = part.match(/^(.+?)·(.+?)\s+(\d+(?:\.\d+)?)\s*%?\s*$/);
    const amountMatch = part.match(/^(.+?)·(.+?)\s+¥?\s*(\d+(?:\.\d+)?)\s*$/);
    let unitName = "";
    let personName = "";
    let sharePercent: number | undefined;
    let shareAmount: number | undefined;

    if (percentMatch) {
      unitName = percentMatch[1].trim();
      personName = percentMatch[2].trim();
      sharePercent = Number(percentMatch[3]);
    } else if (amountMatch) {
      unitName = amountMatch[1].trim();
      personName = amountMatch[2].trim();
      shareAmount = Number(amountMatch[3]);
    } else {
      const simple = part.match(/^(.+?)·(.+)$/);
      if (!simple) continue;
      unitName = simple[1].trim();
      personName = simple[2].trim();
      sharePercent = 100 / parts.length;
    }

    if (!personName) continue;
    const unitId = findUnitId(unitName);
    const personnelId = findPersonnelId(personName, unitId);
    if (!personnelId) continue;

    const row: ParsedShare = {
      personnelId,
      salesUnitId: unitId || undefined,
    };
    if (shareAmount != null && Number.isFinite(shareAmount)) {
      row.shareAmount = shareAmount;
    } else if (sharePercent != null && Number.isFinite(sharePercent)) {
      row.sharePercent = sharePercent;
    }
    shares.push(row);
  }

  if (shares.length < 2) return "";

  const mode =
    shares.every((s) => s.shareAmount != null && s.sharePercent == null)
      ? "amount"
      : "percent";

  return JSON.stringify({ mode, shares });
}
