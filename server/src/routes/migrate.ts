import { Router } from "express";
import { getDb } from "../db";
import { authMiddleware } from "../auth";
import { requireRole } from "../middleware";

const router = Router();

// 数据迁移仅超级管理员可用
router.use(authMiddleware, requireRole("superadmin"));

// POST /api/migrate - 从 localStorage 导入数据到数据库
router.post("/", (req, res) => {
  const { salesUnits = [], personnel = [], products = [], salesRecords = [], costRecords = [] } = req.body;

  const db = getDb();
  const stats = { salesUnits: 0, personnel: 0, products: 0, salesRecords: 0, costRecords: 0 };

  const migrateAll = db.transaction(() => {
    // 销售单位
    for (const unit of salesUnits) {
      const exists = db.prepare("SELECT id FROM sales_units WHERE id = ?").get(unit.id);
      if (exists) {
        db.prepare(`
          UPDATE sales_units SET name=?, type=?, address=?, contact=?, contact_phone=?, description=?,
            group_admin_id=?, military_cadre_id=?, org_dept_id=?, unit_leader_id=?
          WHERE id=?
        `).run(unit.name, unit.type || "company", unit.address || "", unit.contact || "", unit.contactPhone || "", unit.description || "", unit.groupAdminId || null, unit.militaryCadreId || null, unit.orgDeptId || null, unit.unitLeaderId || null, unit.id);
      } else {
        db.prepare(`
          INSERT INTO sales_units (id, name, type, address, contact, contact_phone, description, group_admin_id, military_cadre_id, org_dept_id, unit_leader_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(unit.id, unit.name, unit.type || "company", unit.address || "", unit.contact || "", unit.contactPhone || "", unit.description || "", unit.groupAdminId || null, unit.militaryCadreId || null, unit.orgDeptId || null, unit.unitLeaderId || null, unit.createdAt || new Date().toISOString());
      }
      stats.salesUnits++;
    }

    // 人员
    for (const p of personnel) {
      const exists = db.prepare("SELECT id FROM personnel WHERE id = ?").get(p.id);
      const salaryJson = JSON.stringify(p.salary || {});
      if (exists) {
        db.prepare(`
          UPDATE personnel SET name=?, sales_unit_id=?, position=?, phone=?, email=?, salary=?, social_insurance=?, housing_fund=?, hire_date=?, resign_date=?, status=?
          WHERE id=?
        `).run(p.name, p.salesUnitId, p.position || "", p.phone || "", p.email || "", salaryJson, p.socialInsurance || 0, p.housingFund || 0, p.hireDate || "", p.resignDate || null, p.status || "active", p.id);
      } else {
        db.prepare(`
          INSERT INTO personnel (id, name, sales_unit_id, position, phone, email, salary, social_insurance, housing_fund, hire_date, resign_date, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(p.id, p.name, p.salesUnitId, p.position || "", p.phone || "", p.email || "", salaryJson, p.socialInsurance || 0, p.housingFund || 0, p.hireDate || "", p.resignDate || null, p.status || "active");
      }
      stats.personnel++;
    }

    // 产品
    for (const prod of products) {
      const exists = db.prepare("SELECT id FROM products WHERE id = ?").get(prod.id);
      if (exists) {
        db.prepare(`UPDATE products SET name=?, category=?, unit_price=?, unit_cost=?, description=? WHERE id=?`)
          .run(prod.name, prod.category || "", prod.unitPrice || 0, prod.unitCost || 0, prod.description || "", prod.id);
      } else {
        db.prepare(`INSERT INTO products (id, name, category, unit_price, unit_cost, description) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(prod.id, prod.name, prod.category || "", prod.unitPrice || 0, prod.unitCost || 0, prod.description || "");
      }
      stats.products++;
    }

    // 销售记录
    for (const sr of salesRecords) {
      const exists = db.prepare("SELECT id FROM sales_records WHERE id = ?").get(sr.id);
      if (exists) {
        db.prepare(`UPDATE sales_records SET sales_unit_id=?, personnel_id=?, product_id=?, quantity=?, unit_price=?, total_amount=?, sale_date=?, remark=? WHERE id=?`)
          .run(sr.salesUnitId, sr.personnelId, sr.productId, sr.quantity || 1, sr.unitPrice || 0, sr.totalAmount || 0, sr.saleDate, sr.remark || "", sr.id);
      } else {
        db.prepare(`INSERT INTO sales_records (id, sales_unit_id, personnel_id, product_id, quantity, unit_price, total_amount, sale_date, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(sr.id, sr.salesUnitId, sr.personnelId, sr.productId, sr.quantity || 1, sr.unitPrice || 0, sr.totalAmount || 0, sr.saleDate, sr.remark || "");
      }
      stats.salesRecords++;
    }

    // 成本记录
    for (const cr of costRecords) {
      const exists = db.prepare("SELECT id FROM cost_records WHERE id = ?").get(cr.id);
      const itemsJson = JSON.stringify(cr.items || []);
      if (exists) {
        db.prepare(`UPDATE cost_records SET sales_unit_id=?, date=?, items=?, total_cost=?, remark=?, created_by=? WHERE id=?`)
          .run(cr.salesUnitId, cr.date, itemsJson, cr.totalCost || 0, cr.remark || "", cr.createdBy || null, cr.id);
      } else {
        db.prepare(`INSERT INTO cost_records (id, sales_unit_id, date, items, total_cost, remark, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(cr.id, cr.salesUnitId, cr.date, itemsJson, cr.totalCost || 0, cr.remark || "", cr.createdAt || new Date().toISOString(), cr.createdBy || null);
      }
      stats.costRecords++;
    }
  });

  try {
    migrateAll();
    res.json({ message: "数据迁移成功", stats });
  } catch (err: any) {
    res.status(500).json({ error: "迁移失败: " + err.message, stats });
  }
});

export default router;
