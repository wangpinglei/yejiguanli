import { Router } from "express";
import { getDb, runInTransaction } from "../db";
import { authMiddleware } from "../auth";
import { requireRole } from "../middleware";

const router = Router();
router.use(authMiddleware, requireRole("superadmin"));

function upsertById(
  db: any,
  table: string,
  id: string,
  insertSql: string,
  insertArgs: any[],
  updateSql: string,
  updateArgs: any[]
) {
  const exists = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (exists) db.prepare(updateSql).run(...updateArgs);
  else db.prepare(insertSql).run(...insertArgs);
}

// POST /api/migrate - 从 localStorage 导入全部业务数据
router.post("/", (req, res) => {
  const body = req.body || {};
  const stats: Record<string, number> = {};

  const db = getDb();
  try {
    runInTransaction(() => {
    const salesUnits = body.salesUnits || [];
    stats.salesUnits = 0;
    for (const unit of salesUnits) {
      upsertById(
        db, "sales_units", unit.id,
        `INSERT INTO sales_units (
          id, name, type, address, contact, contact_phone, description,
          group_admin_id, military_cadre_id, org_dept_id, unit_leader_id,
          group_admin_name, military_cadre_name, org_dept_name, unit_leader_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          unit.id, unit.name, unit.type || "company", unit.address || "", unit.contact || "",
          unit.contactPhone || "", unit.description || "",
          unit.groupAdminId || null, unit.militaryCadreId || null, unit.orgDeptId || null, unit.unitLeaderId || null,
          unit.groupAdminName || "", unit.militaryCadreName || "", unit.orgDeptName || "", unit.unitLeaderName || "",
          unit.createdAt || new Date().toISOString(),
        ],
        `UPDATE sales_units SET name=?, type=?, address=?, contact=?, contact_phone=?, description=?,
          group_admin_id=?, military_cadre_id=?, org_dept_id=?, unit_leader_id=?,
          group_admin_name=?, military_cadre_name=?, org_dept_name=?, unit_leader_name=? WHERE id=?`,
        [
          unit.name, unit.type || "company", unit.address || "", unit.contact || "", unit.contactPhone || "",
          unit.description || "", unit.groupAdminId || null, unit.militaryCadreId || null, unit.orgDeptId || null,
          unit.unitLeaderId || null, unit.groupAdminName || "", unit.militaryCadreName || "",
          unit.orgDeptName || "", unit.unitLeaderName || "", unit.id,
        ]
      );
      stats.salesUnits++;
    }

    const personnel = body.personnel || [];
    stats.personnel = 0;
    for (const p of personnel) {
      const salaryJson = JSON.stringify(p.salary || {});
      upsertById(
        db, "personnel", p.id,
        `INSERT INTO personnel (id, name, sales_unit_id, position, phone, email, salary, social_insurance, housing_fund, hire_date, resign_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.name, p.salesUnitId, p.position || "", p.phone || "", p.email || "", salaryJson,
          p.socialInsurance || 0, p.housingFund || 0, p.hireDate || "", p.resignDate || null, p.status || "active"],
        `UPDATE personnel SET name=?, sales_unit_id=?, position=?, phone=?, email=?, salary=?, social_insurance=?, housing_fund=?, hire_date=?, resign_date=?, status=? WHERE id=?`,
        [p.name, p.salesUnitId, p.position || "", p.phone || "", p.email || "", salaryJson,
          p.socialInsurance || 0, p.housingFund || 0, p.hireDate || "", p.resignDate || null, p.status || "active", p.id]
      );
      stats.personnel++;
    }

    const products = body.products || [];
    stats.products = 0;
    for (const prod of products) {
      upsertById(
        db, "products", prod.id,
        `INSERT INTO products (
          id, name, category, sales_unit_id, unit_price, cost_type, unit_cost, cost_rate, description,
          commission_type, commission_rate, commission_amount, commission_note,
          settlement_type, settlement_rate, settlement_amount, settlement_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          prod.id, prod.name, prod.category || "", prod.salesUnitId || null, prod.unitPrice || 0,
          prod.costType || "fixed", prod.unitCost || 0, prod.costRate || 0, prod.description || "",
          prod.commissionType || "percentage", prod.commissionRate || 0, prod.commissionAmount || 0, prod.commissionNote || "",
          prod.settlementType || "percentage", prod.settlementRate ?? 100, prod.settlementAmount || 0, prod.settlementNote || "",
        ],
        `UPDATE products SET name=?, category=?, sales_unit_id=?, unit_price=?, cost_type=?, unit_cost=?, cost_rate=?, description=?,
          commission_type=?, commission_rate=?, commission_amount=?, commission_note=?,
          settlement_type=?, settlement_rate=?, settlement_amount=?, settlement_note=? WHERE id=?`,
        [
          prod.name, prod.category || "", prod.salesUnitId || null, prod.unitPrice || 0,
          prod.costType || "fixed", prod.unitCost || 0, prod.costRate || 0, prod.description || "",
          prod.commissionType || "percentage", prod.commissionRate || 0, prod.commissionAmount || 0, prod.commissionNote || "",
          prod.settlementType || "percentage", prod.settlementRate ?? 100, prod.settlementAmount || 0, prod.settlementNote || "",
          prod.id,
        ]
      );
      stats.products++;
    }

    const salesRecords = body.salesRecords || [];
    stats.salesRecords = 0;
    for (const sr of salesRecords) {
      upsertById(
        db, "sales_records", sr.id,
        `INSERT INTO sales_records (
          id, sales_unit_id, personnel_id, product_id, quantity, unit_price, total_amount, sale_date, remark,
          synced, external_order_id, customer_name, sales_unit_name, sales_person_name, product_name, synced_at,
          order_number, product_module, order_amount, order_type, activity_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sr.id, sr.salesUnitId || "", sr.personnelId || "", sr.productId || "", sr.quantity || 1,
          sr.unitPrice || 0, sr.totalAmount || 0, sr.saleDate, sr.remark || "",
          sr.synced ? 1 : 0, sr.externalOrderId || "", sr.customerName || "", sr.salesUnitName || "",
          sr.salesPersonName || "", sr.productName || "", sr.syncedAt || null,
          sr.orderNumber || "", sr.productModule || "", sr.orderAmount || 0, sr.orderType || "", sr.activityName || "",
        ],
        `UPDATE sales_records SET sales_unit_id=?, personnel_id=?, product_id=?, quantity=?, unit_price=?, total_amount=?, sale_date=?, remark=?,
          synced=?, external_order_id=?, customer_name=?, sales_unit_name=?, sales_person_name=?, product_name=?, synced_at=?,
          order_number=?, product_module=?, order_amount=?, order_type=?, activity_name=? WHERE id=?`,
        [
          sr.salesUnitId || "", sr.personnelId || "", sr.productId || "", sr.quantity || 1,
          sr.unitPrice || 0, sr.totalAmount || 0, sr.saleDate, sr.remark || "",
          sr.synced ? 1 : 0, sr.externalOrderId || "", sr.customerName || "", sr.salesUnitName || "",
          sr.salesPersonName || "", sr.productName || "", sr.syncedAt || null,
          sr.orderNumber || "", sr.productModule || "", sr.orderAmount || 0, sr.orderType || "", sr.activityName || "",
          sr.id,
        ]
      );
      stats.salesRecords++;
    }

    const costRecords = body.costRecords || [];
    stats.costRecords = 0;
    for (const cr of costRecords) {
      const itemsJson = JSON.stringify(cr.items || []);
      upsertById(
        db, "cost_records", cr.id,
        `INSERT INTO cost_records (id, sales_unit_id, date, items, total_cost, remark, created_at, created_by, change_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cr.id, cr.salesUnitId, cr.date, itemsJson, cr.totalCost || 0, cr.remark || "",
          cr.createdAt || new Date().toISOString(), cr.createdBy || null, cr.changeReason || ""],
        `UPDATE cost_records SET sales_unit_id=?, date=?, items=?, total_cost=?, remark=?, created_by=?, change_reason=? WHERE id=?`,
        [cr.salesUnitId, cr.date, itemsJson, cr.totalCost || 0, cr.remark || "", cr.createdBy || null, cr.changeReason || "", cr.id]
      );
      stats.costRecords++;
    }

    const incomeRecords = body.incomeRecords || [];
    stats.incomeRecords = 0;
    for (const ir of incomeRecords) {
      upsertById(
        db, "income_records", ir.id,
        `INSERT INTO income_records (
          id, sales_unit_id, date, items, total_amount, remark, created_at, created_by, change_reason,
          is_recurring, recurring_months, recurring_start_date, recurring_end_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ir.id, ir.salesUnitId, ir.date, JSON.stringify(ir.items || []), ir.totalAmount || 0, ir.remark || "",
          ir.createdAt || new Date().toISOString(), ir.createdBy || null, ir.changeReason || "",
          ir.isRecurring ? 1 : 0, JSON.stringify(ir.recurringMonths || [1,2,3,4,5,6,7,8,9,10,11,12]),
          ir.recurringStartDate || "", ir.recurringEndDate || "",
        ],
        `UPDATE income_records SET sales_unit_id=?, date=?, items=?, total_amount=?, remark=?, change_reason=?,
          is_recurring=?, recurring_months=?, recurring_start_date=?, recurring_end_date=? WHERE id=?`,
        [
          ir.salesUnitId, ir.date, JSON.stringify(ir.items || []), ir.totalAmount || 0, ir.remark || "", ir.changeReason || "",
          ir.isRecurring ? 1 : 0, JSON.stringify(ir.recurringMonths || [1,2,3,4,5,6,7,8,9,10,11,12]),
          ir.recurringStartDate || "", ir.recurringEndDate || "", ir.id,
        ]
      );
      stats.incomeRecords++;
    }

    const upsertSimple = (
      key: string,
      table: string,
      rows: any[],
      toInsert: (r: any) => { sql: string; args: any[] },
      toUpdate: (r: any) => { sql: string; args: any[] }
    ) => {
      stats[key] = 0;
      for (const r of rows) {
        if (!r?.id) continue;
        upsertById(db, table, r.id, toInsert(r).sql, toInsert(r).args, toUpdate(r).sql, toUpdate(r).args);
        stats[key]++;
      }
    };

    upsertSimple("revenueSettlements", "revenue_settlements", body.revenueSettlements || [],
      (r) => ({
        sql: `INSERT INTO revenue_settlements (id, sales_unit_id, year_month, estimated_amount, actual_amount, is_adjusted, remark, adjusted_by, adjusted_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.salesUnitId, r.yearMonth, r.estimatedAmount || 0, r.actualAmount ?? null, r.isAdjusted ? 1 : 0,
          r.remark || "", r.adjustedBy || null, r.adjustedAt || null, r.createdAt || new Date().toISOString()],
      }),
      (r) => ({
        sql: `UPDATE revenue_settlements SET sales_unit_id=?, year_month=?, estimated_amount=?, actual_amount=?, is_adjusted=?, remark=?, adjusted_by=?, adjusted_at=? WHERE id=?`,
        args: [r.salesUnitId, r.yearMonth, r.estimatedAmount || 0, r.actualAmount ?? null, r.isAdjusted ? 1 : 0,
          r.remark || "", r.adjustedBy || null, r.adjustedAt || null, r.id],
      })
    );

    upsertSimple("unitProductSettlements", "unit_product_settlements", body.unitProductSettlements || [],
      (r) => ({
        sql: `INSERT INTO unit_product_settlements (
          id, sales_unit_id, product_id, settlement_type, settlement_rate, settlement_amount, note,
          effective_from, effective_to, reward_amount, reward_from, reward_to, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.salesUnitId, r.productId, r.settlementType || "percentage", r.settlementRate ?? 100,
          r.settlementAmount || 0, r.note || "",
          r.effectiveFrom || "", r.effectiveTo || "", r.rewardAmount || 0, r.rewardFrom || "", r.rewardTo || "",
          r.createdAt || new Date().toISOString(), r.updatedAt || null],
      }),
      (r) => ({
        sql: `UPDATE unit_product_settlements SET sales_unit_id=?, product_id=?, settlement_type=?, settlement_rate=?, settlement_amount=?, note=?,
          effective_from=?, effective_to=?, reward_amount=?, reward_from=?, reward_to=?, updated_at=? WHERE id=?`,
        args: [r.salesUnitId, r.productId, r.settlementType || "percentage", r.settlementRate ?? 100,
          r.settlementAmount || 0, r.note || "",
          r.effectiveFrom || "", r.effectiveTo || "", r.rewardAmount || 0, r.rewardFrom || "", r.rewardTo || "",
          r.updatedAt || new Date().toISOString(), r.id],
      })
    );

    upsertSimple("productPersonCommissions", "product_person_commissions", body.productPersonCommissions || [],
      (r) => ({
        sql: `INSERT INTO product_person_commissions (
          id, sales_unit_id, product_id, personnel_id,
          management_commission_rate, management_commission_threshold, management_commission_condition,
          personal_commission_type, personal_commission_rate, personal_commission_amount,
          personal_commission_threshold, personal_commission_condition,
          reward_amount, reward_from, reward_to, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.salesUnitId, r.productId, r.personnelId,
          r.managementCommissionRate || 0, r.managementCommissionThreshold || 0, r.managementCommissionCondition || "",
          r.personalCommissionType === "fixed" ? "fixed" : "percentage",
          r.personalCommissionRate || 0, r.personalCommissionAmount || 0,
          r.personalCommissionThreshold || 0, r.personalCommissionCondition || "",
          r.rewardAmount || 0, r.rewardFrom || "", r.rewardTo || "",
          r.createdAt || new Date().toISOString(), r.updatedAt || null],
      }),
      (r) => ({
        sql: `UPDATE product_person_commissions SET sales_unit_id=?, product_id=?, personnel_id=?,
          management_commission_rate=?, management_commission_threshold=?, management_commission_condition=?,
          personal_commission_type=?, personal_commission_rate=?, personal_commission_amount=?,
          personal_commission_threshold=?, personal_commission_condition=?,
          reward_amount=?, reward_from=?, reward_to=?, updated_at=? WHERE id=?`,
        args: [r.salesUnitId, r.productId, r.personnelId,
          r.managementCommissionRate || 0, r.managementCommissionThreshold || 0, r.managementCommissionCondition || "",
          r.personalCommissionType === "fixed" ? "fixed" : "percentage",
          r.personalCommissionRate || 0, r.personalCommissionAmount || 0,
          r.personalCommissionThreshold || 0, r.personalCommissionCondition || "",
          r.rewardAmount || 0, r.rewardFrom || "", r.rewardTo || "",
          new Date().toISOString(), r.id],
      })
    );

    upsertSimple("monthlyAdjustments", "monthly_adjustments", body.monthlyAdjustments || [],
      (r) => ({
        sql: `INSERT INTO monthly_adjustments (id, personnel_id, year_month, leave_days, other_bonus, other_deduction, note, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.personnelId, r.yearMonth, r.leaveDays || 0, r.otherBonus || 0, r.otherDeduction || 0,
          r.note || "", r.createdAt || new Date().toISOString(), r.createdBy || null],
      }),
      (r) => ({
        sql: `UPDATE monthly_adjustments SET personnel_id=?, year_month=?, leave_days=?, other_bonus=?, other_deduction=?, note=?, created_by=? WHERE id=?`,
        args: [r.personnelId, r.yearMonth, r.leaveDays || 0, r.otherBonus || 0, r.otherDeduction || 0, r.note || "", r.createdBy || null, r.id],
      })
    );

    upsertSimple("performanceTargets", "performance_targets", body.performanceTargets || [],
      (r) => ({
        sql: `INSERT INTO performance_targets (id, sales_unit_id, year_month, personnel_id, target_amount, note, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.salesUnitId, r.yearMonth, r.personnelId || null, r.targetAmount || 0, r.note || "",
          r.createdAt || new Date().toISOString(), r.createdBy || null],
      }),
      (r) => ({
        sql: `UPDATE performance_targets SET sales_unit_id=?, year_month=?, personnel_id=?, target_amount=?, note=?, created_by=? WHERE id=?`,
        args: [r.salesUnitId, r.yearMonth, r.personnelId || null, r.targetAmount || 0, r.note || "", r.createdBy || null, r.id],
      })
    );

    upsertSimple("positionGroupLabels", "position_group_labels", body.positionGroupLabels || [],
      (r) => ({
        sql: `INSERT INTO position_group_labels (id, keyword, label, color, description, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.keyword, r.label, r.color || "gray", r.description || "", r.createdAt || new Date().toISOString()],
      }),
      (r) => ({
        sql: `UPDATE position_group_labels SET keyword=?, label=?, color=?, description=? WHERE id=?`,
        args: [r.keyword, r.label, r.color || "gray", r.description || "", r.id],
      })
    );

    upsertSimple("costChangeLogs", "cost_change_logs", body.costChangeLogs || [],
      (r) => ({
        sql: `INSERT INTO cost_change_logs (id, cost_record_id, action, reason, operator, operator_id, timestamp, summary, cost_record_remark)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.costRecordId, r.action, r.reason || "", r.operator || "", r.operatorId || "",
          r.timestamp || new Date().toISOString(), r.summary || "", r.costRecordRemark || ""],
      }),
      (r) => ({
        sql: `UPDATE cost_change_logs SET cost_record_id=?, action=?, reason=?, operator=?, operator_id=?, timestamp=?, summary=?, cost_record_remark=? WHERE id=?`,
        args: [r.costRecordId, r.action, r.reason || "", r.operator || "", r.operatorId || "",
          r.timestamp || new Date().toISOString(), r.summary || "", r.costRecordRemark || "", r.id],
      })
    );

    upsertSimple("notifications", "notifications", body.notifications || [],
      (r) => ({
        sql: `INSERT INTO notifications (id, type, title, message, timestamp, read) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.type || "cost_change", r.title || "", r.message || "", r.timestamp || new Date().toISOString(), r.read ? 1 : 0],
      }),
      (r) => ({
        sql: `UPDATE notifications SET type=?, title=?, message=?, timestamp=?, read=? WHERE id=?`,
        args: [r.type || "cost_change", r.title || "", r.message || "", r.timestamp || new Date().toISOString(), r.read ? 1 : 0, r.id],
      })
    );
    });

    res.json({ message: "数据迁移成功", stats });
  } catch (err: any) {
    res.status(500).json({ error: "迁移失败: " + err.message, stats });
  }
});

export default router;
