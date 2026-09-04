import { Router } from "express";
import {
  getDb,
  rowToProduct,
  generateId,
  runInTransaction,
  loadAliasesByProductIds,
  findProductRowByNameOrAlias,
  upsertProductAlias,
} from "../db";
import { authMiddleware } from "../auth";
import { requireEditPermission } from "../middleware";

const router = Router();
router.use(authMiddleware);

function getOperator(req: { user?: { id?: string; name?: string; username?: string } }) {
  const name = (req.user?.name || req.user?.username || "").trim() || "未知用户";
  const id = (req.user?.id || "").trim();
  return { name, id };
}

function productFields(body: any, existing?: any) {
  return {
    name: body.name ?? existing?.name,
    category: body.category ?? existing?.category ?? "",
    salesUnitId: body.salesUnitId !== undefined ? body.salesUnitId : existing?.sales_unit_id,
    unitPrice: body.unitPrice ?? existing?.unit_price ?? 0,
    costType: body.costType ?? existing?.cost_type ?? "fixed",
    unitCost: body.unitCost ?? existing?.unit_cost ?? 0,
    costRate: body.costRate ?? existing?.cost_rate ?? 0,
    description: body.description ?? existing?.description ?? "",
    commissionType: body.commissionType ?? existing?.commission_type ?? "percentage",
    commissionRate: body.commissionRate ?? existing?.commission_rate ?? 0,
    commissionAmount: body.commissionAmount ?? existing?.commission_amount ?? 0,
    commissionNote: body.commissionNote ?? existing?.commission_note ?? "",
    settlementType: body.settlementType ?? existing?.settlement_type ?? "percentage",
    settlementRate: body.settlementRate ?? existing?.settlement_rate ?? 100,
    settlementAmount: body.settlementAmount ?? existing?.settlement_amount ?? 0,
    settlementNote: body.settlementNote ?? existing?.settlement_note ?? "",
  };
}

function toProductJson(db: ReturnType<typeof getDb>, row: any) {
  if (!row) return null;
  const map = loadAliasesByProductIds(db, [row.id]);
  return rowToProduct(row, map.get(row.id) || []);
}

function parseRemoveIds(body: any): string[] {
  const fromList = Array.isArray(body?.removeIds) ? body.removeIds : [];
  const single = body?.removeId != null ? [body.removeId] : [];
  const ids = [...fromList, ...single]
    .map((x: unknown) => String(x || "").trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function fillKeepBlankFields(
  db: ReturnType<typeof getDb>,
  keep: any,
  remove: any,
  fieldsFilled: string[],
) {
  const fillText = (keepVal: unknown, removeVal: unknown) => {
    const k = String(keepVal ?? "").trim();
    const r = String(removeVal ?? "").trim();
    return k ? k : r;
  };
  const nextCategory = fillText(keep.category, remove.category);
  const nextDesc = fillText(keep.description, remove.description);
  const keepSettle = Number(keep.settlement_rate || 0);
  const removeSettle = Number(remove.settlement_rate || 0);
  const nextSettleType = fillText(keep.settlement_type, remove.settlement_type)
    || "percentage";
  const nextSettleRate = keepSettle > 0 ? keep.settlement_rate : (remove.settlement_rate || 0);
  const nextSettleAmt = Number(keep.settlement_amount || 0) > 0
    ? keep.settlement_amount
    : (remove.settlement_amount || 0);
  const nextSettleNote = fillText(keep.settlement_note, remove.settlement_note);
  if (nextCategory !== (keep.category || "")) fieldsFilled.push("分类");
  if (nextDesc !== (keep.description || "")) fieldsFilled.push("说明");
  if (Number(nextSettleRate || 0) !== keepSettle && removeSettle > 0) {
    fieldsFilled.push("默认结算");
  }
  db.prepare(`
    UPDATE products SET
      category=?, description=?,
      settlement_type=?, settlement_rate=?, settlement_amount=?, settlement_note=?
    WHERE id=?
  `).run(
    nextCategory,
    nextDesc,
    nextSettleType,
    nextSettleRate,
    nextSettleAmt,
    nextSettleNote,
    keep.id,
  );
  keep.category = nextCategory;
  keep.description = nextDesc;
  keep.settlement_type = nextSettleType;
  keep.settlement_rate = nextSettleRate;
  keep.settlement_amount = nextSettleAmt;
  keep.settlement_note = nextSettleNote;
}

function mergeOneProduct(
  db: ReturnType<typeof getDb>,
  keepId: string,
  removeId: string,
  keep: any,
  remove: any,
  operator: { name: string; id: string },
  stats: {
    sales: number
    settlementsMoved: number
    settlementsDropped: number
    commissionsMoved: number
    commissionsDropped: number
    aliasesAdded: number
    fieldsFilled: string[]
  },
) {
  const salesInfo = db
    .prepare("UPDATE sales_records SET product_id = ? WHERE product_id = ?")
    .run(keepId, removeId);
  stats.sales += Number(salesInfo.changes || 0);

  const removeUps = db
    .prepare("SELECT * FROM unit_product_settlements WHERE product_id = ?")
    .all(removeId) as any[];
  const findKeepUps = db.prepare(`
    SELECT id FROM unit_product_settlements
    WHERE sales_unit_id = ? AND product_id = ?
  `);
  const moveUps = db.prepare(
    "UPDATE unit_product_settlements SET product_id = ? WHERE id = ?",
  );
  const dropUps = db.prepare("DELETE FROM unit_product_settlements WHERE id = ?");
  for (const row of removeUps) {
    const clash = findKeepUps.get(row.sales_unit_id, keepId);
    if (clash) {
      dropUps.run(row.id);
      stats.settlementsDropped += 1;
    } else {
      moveUps.run(keepId, row.id);
      stats.settlementsMoved += 1;
    }
  }

  const removePpc = db
    .prepare("SELECT * FROM product_person_commissions WHERE product_id = ?")
    .all(removeId) as any[];
  const findKeepPpc = db.prepare(`
    SELECT id FROM product_person_commissions
    WHERE sales_unit_id = ? AND product_id = ? AND personnel_id = ?
  `);
  const movePpc = db.prepare(
    "UPDATE product_person_commissions SET product_id = ? WHERE id = ?",
  );
  const dropPpc = db.prepare("DELETE FROM product_person_commissions WHERE id = ?");
  for (const row of removePpc) {
    const clash = findKeepPpc.get(row.sales_unit_id, keepId, row.personnel_id);
    if (clash) {
      dropPpc.run(row.id);
      stats.commissionsDropped += 1;
    } else {
      movePpc.run(keepId, row.id);
      stats.commissionsMoved += 1;
    }
  }

  const removeAliases = db
    .prepare("SELECT * FROM product_aliases WHERE product_id = ?")
    .all(removeId) as Array<{ id: string; alias_name: string }>;
  for (const alias of removeAliases) {
    const clash = db
      .prepare(`
        SELECT id FROM product_aliases
        WHERE product_id = ? AND alias_name = ? COLLATE NOCASE
      `)
      .get(keepId, alias.alias_name);
    if (clash) {
      db.prepare("DELETE FROM product_aliases WHERE id = ?").run(alias.id);
    } else {
      db.prepare("UPDATE product_aliases SET product_id = ? WHERE id = ?")
        .run(keepId, alias.id);
    }
  }

  const before = db
    .prepare("SELECT COUNT(*) AS n FROM product_aliases WHERE product_id = ?")
    .get(keepId) as { n: number };
  upsertProductAlias(db, keepId, remove.name, operator);
  const after = db
    .prepare("SELECT COUNT(*) AS n FROM product_aliases WHERE product_id = ?")
    .get(keepId) as { n: number };
  stats.aliasesAdded += Math.max(0, Number(after?.n || 0) - Number(before?.n || 0));

  fillKeepBlankFields(db, keep, remove, stats.fieldsFilled);
  db.prepare("DELETE FROM products WHERE id = ?").run(removeId);
}

router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM products ORDER BY name").all() as Array<{
    id: string
  }>;
  const aliasMap = loadAliasesByProductIds(db, rows.map((r) => r.id));
  res.json(rows.map((r) => rowToProduct(r, aliasMap.get(r.id) || [])));
});

router.post("/ensure", requireEditPermission, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "产品名称不能为空" });
  const db = getDb();
  const existing = findProductRowByNameOrAlias(db, name);
  if (existing) return res.json(toProductJson(db, existing));

  const id = generateId("prod");
  const f = productFields({ ...req.body, name });
  db.prepare(`
    INSERT INTO products (
      id, name, category, sales_unit_id, unit_price, cost_type, unit_cost, cost_rate,
      description, commission_type, commission_rate, commission_amount, commission_note,
      settlement_type, settlement_rate, settlement_amount, settlement_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, f.name, f.category, f.salesUnitId || null, f.unitPrice, f.costType, f.unitCost, f.costRate,
    f.description, f.commissionType, f.commissionRate, f.commissionAmount, f.commissionNote,
    f.settlementType, f.settlementRate, f.settlementAmount, f.settlementNote
  );
  res.json(toProductJson(db, db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});

/**
 * POST /api/products/merge
 * 合并重复产品：销售记录改挂主产品；结算/提成主产品已有则保留，没有则沿用被合并项。
 * 被合并名称写入别名，后续同步同名不再新建。
 */
router.post("/merge", requireEditPermission, (req, res) => {
  const keepId = String(req.body?.keepId || "").trim();
  const removeIds = parseRemoveIds(req.body).filter((id) => id !== keepId);
  if (!keepId || removeIds.length === 0) {
    return res.status(400).json({ error: "请指定保留产品与被合并产品" });
  }

  const db = getDb();
  const keep: any = db.prepare("SELECT * FROM products WHERE id = ?").get(keepId);
  if (!keep) return res.status(404).json({ error: "保留产品不存在" });
  const removeRows = removeIds.map((id) => ({
    id,
    row: db.prepare("SELECT * FROM products WHERE id = ?").get(id) as any,
  }));
  const missing = removeRows.filter((x) => !x.row).map((x) => x.id);
  if (missing.length > 0) {
    return res.status(404).json({ error: `被合并产品不存在：${missing.join("、")}` });
  }

  const operator = getOperator(req);
  const stats = runInTransaction(() => {
    const moved = {
      sales: 0,
      settlementsMoved: 0,
      settlementsDropped: 0,
      commissionsMoved: 0,
      commissionsDropped: 0,
      aliasesAdded: 0,
      fieldsFilled: [] as string[],
      mergedCount: 0,
    };
    for (const item of removeRows) {
      mergeOneProduct(db, keepId, item.id, keep, item.row, operator, moved);
      moved.mergedCount += 1;
    }
    moved.fieldsFilled = Array.from(new Set(moved.fieldsFilled));
    return moved;
  });

  const product = toProductJson(
    db,
    db.prepare("SELECT * FROM products WHERE id = ?").get(keepId),
  );
  const names = removeRows.map((x) => x.row.name).join("、");
  res.json({
    product,
    message: `已将「${names}」合并到「${keep.name}」`,
    stats,
  });
});

router.post("/", requireEditPermission, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "产品名称不能为空" });
  const db = getDb();
  const existing = findProductRowByNameOrAlias(db, String(name).trim());
  if (existing) return res.json(toProductJson(db, existing));
  const id = generateId("prod");
  const f = productFields(req.body);
  db.prepare(`
    INSERT INTO products (
      id, name, category, sales_unit_id, unit_price, cost_type, unit_cost, cost_rate,
      description, commission_type, commission_rate, commission_amount, commission_note,
      settlement_type, settlement_rate, settlement_amount, settlement_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, f.name, f.category, f.salesUnitId || null, f.unitPrice, f.costType, f.unitCost, f.costRate,
    f.description, f.commissionType, f.commissionRate, f.commissionAmount, f.commissionNote,
    f.settlementType, f.settlementRate, f.settlementAmount, f.settlementNote
  );
  res.json(toProductJson(db, db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});

router.put("/:id", requireEditPermission, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "产品不存在" });
  const f = productFields(req.body, existing);
  db.prepare(`
    UPDATE products SET
      name=?, category=?, sales_unit_id=?, unit_price=?, cost_type=?, unit_cost=?, cost_rate=?,
      description=?, commission_type=?, commission_rate=?, commission_amount=?, commission_note=?,
      settlement_type=?, settlement_rate=?, settlement_amount=?, settlement_note=?
    WHERE id=?
  `).run(
    f.name, f.category, f.salesUnitId || null, f.unitPrice, f.costType, f.unitCost, f.costRate,
    f.description, f.commissionType, f.commissionRate, f.commissionAmount, f.commissionNote,
    f.settlementType, f.settlementRate, f.settlementAmount, f.settlementNote, id
  );
  res.json(toProductJson(db, db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});

router.delete("/:id", requireEditPermission, (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "产品不存在" });
  res.json({ message: "删除成功" });
});

export default router;
