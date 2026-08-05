import { useState } from "react";
import { useAuth, type SystemUser } from "@/context/AuthContext";
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
import { Plus, Pencil, Trash2, Lock, Eye, EyeOff, Shield } from "lucide-react";
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

function summarizePermissions(perms: UserPermissions, role: string): string {
  if (role === "superadmin") return "全部权限";
  const viewCount = MODULE_DEFS.filter((m) => perms[m.key]?.view).length;
  const editCount = MODULE_DEFS.filter((m) => perms[m.key]?.edit).length;
  if (viewCount === 0 && editCount === 0) return "未分配";
  return `查看 ${viewCount} · 编辑 ${editCount}`;
}

export default function UserManagement() {
  const { users, addUser, updateUser, deleteUser, user: currentUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    username: "",
    password: "",
    isSuperadmin: false,
    permissions: createEmptyPermissions(),
  });

  const openAdd = () => {
    setEditingUser(null);
    setForm({
      username: "",
      password: "",
      isSuperadmin: false,
      permissions: createEmptyPermissions(),
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

    try {
      if (editingUser) {
        const updateData: Record<string, unknown> = {
          username: form.username.trim(),
          name: form.username.trim(),
          role,
          permissions,
        };
        if (form.password) updateData.password = form.password;
        await updateUser(editingUser.id, updateData);
      } else {
        await addUser({
          username: form.username.trim(),
          password: form.password,
          name: form.username.trim(),
          role,
          managedUnitIds: [],
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
        description="开通登录账号，按导航模块分配查看权限与编辑权限"
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
                            {summarizePermissions(perms, u.role)}
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
                      <p className="mt-2 text-xs">请点击「开通权限」创建登录账号并分配模块权限。</p>
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
              配置登录账号，并为左侧导航各模块分配查看 / 编辑权限
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
                  拥有全部模块的查看与编辑权限
                </span>
              </Label>
            </div>

            {!form.isSuperadmin && (
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
    </div>
  );
}
