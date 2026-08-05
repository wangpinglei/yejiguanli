// ===================== API 客户端 =====================
// 封装所有后端 API 调用，管理 JWT token

// 优先级：.env.production 的 VITE_API_BASE（/yeji/api）> 自动按 Vite base 拼接（/yeji/api）> 兜底 /api
export const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.BASE_URL + "api");

// ===================== Token 管理 =====================

const TOKEN_KEY = "pm_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ===================== 请求封装 =====================

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 401 → 清除 token，跳转登录（基于 Vite base，兼容 /yeji/ 子路径）
  if (res.status === 401) {
    removeToken();
    const loginPath = import.meta.env.BASE_URL + "login";
    if (window.location.pathname !== loginPath) {
      window.location.href = loginPath;
    }
    throw new Error("登录已过期，请重新登录");
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>("GET", path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => apiRequest<T>("PUT", path, body),
  delete: <T>(path: string) => apiRequest<T>("DELETE", path),
};

// ===================== API 类型 =====================

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
  managedUnitIds: string[];
  permissions?: import("@/config/modules").UserPermissions;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// ===================== Auth API =====================

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { username, password }),
  me: () => api.get<AuthUser>("/auth/me"),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.put("/auth/password", { oldPassword, newPassword }),
};

// ===================== Users API =====================

export interface UserItem {
  id: string;
  username: string;
  name: string;
  role: string;
  managedUnitIds: string[];
  permissions?: import("@/config/modules").UserPermissions;
  createdAt: string;
}

export const usersApi = {
  list: () => api.get<UserItem[]>("/users"),
  create: (data: {
    username: string;
    password: string;
    name: string;
    role: string;
    managedUnitIds: string[];
    permissions: import("@/config/modules").UserPermissions;
  }) => api.post<UserItem>("/users", data),
  update: (
    id: string,
    data: Partial<{
      username: string;
      password: string;
      name: string;
      role: string;
      managedUnitIds: string[];
      permissions: import("@/config/modules").UserPermissions;
    }>
  ) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
};

// ===================== Sales Units API =====================

export const salesUnitsApi = {
  list: () => api.get<any[]>("/sales-units"),
  create: (data: any) => api.post<any>("/sales-units", data),
  update: (id: string, data: any) => api.put<any>(`/sales-units/${id}`, data),
  delete: (id: string) => api.delete(`/sales-units/${id}`),
};

// ===================== Personnel API =====================

export const personnelApi = {
  list: () => api.get<any[]>("/personnel"),
  create: (data: any) => api.post<any>("/personnel", data),
  update: (id: string, data: any) => api.put<any>(`/personnel/${id}`, data),
  delete: (id: string) => api.delete(`/personnel/${id}`),
};

// ===================== Products API =====================

export const productsApi = {
  list: () => api.get<any[]>("/products"),
  create: (data: any) => api.post<any>("/products", data),
  update: (id: string, data: any) => api.put<any>(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
};

// ===================== Sales Records API =====================

export const salesRecordsApi = {
  list: (params?: { salesUnitId?: string; personnelId?: string }) => {
    const query = new URLSearchParams();
    if (params?.salesUnitId) query.set("salesUnitId", params.salesUnitId);
    if (params?.personnelId) query.set("personnelId", params.personnelId);
    const qs = query.toString();
    return api.get<any[]>(`/sales-records${qs ? `?${qs}` : ""}`);
  },
  create: (data: any) => api.post<any>("/sales-records", data),
  update: (id: string, data: any) => api.put<any>(`/sales-records/${id}`, data),
  delete: (id: string) => api.delete(`/sales-records/${id}`),
};

// ===================== Cost Records API =====================

export const costRecordsApi = {
  list: (params?: { salesUnitId?: string }) => {
    const query = new URLSearchParams();
    if (params?.salesUnitId) query.set("salesUnitId", params.salesUnitId);
    const qs = query.toString();
    return api.get<any[]>(`/cost-records${qs ? `?${qs}` : ""}`);
  },
  create: (data: any) => api.post<any>("/cost-records", data),
  update: (id: string, data: any) => api.put<any>(`/cost-records/${id}`, data),
  delete: (id: string) => api.delete(`/cost-records/${id}`),
};

// ===================== Migrate API =====================

export const migrateApi = {
  migrate: (data: { salesUnits: any[]; personnel: any[]; products: any[]; salesRecords: any[]; costRecords: any[] }) =>
    api.post<{ message: string; stats: any }>("/migrate", data),
};
