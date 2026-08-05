import { useMemo, useState } from "react";
import { useAuth, type SystemUser } from "@/context/AuthContext";
import { loadLegacyLocalStoragePayload, useData } from "@/context/DataContext";
import { migrateApi } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import type { UserRole } from "@/types";
import {
  MODULE_DEFS,
  createEmptyPermissions,
  createFullPermissions,
  normalizePermissions,
  type ModuleKey,
  type UserPermissions,
} from "@/config/modules";
import { Plus, Pencil, Trash2, Lock, Eye, EyeOff, Shield, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function summarizePermissions(
  perms: UserPermissions,
  role: string,
  managedUnitIds: string[],
  unitNameMap: Record<string, string>
): string {
  if (role === "superadmin") return "全部权限 · 全部单位";
  const viewCount = MODULE_DEFS.filter((m) => perms[m.key]?.view).length;
  const editCount = MODULE_DEFS.filter((m) => perms[m.key]?.edit).length;
  const unitPart =
    managedUnitIds.length === 0
      ? "未分配单位"
      : managedUnitIds.length <= 2
        ? managedUnitIds.map((id) => unitNameMap[id] || id).join("、")
        : `可见单位 ${managedUnitIds.length}`;
  if (viewCount === 0 && editCount === 0) return `未分配模块 · ${unitPart}`;
  return `查看 ${viewCount} · 编辑 ${editCount} · ${unitPart}`;
}

export default function UserManagement() {
  const { users, addUser, updateUser, deleteUser, user: currentUser } = useAuth();
  const { refreshAll, salesUnits } = useData();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const unitNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of salesUnits) map[u.id] = u.name;
    return map;
  }, [salesUnits]);

  async function handleImportLegacy() {
    if (!confirm("将把本浏览器中的旧 localStorage 业务数据导入服务器（按 id 覆盖/合并）。确认继续？")) {
      return;
    }
    setMigrating(true);
    try {
      const payload = loadLegacyLocalStoragePayload();
      const res = await migrateApi.migrate(payload);
      await refreshAll();
      alert(`导入成功：${JSON.stringify(res.stats)}`);
    } catch (e: any) {
      alert("导入失败：" + (e.message || "未知错误"));
    } finally {
      setMigrating(false);
    }
  }

  const [form, setForm] = useState({
    username: "",
    password: "",
    isSuperadmin: false,
    permissions: createEmptyPermissions(),
    managedUnitIds: [] as string[],
  });

  const openAdd = () => {
    setEditingUser(null);
    setForm({
      username: "",
      password: "",
      isSuperadmin: false,
      permissions: createEmptyPermissions(),
      managedUnitIds: [],
    });
    setShowPassword(false);
    setDialogOpen(true);
  };

  const openEdit = (u: SystemUser) => {
    setEditingUser(u);
    setForm({
      username: u.username,
      password: "",
      isSuperadmin: u.role === "superadmin",
      permissions: normalizePermissions(u.permissions, u.role),
      managedUnitIds: [...(u.managedUnitIds || [])],
    });
    setShowPassword(false);
    setDialogOpen(true);
  };

  function setModulePerm(key: ModuleKey, field: "view" | "edit", checked: boolean) {
    setForm((prev) => {
      const next = { ...prev.permissions };
      const cur = { ...next[key] };
      if (field === "edit") {
        cur.edit = checked;
        if (checked) cur.view = true;
      } else {
        cur.view = checked;
        if (!checked) cur.edit = false;
      }
      next[key] = cur;
      return { ...prev, permissions: next, isSuperadmin: false };
    });
  }

  const allViewChecked = MODULE_DEFS.every((m) => form.permissions[m.key]?.view);
  const editableModules = MODULE_DEFS.filter((m) => m.canEdit);
  const allEditChecked =
    editableModules.length > 0 &&
    editableModules.every((m) => form.permissions[m.key]?.edit);
  const allUnitsChecked =
    salesUnits.length > 0 && salesUnits.every((u) => form.managedUnitIds.includes(u.id));

  function handleSelectAllView(checked: boolean) {
    setForm((prev) => {
      const next = { ...prev.permissions };
      for (const m of MODULE_DEFS) {
        next[m.key] = {
          view: checked,
          edit: checked ? next[m.key].edit : false,
        };
      }
      return { ...prev, permissions: next, isSuperadmin: false };
    });
  }

  function handleSelectAllEdit(checked: boolean) {
    setForm((prev) => {
      const next = { ...prev.permissions };
      for (const m of MODULE_DEFS) {
        if (!m.canEdit) continue;
        next[m.key] = {
          view: checked ? true : next[m.key].view,
          edit: checked,
        };
      }
      return { ...prev, permissions: next, isSuperadmin: false };
    });
  }

  function handleToggleSuperadmin(checked: boolean) {
    setForm((prev) => ({
      ...prev,
      isSuperadmin: checked,
      permissions: checked ? createFullPermissions() : createEmptyPermissions(),
      managedUnitIds: checked ? [] : prev.managedUnitIds,
    }));
  }

  function handleToggleUnit(unitId: string, checked: boolean) {
    setForm((prev) => {
      const set = new Set(prev.managedUnitIds);
      if (checked) set.add(unitId);
      else set.delete(unitId);
      return { ...prev, managedUnitIds: Array.from(set), isSuperadmin: false };
    });
  }

  function handleSelectAllUnits(checked: boolean) {
    setForm((prev) => ({
      ...prev,
      managedUnitIds: checked ? salesUnits.map((u) => u.id) : [],
      isSuperadmin: false,
    }));
  }

  const handleSubmit = async () => {
    if (!form.username.trim()) return;
    if (!editingUser && !form.password.trim()) return;
    const duplicate = users.find(
      (u) => u.username === form.username && u.id !== editingUser?.id
    );
    if (duplicate) {
      alert("用户名已存在，请更换");
      return;
    }

    const role: UserRole = form.isSuperadmin ? "superadmin" : "user";
    const permissions = form.isSuperadmin
      ? createFullPermissions()
      : form.permissions;
    const managedUnitIds = form.isSuperadmin ? [] : form.managedUnitIds;

    if (!form.isSuperadmin && managedUnitIds.length === 0) {
      alert("普通账号必须至少勾选 1 个可见销售单位");
      return;
    }

    try {
      if (editingUser) {
        const updateData: Record<string, unknown> = {
          username: form.username.trim(),
          name: form.username.trim(),
          role,
          permissions,
          managedUnitIds,
        };
        if (form.password) updateData.password = form.password;
        await updateUser(editingUser.id, updateData);
      } else {
        await addUser({
          username: form.username.trim(),
          password: form.password,
          name: form.username.trim(),
          role,
          managedUnitIds,
          permissions,
        });
      }
      setDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteUser(deleteId);
        setDeleteId(null);
      } catch (error: any) {
        alert("删除失败: " + (error.message || "未知错误"));
      }
    }
  };

  const isAdminLocked = editingUser?.id === "admin";

  return (
    <div>
      <PageHeader
        title="权限分配"
        description="开通登录账号，分配模块权限与可见销售单位"
        action={
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />开通权限
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>登录账号</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>权限概览</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const perms = normalizePermissions(u.permissions, u.role);
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-xs text-primary">
                              {u.name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{u.name}</p>
                            {u.id === currentUser?.id && (
                              <span className="text-xs text-primary">当前登录</span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{u.username}</TableCell>
                      <TableCell>
                        {u.role === "superadmin" ? (
                          <Badge className="bg-violet-100 text-violet-700">
                            <Shield className="mr-1 h-3 w-3" />超级管理员
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {summarizePermissions(
                              perms,
                              u.role,
                              u.managedUnitIds || [],
                              unitNameMap
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(u)}
                            disabled={u.id === "admin" && currentUser?.id !== "admin"}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(u.id)}
                            disabled={u.id === "admin"}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                      <p>暂无登录权限账号</p>
                      <p className="mt-2 text-xs">请点击「开通权限」创建登录账号并分配模块与单位。</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUser ? "编辑权限" : "开通登录权限"}</DialogTitle>
            <DialogDescription>
              配置登录账号、模块权限，以及可查看的销售单位范围
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>用户名 *</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="登录用户名"
                disabled={isAdminLocked}
              />
            </div>

            <div className="space-y-2">
              <Label>密码 {editingUser ? "（留空不修改）" : "*"}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="密码"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-3 rounded-lg border p-3">
              <Checkbox
                id="is-superadmin"
                checked={form.isSuperadmin}
                disabled={isAdminLocked}
                onCheckedChange={(v) => handleToggleSuperadmin(Boolean(v))}
              />
              <Label htmlFor="is-superadmin" className="cursor-pointer font-normal">
                <span className="font-medium">超级管理员</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  拥有全部模块与全部单位权限
                </span>
              </Label>
            </div>

            {!form.isSuperadmin && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>可见销售单位 *</Label>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={allUnitsChecked}
                        onCheckedChange={(v) => handleSelectAllUnits(Boolean(v))}
                        disabled={salesUnits.length === 0}
                      />
                      全选
                    </label>
                  </div>
                  <div className="rounded-lg border max-h-40 overflow-y-auto p-2 space-y-1">
                    {salesUnits.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-2">
                        暂无销售单位，请先在「销售单位」中录入
                      </p>
                    ) : (
                      salesUnits.map((unit) => (
                        <label
                          key={unit.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                        >
                          <Checkbox
                            checked={form.managedUnitIds.includes(unit.id)}
                            onCheckedChange={(v) => handleToggleUnit(unit.id, Boolean(v))}
                          />
                          <span className="text-sm">{unit.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    普通账号必须至少勾选 1 个单位；仅能查看/编辑这些单位内的数据。
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>模块权限（对应左侧导航）</Label>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>功能模块</TableHead>
                          <TableHead className="w-28 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span>查看</span>
                              <label className="flex items-center gap-1 text-xs font-normal text-muted-foreground cursor-pointer">
                                <Checkbox
                                  checked={allViewChecked}
                                  onCheckedChange={(v) => handleSelectAllView(Boolean(v))}
                                />
                                全选
                              </label>
                            </div>
                          </TableHead>
                          <TableHead className="w-28 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span>编辑</span>
                              <label className="flex items-center gap-1 text-xs font-normal text-muted-foreground cursor-pointer">
                                <Checkbox
                                  checked={allEditChecked}
                                  onCheckedChange={(v) => handleSelectAllEdit(Boolean(v))}
                                />
                                全选
                              </label>
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {MODULE_DEFS.map((m) => {
                          const perm = form.permissions[m.key];
                          return (
                            <TableRow key={m.key}>
                              <TableCell className="text-sm">{m.label}</TableCell>
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={perm.view}
                                  onCheckedChange={(v) => setModulePerm(m.key, "view", Boolean(v))}
                                />
                              </TableCell>
                              <TableCell className="text-center">
                                {m.canEdit ? (
                                  <Checkbox
                                    checked={perm.edit}
                                    onCheckedChange={(v) => setModulePerm(m.key, "edit", Boolean(v))}
                                  />
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    勾选编辑时会自动勾选查看。数据看板、单位战报仅支持查看。
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingUser ? "保存" : "开通"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除该登录权限账号吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {currentUser?.role === "superadmin" && (
        <Card className="mt-6 border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 shrink-0">
                <Database className="h-5 w-5 text-amber-700" />
              </div>
              <div>
                <p className="font-medium">导入本机旧数据到服务器</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  业务数据已改为存服务器。若本浏览器还有以前的 localStorage 数据，可一键导入（仅超管）。
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={migrating} onClick={handleImportLegacy}>
              {migrating ? "导入中…" : "从本机导入"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
