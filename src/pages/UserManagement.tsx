import { useState } from "react";
import { useAuth, type SystemUser } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import { PageHeader } from "@/components/PageHeader";
import type { UserRole } from "@/types";
import {
  Plus, Pencil, Trash2, Shield, UserCog, Lock, Eye, EyeOff, Building2, Users, UserCheck, Briefcase,
} from "lucide-react";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const roleConfig: Record<UserRole, { label: string; color: string; icon: React.ComponentType<{ className?: string }>; desc: string }> = {
  superadmin: { label: "超级管理员", color: "bg-violet-100 text-violet-700", icon: Shield, desc: "全部权限，管理所有数据和用户" },
  group_admin: { label: "集团管理", color: "bg-indigo-100 text-indigo-700", icon: Building2, desc: "管理分配的销售单位，可增删改单位数据" },
  military_cadre: { label: "军工干部", color: "bg-amber-100 text-amber-700", icon: UserCheck, desc: "只读查看管辖单位的业绩和人员" },
  org_department: { label: "组织部", color: "bg-cyan-100 text-cyan-700", icon: Briefcase, desc: "管理入离职时间和成本录入" },
  unit_leader: { label: "单位负责人", color: "bg-emerald-100 text-emerald-700", icon: Users, desc: "管理自己负责的销售单位" },
  unit_manager: { label: "单位管理员", color: "bg-blue-100 text-blue-700", icon: UserCog, desc: "管理分配的销售单位数据" },
};

export default function UserManagement() {
  const { users, addUser, updateUser, deleteUser, user: currentUser } = useAuth();
  const { salesUnits } = useData();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    role: "unit_manager" as UserRole,
    managedUnitIds: [] as string[],
  });

  const openAdd = () => {
    setEditingUser(null);
    setForm({ username: "", password: "", name: "", role: "unit_manager", managedUnitIds: [] });
    setShowPassword(false);
    setDialogOpen(true);
  };

  const openEdit = (u: SystemUser) => {
    setEditingUser(u);
    setForm({
      username: u.username,
      password: "",
      name: u.name,
      role: u.role,
      managedUnitIds: u.managedUnitIds,
    });
    setShowPassword(false);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.username.trim() || !form.name.trim()) return;
    if (!editingUser && !form.password.trim()) return;
    const duplicate = users.find(
      (u) => u.username === form.username && u.id !== editingUser?.id
    );
    if (duplicate) {
      alert("用户名已存在，请更换");
      return;
    }

    try {
      if (editingUser) {
        const updateData: any = { ...form };
        if (!updateData.password) delete updateData.password;
        await updateUser(editingUser.id, updateData);
      } else {
        await addUser(form);
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

  const toggleUnit = (unitId: string) => {
    setForm((prev) => ({
      ...prev,
      managedUnitIds: prev.managedUnitIds.includes(unitId)
        ? prev.managedUnitIds.filter((id) => id !== unitId)
        : [...prev.managedUnitIds, unitId],
    }));
  };

  const needsUnits = form.role !== "superadmin";

  return (
    <div>
      <PageHeader
        title="用户管理"
        description="管理系统用户和角色，分配销售单位管辖权限"
        action={
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />新增用户
          </Button>
        }
      />

      {/* 权限说明 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(roleConfig) as UserRole[]).map((r) => {
          const cfg = roleConfig[r];
          const Icon = cfg.icon;
          return (
            <Card key={r}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: undefined }}>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${cfg.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-sm">{cfg.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{cfg.desc}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>可管理单位</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const cfg = roleConfig[u.role];
                  const Icon = cfg.icon;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={`${cfg.color} text-xs`}>
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
                        <Badge className={cfg.color}>
                          <Icon className="mr-1 h-3 w-3" />{cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.role === "superadmin" ? (
                          <span className="text-sm text-muted-foreground">全部单位</span>
                        ) : u.managedUnitIds.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {u.managedUnitIds.map((id) => (
                              <Badge key={id} variant="outline" className="text-xs">
                                {salesUnits.find((unit) => unit.id === id)?.name || "(已删除)"}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">未分配（可在单位中指定）</span>
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
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUser ? "编辑用户" : "新增用户"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "修改用户信息和权限" : "创建新用户并分配角色和权限"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>姓名 *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="姓名" />
              </div>
              <div className="space-y-2">
                <Label>用户名 *</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="登录用户名"
                  disabled={editingUser?.id === "admin"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-2">
                <Label>角色</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as UserRole, managedUnitIds: v === "superadmin" ? [] : form.managedUnitIds })}
                  disabled={editingUser?.id === "admin"}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(roleConfig) as UserRole[]).map((r) => (
                      <SelectItem key={r} value={r}>{roleConfig[r].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 角色说明 */}
            <div className={`rounded-lg p-3 text-sm ${form.role === "superadmin" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>
              <strong>{roleConfig[form.role].label}：</strong>{roleConfig[form.role].desc}
            </div>

            {/* 单位分配 - 非 superadmin 显示 */}
            {needsUnits && (
              <div className="space-y-3">
                <Label>可管理的销售单位（备用分配）</Label>
                <p className="text-xs text-muted-foreground">
                  也可在"销售单位管理"中为单位指定对应角色人员。此处分配的单位同样生效。
                </p>
                {salesUnits.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    暂无销售单位，请先在"销售单位管理"中添加
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border p-4 max-h-48 overflow-y-auto">
                    {salesUnits.map((unit) => (
                      <div key={unit.id} className="flex items-center space-x-3">
                        <Checkbox
                          id={`unit-${unit.id}`}
                          checked={form.managedUnitIds.includes(unit.id)}
                          onCheckedChange={() => toggleUnit(unit.id)}
                        />
                        <Label htmlFor={`unit-${unit.id}`} className="cursor-pointer text-sm font-normal">
                          {unit.name}
                          <span className="ml-2 text-xs text-muted-foreground">{unit.description}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
                {form.managedUnitIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    已选择 {form.managedUnitIds.length} 个单位
                  </p>
                )}
              </div>
            )}

            {form.role === "superadmin" && (
              <div className="rounded-lg bg-violet-50 p-3 text-sm text-violet-700">
                <Shield className="mr-1 inline h-4 w-4" />
                超级管理员可访问所有销售单位数据和管理所有用户
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingUser ? "保存" : "新增"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除该用户吗？此操作不可撤销。</AlertDialogDescription>
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
