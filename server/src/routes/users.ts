import { Router } from "express";
import { getDb, rowToUser, generateId } from "../db";
import { authMiddleware, hashPassword } from "../auth";
import { requireRole } from "../middleware";
import type { UserRole, SystemUser } from "../types";

const router = Router();

// 所有路由都需要登录 + 超级管理员权限
router.use(authMiddleware, requireRole("superadmin"));

// GET /api/users - 获取所有用户
router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at").all();
  const users = rows.map(rowToUser).map((u: SystemUser) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    managedUnitIds: u.managedUnitIds,
    createdAt: u.createdAt,
  }));
  res.json(users);
});

// POST /api/users - 创建用户
router.post("/", (req, res) => {
  const { username, password, name, role, managedUnitIds } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: "用户名、密码、姓名、角色不能为空" });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "用户名已存在" });
  }

  const id = generateId("user");
  const hashed = hashPassword(password);
  const unitIds = JSON.stringify(managedUnitIds || []);

  db.prepare(`
    INSERT INTO users (id, username, password, name, role, managed_unit_ids)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, username, hashed, name, role, unitIds);

  res.json({
    id,
    username,
    name,
    role,
    managedUnitIds: managedUnitIds || [],
  });
});

// PUT /api/users/:id - 更新用户
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { username, password, name, role, managedUnitIds } = req.body;

  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "用户不存在" });
  }

  // 检查用户名唯一性
  if (username) {
    const dup = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, id);
    if (dup) {
      return res.status(409).json({ error: "用户名已存在" });
    }
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (username) { updates.push("username = ?"); values.push(username); }
  if (password) { updates.push("password = ?"); values.push(hashPassword(password)); }
  if (name) { updates.push("name = ?"); values.push(name); }
  if (role) { updates.push("role = ?"); values.push(role); }
  if (managedUnitIds !== undefined) { updates.push("managed_unit_ids = ?"); values.push(JSON.stringify(managedUnitIds)); }

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  res.json({ message: "更新成功" });
});

// DELETE /api/users/:id - 删除用户
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  if (id === "admin" || id === req.user!.id) {
    return res.status(400).json({ error: "不能删除默认管理员或当前登录用户" });
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "用户不存在" });
  }

  res.json({ message: "删除成功" });
});

export default router;
