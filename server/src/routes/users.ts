import { Router } from "express";
import { getDb, rowToUser, generateId } from "../db";
import { authMiddleware, hashPassword } from "../auth";
import { requireUsersManage } from "../middleware";
import type { SystemUser, UserRole } from "../types";
import { normalizePermissions, createFullPermissions } from "../permissions";

const router = Router();

router.use(authMiddleware, requireUsersManage);

function toPublicUser(u: SystemUser) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    managedUnitIds: u.managedUnitIds,
    permissions: u.permissions,
    createdAt: u.createdAt,
  };
}

// GET /api/users - 获取所有用户
router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at").all();
  res.json(rows.map(rowToUser).map(toPublicUser));
});

// POST /api/users - 创建用户
router.post("/", (req, res) => {
  const { username, password, name, role, managedUnitIds, permissions } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: "用户名、密码、姓名不能为空" });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "用户名已存在" });
  }

  const nextRole = (role === "superadmin" ? "superadmin" : "user") as UserRole;
  const nextPerms = nextRole === "superadmin"
    ? createFullPermissions()
    : normalizePermissions(permissions, nextRole);

  const id = generateId("user");
  const hashed = hashPassword(password);
  const unitIds = JSON.stringify(managedUnitIds || []);

  db.prepare(`
    INSERT INTO users (id, username, password, name, role, managed_unit_ids, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, username, hashed, name, nextRole, unitIds, JSON.stringify(nextPerms));

  res.json({
    id,
    username,
    name,
    role: nextRole,
    managedUnitIds: managedUnitIds || [],
    permissions: nextPerms,
  });
});

// PUT /api/users/:id - 更新用户
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { username, password, name, role, managedUnitIds, permissions } = req.body;

  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "用户不存在" });
  }

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

  // 默认管理员账号不可降级
  if (role && id !== "admin") {
    updates.push("role = ?");
    values.push(role === "superadmin" ? "superadmin" : "user");
  }

  if (managedUnitIds !== undefined) {
    updates.push("managed_unit_ids = ?");
    values.push(JSON.stringify(managedUnitIds));
  }

  if (permissions !== undefined) {
    const willBeSuper =
      id === "admin" ||
      role === "superadmin" ||
      (role === undefined && existing.role === "superadmin");
    const nextPerms = willBeSuper
      ? createFullPermissions()
      : normalizePermissions(permissions, "user");
    updates.push("permissions = ?");
    values.push(JSON.stringify(nextPerms));
  }

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
