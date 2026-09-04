import { Router } from "express";
import { getDb, rowToSalesRecord, generateId } from "../db";
import { authMiddleware } from "../auth";
import {
  getVisibleUnitIds,
  isSalesRowVisible,
  requireModuleEdit,
} from "../middleware";

const router = Router();
router.use(authMiddleware);

const INSERT_SQL = `
  INSERT INTO sales_records (
    id, sales_unit_id, personnel_id, product_id, quantity, unit_price, total_amount, sale_date, remark,
    synced, external_order_id, customer_name, sales_unit_name, sales_person_name, product_name, synced_at,
    order_number, product_module, order_amount, order_type, activity_name, collaborators
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_SQL = `
  UPDATE sales_records SET
    sales_unit_id=?, personnel_id=?, product_id=?, quantity=?, unit_price=?, total_amount=?, sale_date=?, remark=?,
    synced=?, external_order_id=?, customer_name=?, sales_unit_name=?, sales_person_name=?, product_name=?, synced_at=?,
    order_number=?, product_module=?, order_amount=?, order_type=?, activity_name=?, collaborators=?
  WHERE id=?
`;

function normalizeCollaborators(raw: any, shareMode?: string): string {
  if (raw == null || raw === "") return "";
  let list = raw;
  let mode = shareMode === "amount" ? "amount" : "percent";
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return "";
    }
  }
  if (list && typeof list === "object" && !Array.isArray(list)) {
    if (list.mode === "amount" || list.mode === "percent") mode = list.mode;
    list = list.shares;
  }
  if (!Array.isArray(list) || list.length === 0) return "";
  const cleaned = list
    .map((item: any) => ({
      personnelId: String(item?.personnelId || "").trim(),
      salesUnitId: String(item?.salesUnitId || "").trim() || undefined,
      sharePercent: item?.sharePercent != null ? Number(item.sharePercent) : undefined,
      shareAmount: item?.shareAmount != null ? Number(item.shareAmount) : undefined,
    }))
    .filter((c: { personnelId: string }) => c.personnelId);
  if (cleaned.length === 0) return "";
  return JSON.stringify({ mode, shares: cleaned });
}

function pick(body: any, existing?: any) {
  const qty = body.quantity ?? existing?.quantity ?? 1;
  const price = body.unitPrice ?? existing?.unit_price ?? 0;
  const totalAmount = body.totalAmount != null
    ? body.totalAmount
    : (existing ? existing.total_amount : qty * price);
  const collaborators =
    body.collaborators !== undefined
      ? normalizeCollaborators(body.collaborators, body.shareMode)
      : (existing?.collaborators || "");
  return {
    salesUnitId: body.salesUnitId ?? existing?.sales_unit_id ?? "",
    personnelId: body.personnelId ?? existing?.personnel_id ?? "",
    productId: body.productId ?? existing?.product_id ?? "",
    quantity: qty,
    unitPrice: price,
    totalAmount,
    saleDate: body.saleDate ?? existing?.sale_date,
    remark: body.remark ?? existing?.remark ?? "",
    synced: body.synced != null ? (body.synced ? 1 : 0) : (existing?.synced || 0),
    externalOrderId: body.externalOrderId ?? existing?.external_order_id ?? "",
    customerName: body.customerName ?? existing?.customer_name ?? "",
    salesUnitName: body.salesUnitName ?? existing?.sales_unit_name ?? "",
    salesPersonName: body.salesPersonName ?? existing?.sales_person_name ?? "",
    productName: body.productName ?? existing?.product_name ?? "",
    syncedAt: body.syncedAt ?? existing?.synced_at ?? null,
    orderNumber: body.orderNumber ?? existing?.order_number ?? "",
    productModule: body.productModule ?? existing?.product_module ?? "",
    orderAmount: body.orderAmount ?? existing?.order_amount ?? 0,
    orderType: body.orderType ?? existing?.order_type ?? "",
    activityName: body.activityName ?? existing?.activity_name ?? "",
    collaborators,
  };
}

function bind(f: ReturnType<typeof pick>) {
  return [
    f.salesUnitId, f.personnelId, f.productId, f.quantity, f.unitPrice, f.totalAmount, f.saleDate, f.remark,
    f.synced, f.externalOrderId, f.customerName, f.salesUnitName, f.salesPersonName, f.productName, f.syncedAt,
    f.orderNumber, f.productModule, f.orderAmount, f.orderType, f.activityName, f.collaborators,
  ];
}

router.get("/", (req, res) => {
  const db = getDb();
  let rows = db.prepare("SELECT * FROM sales_records ORDER BY sale_date DESC").all();
  const visibleIds = getVisibleUnitIds(req.user!);
  if (visibleIds !== null) {
    rows = rows.filter((r: any) => isSalesRowVisible(visibleIds, r));
  }
  const { salesUnitId, personnelId } = req.query;
  if (salesUnitId) {
    const uid = String(salesUnitId);
    rows = rows.filter((r: any) => {
      if (r.sales_unit_id === uid) return true;
      const mapped = rowToSalesRecord(r);
      return (mapped.collaborators || []).some(
        (c: { salesUnitId?: string }) => c.salesUnitId === uid,
      );
    });
  }
  if (personnelId) {
    const pid = String(personnelId);
    rows = rows.filter((r: any) => {
      if (r.personnel_id === pid) return true;
      const mapped = rowToSalesRecord(r);
      return (mapped.collaborators || []).some(
        (c: { personnelId: string }) => c.personnelId === pid,
      );
    });
  }
  res.json(rows.map(rowToSalesRecord));
});

router.post("/", requireModuleEdit("sales_records"), (req, res) => {
  const f = pick(req.body);
  if (!f.saleDate) return res.status(400).json({ error: "销售日期不能为空" });
  const visibleIds = getVisibleUnitIds(req.user!);
  if (!isSalesRowVisible(visibleIds, {
    sales_unit_id: f.salesUnitId,
    collaborators: f.collaborators,
  })) {
    return res.status(403).json({ error: "只能操作自己可见单位的销售记录" });
  }
  const id = generateId("sr");
  const db = getDb();
  db.prepare(INSERT_SQL).run(id, ...bind(f));
  res.json(rowToSalesRecord(db.prepare("SELECT * FROM sales_records WHERE id = ?").get(id)));
});

router.put("/:id", requireModuleEdit("sales_records"), (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM sales_records WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "销售记录不存在" });
  const visibleIds = getVisibleUnitIds(req.user!);
  if (!isSalesRowVisible(visibleIds, existing as object)) {
    return res.status(403).json({ error: "只能操作自己可见单位的销售记录" });
  }
  const f = pick(req.body, existing);
  if (!isSalesRowVisible(visibleIds, {
    sales_unit_id: f.salesUnitId,
    collaborators: f.collaborators,
  })) {
    return res.status(403).json({ error: "不能把记录改到无权查看的单位" });
  }
  db.prepare(UPDATE_SQL).run(...bind(f), id);
  res.json(rowToSalesRecord(db.prepare("SELECT * FROM sales_records WHERE id = ?").get(id)));
});

router.delete("/:id", requireModuleEdit("sales_records"), (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM sales_records WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "销售记录不存在" });
  const visibleIds = getVisibleUnitIds(req.user!);
  if (!isSalesRowVisible(visibleIds, existing as object)) {
    return res.status(403).json({ error: "只能操作自己可见单位的销售记录" });
  }
  db.prepare("DELETE FROM sales_records WHERE id = ?").run(req.params.id);
  res.json({ message: "删除成功" });
});

export default router;
