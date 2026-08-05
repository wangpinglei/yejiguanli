export const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.BASE_URL + "api");

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

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    removeToken();
    const loginPath = import.meta.env.BASE_URL + "login";
    if (window.location.pathname !== loginPath) {
      window.location.href = loginPath;
    }
    throw new Error("登录已过期，请重新登录");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>("GET", path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => apiRequest<T>("PUT", path, body),
  delete: <T>(path: string) => apiRequest<T>("DELETE", path),
};

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

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { username, password }),
  me: () => api.get<AuthUser>("/auth/me"),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.put("/auth/password", { oldPassword, newPassword }),
};

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

export const salesUnitsApi = {
  list: () => api.get<any[]>("/sales-units"),
  create: (data: any) => api.post<any>("/sales-units", data),
  update: (id: string, data: any) => api.put<any>(`/sales-units/${id}`, data),
  delete: (id: string) => api.delete(`/sales-units/${id}`),
};

export const personnelApi = {
  list: () => api.get<any[]>("/personnel"),
  create: (data: any) => api.post<any>("/personnel", data),
  update: (id: string, data: any) => api.put<any>(`/personnel/${id}`, data),
  delete: (id: string) => api.delete(`/personnel/${id}`),
};

export const productsApi = {
  list: () => api.get<any[]>("/products"),
  create: (data: any) => api.post<any>("/products", data),
  ensure: (data: any) => api.post<any>("/products/ensure", data),
  update: (id: string, data: any) => api.put<any>(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
};

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

export const incomeRecordsApi = {
  list: () => api.get<any[]>("/income-records"),
  create: (data: any) => api.post<any>("/income-records", data),
  update: (id: string, data: any) => api.put<any>(`/income-records/${id}`, data),
  delete: (id: string) => api.delete(`/income-records/${id}`),
};

export const revenueSettlementsApi = {
  list: () => api.get<any[]>("/revenue-settlements"),
  upsert: (data: any) => api.post<any>("/revenue-settlements/upsert", data),
  delete: (id: string) => api.delete(`/revenue-settlements/${id}`),
};

export const unitProductSettlementsApi = {
  list: () => api.get<any[]>("/unit-product-settlements"),
  upsert: (data: any) => api.post<any>("/unit-product-settlements/upsert", data),
  batch: (items: any[]) => api.post<any[]>("/unit-product-settlements/batch", items),
  delete: (id: string) => api.delete(`/unit-product-settlements/${id}`),
};

export const productPersonCommissionsApi = {
  list: () => api.get<any[]>("/product-person-commissions"),
  upsert: (data: any) => api.post<any>("/product-person-commissions/upsert", data),
  batch: (items: any[]) => api.post<any[]>("/product-person-commissions/batch", items),
  delete: (id: string) => api.delete(`/product-person-commissions/${id}`),
};

export const costChangeLogsApi = {
  list: () => api.get<any[]>("/cost-change-logs"),
  create: (data: any) => api.post<any>("/cost-change-logs", data),
};

export const notificationsApi = {
  list: () => api.get<any[]>("/notifications"),
  create: (data: any) => api.post<any>("/notifications", data),
  markRead: (id: string) => api.put<any>(`/notifications/${id}/read`),
  markAllRead: () => api.put<any>("/notifications/read-all"),
};

export const monthlyAdjustmentsApi = {
  list: () => api.get<any[]>("/monthly-adjustments"),
  upsert: (data: any) => api.post<any>("/monthly-adjustments/upsert", data),
  delete: (id: string) => api.delete(`/monthly-adjustments/${id}`),
};

export const performanceTargetsApi = {
  list: () => api.get<any[]>("/performance-targets"),
  upsert: (data: any) => api.post<any>("/performance-targets/upsert", data),
  batch: (items: any[]) => api.post<any[]>("/performance-targets/batch", items),
  delete: (id: string) => api.delete(`/performance-targets/${id}`),
};

export const positionGroupLabelsApi = {
  list: () => api.get<any[]>("/position-group-labels"),
  create: (data: any) => api.post<any>("/position-group-labels", data),
  update: (id: string, data: any) => api.put<any>(`/position-group-labels/${id}`, data),
  delete: (id: string) => api.delete(`/position-group-labels/${id}`),
};

export const migrateApi = {
  migrate: (data: Record<string, any>) =>
    api.post<{ message: string; stats: any }>("/migrate", data),
};
