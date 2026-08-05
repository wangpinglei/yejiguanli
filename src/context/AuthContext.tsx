import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { UserRole } from "@/types";
import {
  normalizePermissions,
  type UserPermissions,
} from "@/config/modules";
import { authApi, usersApi, setToken, removeToken, getToken } from "@/lib/api";
import type { AuthUser as ApiAuthUser, UserItem } from "@/lib/api";

// ===================== 用户类型 =====================
export interface SystemUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  managedUnitIds: string[];
  permissions: UserPermissions;
  createdAt?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  managedUnitIds: string[];
  permissions: UserPermissions;
}

interface AuthContextType {
  user: AuthUser | null;
  users: SystemUser[];
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  addUser: (u: {
    username: string;
    password: string;
    name: string;
    role: UserRole;
    managedUnitIds: string[];
    permissions: UserPermissions;
  }) => Promise<void>;
  updateUser: (
    id: string,
    u: Partial<{
      username: string;
      password: string;
      name: string;
      role: UserRole;
      managedUnitIds: string[];
      permissions: UserPermissions;
    }>
  ) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  refreshUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "超级管理员",
  user: "自定义权限",
  group_admin: "集团管理",
  military_cadre: "军工干部",
  org_department: "组织部",
  unit_leader: "单位负责人",
  unit_manager: "单位管理员",
};

const AUTH_KEY = "pm5_auth_user";

function loadAuthUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        permissions: normalizePermissions(parsed.permissions, parsed.role),
      };
    }
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
    managedUnitIds: u.managedUnitIds || [],
    permissions: normalizePermissions(u.permissions, u.role),
  };
}

function canManageUsers(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  return Boolean(user.permissions?.users?.edit || user.permissions?.users?.view);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const token = getToken();
      const cachedUser = loadAuthUser();

      if (token && cachedUser) {
        setUser(cachedUser);
        try {
          const me = await authApi.me();
          const authUser = toAuthUser(me);
          setUser(authUser);
          saveAuthUser(authUser);
        } catch {
          removeToken();
          saveAuthUser(null);
          setUser(null);
        }
      } else if (token) {
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
        managedUnitIds: u.managedUnitIds || [],
        permissions: normalizePermissions(u.permissions, u.role),
        createdAt: u.createdAt,
      })));
    } catch {
      // 无权限时忽略
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    if (canManageUsers(user)) {
      void refreshUsers();
    }
  }, [loading, user, refreshUsers]);

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
    async (u: {
      username: string;
      password: string;
      name: string;
      role: UserRole;
      managedUnitIds: string[];
      permissions: UserPermissions;
    }) => {
      await usersApi.create(u);
      await refreshUsers();
    },
    [refreshUsers]
  );

  const updateUser = useCallback(
    async (
      id: string,
      u: Partial<{
        username: string;
        password: string;
        name: string;
        role: UserRole;
        managedUnitIds: string[];
        permissions: UserPermissions;
      }>
    ) => {
      await usersApi.update(id, u);
      await refreshUsers();
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
