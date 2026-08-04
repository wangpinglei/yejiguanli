import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { UserRole } from "@/types";
import { authApi, usersApi, setToken, removeToken, getToken } from "@/lib/api";
import type { AuthUser as ApiAuthUser, UserItem } from "@/lib/api";

// ===================== 用户类型 =====================
export interface SystemUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  managedUnitIds: string[];
  createdAt?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  managedUnitIds: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  users: SystemUser[];
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  addUser: (u: { username: string; password: string; name: string; role: UserRole; managedUnitIds: string[] }) => Promise<void>;
  updateUser: (id: string, u: Partial<{ username: string; password: string; name: string; role: UserRole; managedUnitIds: string[] }>) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  refreshUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// 角色标签映射
export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: "超级管理员",
  group_admin: "集团管理",
  military_cadre: "军工干部",
  org_department: "组织部",
  unit_leader: "单位负责人",
  unit_manager: "单位管理员",
};

const AUTH_KEY = "pm5_auth_user";

// sessionStorage：用户信息（关闭标签页清空）
function loadAuthUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveAuthUser(user: AuthUser | null) {
  if (user) {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(AUTH_KEY);
  }
}

function toAuthUser(u: ApiAuthUser): AuthUser {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role as UserRole,
    managedUnitIds: u.managedUnitIds,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);

  // 初始化：尝试用已有 token 恢复登录状态
  useEffect(() => {
    const initAuth = async () => {
      const token = getToken();
      const cachedUser = loadAuthUser();

      if (token && cachedUser) {
        // 有 token 且有缓存用户 → 先用缓存渲染，后台验证
        setUser(cachedUser);
        try {
          const me = await authApi.me();
          const authUser = toAuthUser(me);
          setUser(authUser);
          saveAuthUser(authUser);
        } catch {
          // token 无效，清除
          removeToken();
          saveAuthUser(null);
          setUser(null);
        }
      } else if (token) {
        // 有 token 但没有缓存用户 → 调接口获取
        try {
          const me = await authApi.me();
          const authUser = toAuthUser(me);
          setUser(authUser);
          saveAuthUser(authUser);
        } catch {
          removeToken();
          setUser(null);
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const refreshUsers = useCallback(async () => {
    try {
      const list = await usersApi.list();
      setUsers(list.map((u: UserItem) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role as UserRole,
        managedUnitIds: u.managedUnitIds,
        createdAt: u.createdAt,
      })));
    } catch {
      // 非超管或无权限时忽略
    }
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const res = await authApi.login(username, password);
    setToken(res.token);
    const authUser = toAuthUser(res.user);
    setUser(authUser);
    saveAuthUser(authUser);
  }, []);

  const logout = useCallback(() => {
    removeToken();
    saveAuthUser(null);
    setUser(null);
  }, []);

  const addUser = useCallback(
    async (u: { username: string; password: string; name: string; role: UserRole; managedUnitIds: string[] }) => {
      await usersApi.create(u);
      await refreshUsers();
    },
    [refreshUsers]
  );

  const updateUser = useCallback(
    async (id: string, u: Partial<{ username: string; password: string; name: string; role: UserRole; managedUnitIds: string[] }>) => {
      await usersApi.update(id, u);
      await refreshUsers();
      // 如果更新的是当前登录用户，重新获取
      if (user?.id === id) {
        try {
          const me = await authApi.me();
          const authUser = toAuthUser(me);
          setUser(authUser);
          saveAuthUser(authUser);
        } catch {}
      }
    },
    [user, refreshUsers]
  );

  const deleteUser = useCallback(
    async (id: string) => {
      await usersApi.delete(id);
      await refreshUsers();
    },
    [refreshUsers]
  );

  return (
    <AuthContext.Provider
      value={{ user, users, loading, login, logout, addUser, updateUser, deleteUser, refreshUsers }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
