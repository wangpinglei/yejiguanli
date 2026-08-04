import { Router } from "express";
import { getDb, rowToUser } from "../db";
import { signToken, comparePassword, hashPassword, authMiddleware } from "../auth";
import type { JwtPayload } from "../types";

const router = Router();

// POST /api/auth/login - 登录
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const user = rowToUser(row);
  if (!comparePassword(password, user.password)) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const payload: JwtPayload = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    managedUnitIds: user.managedUnitIds,
  };

  const token = signToken(payload);
  res.json({ token, user: payload });
});

// GET /api/auth/me - 获取当前用户信息
router.get("/me", authMiddleware, (req, res) => {
  res.json(req.user);
});

// PUT /api/auth/password - 修改密码
router.put("/password", authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "旧密码和新密码不能为空" });
  }

  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user!.id);
  if (!row) {
    return res.status(404).json({ error: "用户不存在" });
  }

  const user = rowToUser(row);
  if (!comparePassword(oldPassword, user.password)) {
    return res.status(400).json({ error: "旧密码错误" });
  }

  const hashed = hashPassword(newPassword);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, req.user!.id);
  res.json({ message: "密码修改成功" });
});

export default router;
