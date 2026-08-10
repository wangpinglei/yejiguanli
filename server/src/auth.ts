import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { getDb, rowToUser } from "./db";
import type { JwtPayload, UserRole } from "./types";

const JWT_SECRET = process.env.JWT_SECRET || "pm_secure_secret_key_2026_change_in_production";
const JWT_EXPIRES_IN = "7d";

// ===================== 密码工具 =====================

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// ===================== JWT 工具 =====================

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ===================== 认证中间件 =====================

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * 验证 JWT；权限/可见单位以数据库为准，
 * 避免超管刚改完权限，对方仍拿登录时旧 token 无法编辑。
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "未登录或 token 缺失" });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "token 无效或已过期" });
  }

  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
    if (!row) {
      return res.status(401).json({ error: "用户不存在或已删除" });
    }
    const user = rowToUser(row);
    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role as UserRole,
      managedUnitIds: user.managedUnitIds,
      permissions: user.permissions,
    };
  } catch {
    // 库异常时回退 JWT，避免全站不可用
    req.user = payload;
  }
  next();
}

// 可选认证：有 token 就解析，没有也放行
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}
