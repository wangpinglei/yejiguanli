import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/format";
import type { SalesUnit } from "@/types";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Building2,
  Users,
  Swords,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function SalesUnits() {
  const navigate = useNavigate();
  const { addSalesUnit, updateSalesUnit, deleteSalesUnit } = useData();
  const { users } = useAuth();
  const { canEditUnit, visibleSalesUnits: salesUnits, visiblePersonnel: personnel, visibleSalesRecords: salesRecords, visibleCostRecords: costRecords } = usePermissions();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<SalesUnit | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    groupAdminId: "",
    militaryCadreId: "",
    orgDeptId: "",
    unitLeaderId: "",
  });

  // 按角色筛选用户
  const usersByRole = (role: string) => users.filter((u) => u.role === role);
  const getUserName = (id?: string) => (id ? users.find((u) => u.id === id)?.name || "-" : "-");

  const filteredUnits = useMemo(() => {
    return salesUnits.filter((u) =>
      u.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [salesUnits, search]);

  const getUnitStats = (unitId: string) => {
    const unitPersonnel = personnel.filter((p) => p.salesUnitId === unitId);
    const revenue = salesRecords.filter((s) => s.salesUnitId === unitId).reduce((sum, s) => sum + s.totalAmount, 0);
    const cost = costRecords.filter((c) => c.salesUnitId === unitId).reduce((sum, c) => sum + c.totalCost, 0);
    return { personnelCount: unitPersonnel.length, revenue, cost, profit: revenue - cost };
  };

  const openAdd = () => {
    setEditingUnit(null);
    setForm({
      name: "",
      description: "",
      groupAdminId: "",
      militaryCadreId: "",
      orgDeptId: "",
      unitLeaderId: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (unit: SalesUnit) => {
    setEditingUnit(unit);
    setForm({
      name: unit.name,
      description: unit.description,
      groupAdminId: unit.groupAdminId || "",
      militaryCadreId: unit.militaryCadreId || "",
      orgDeptId: unit.orgDeptId || "",
      unitLeaderId: unit.unitLeaderId || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    // 类型/联系人/电话/地址已从界面移除，提交时保留兼容后端的默认值
    const data = {
      name: form.name,
      type: (editingUnit?.type || "company") as SalesUnit["type"],
      address: editingUnit?.address || "",
      contact: editingUnit?.contact || "",
      contactPhone: editingUnit?.contactPhone || "",
      description: form.description,
      groupAdminId: form.groupAdminId || undefined,
      militaryCadreId: form.militaryCadreId || undefined,
      orgDeptId: form.orgDeptId || undefined,
      unitLeaderId: form.unitLeaderId || undefined,
    };
    try {
      if (editingUnit) {
        await updateSalesUnit(editingUnit.id, data);
      } else {
        await addSalesUnit(data);
      }
      setDialogOpen(false);
    } catch (error: any) {
      alert("操作失败: " + (error.message || "未知错误"));
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteSalesUnit(deleteId);
        setDeleteId(null);
      } catch (error: any) {
        alert("删除失败: " + (error.message || "未知错误"));
      }
    }
  };

  // 角色分配下拉组件
  const RoleSelect = ({ label, role, value, onChange }: { label: string; role: string; value: string; onChange: (v: string) => void }) => {
    const roleUsers = usersByRole(role);
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder={`选择${label}`} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未分配</SelectItem>
            {roleUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {roleUsers.length === 0 && (
          <p className="text-xs text-muted-foreground">暂无{label}用户，请先在用户管理中创建</p>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="销售单位管理"
        description="管理各销售单位，分配管理人员，查看业绩与成本"
        action={
          canEditUnit && (
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              新增单位
            </Button>
          )
        }
      />

      {/* Search */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索单位名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Badge variant="secondary">共 {filteredUnits.length} 个单位</Badge>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单位名称</TableHead>
                  <TableHead>集团管理</TableHead>
                  <TableHead>军工干部</TableHead>
                  <TableHead>组织部</TableHead>
                  <TableHead>单位负责人</TableHead>
                  <TableHead className="text-right">人员数</TableHead>
                  <TableHead className="text-right">利润</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnits.map((unit) => {
                  const stats = getUnitStats(unit.id);
                  return (
                    <TableRow key={unit.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{unit.name}</p>
                            <p className="text-xs text-muted-foreground">{unit.description}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{getUserName(unit.groupAdminId)}</TableCell>
                      <TableCell className="text-sm">{getUserName(unit.militaryCadreId)}</TableCell>
                      <TableCell className="text-sm">{getUserName(unit.orgDeptId)}</TableCell>
                      <TableCell className="text-sm">{getUserName(unit.unitLeaderId)}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {stats.personnelCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(stats.profit)}</TableCell>
                      <TableCell className="text-right">
                        {canEditUnit ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="查看战报"
                              onClick={() => navigate(`/sales-battle-report?unit=${unit.id}`)}
                              className="text-violet-600 hover:text-violet-700"
                            >
                              <Swords className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(unit)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteId(unit.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="查看战报"
                            onClick={() => navigate(`/sales-battle-report?unit=${unit.id}`)}
                            className="text-violet-600 hover:text-violet-700"
                          >
                            <Swords className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredUnits.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUnit ? "编辑销售单位" : "新增销售单位"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>单位名称 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入单位名称"
              />
            </div>

            {/* 角色分配 */}
            <div className="rounded-lg border p-4 space-y-4">
              <p className="text-sm font-semibold">管理人员分配</p>
              <p className="text-xs text-muted-foreground">为该销售单位分配各角色负责人，分配后对应角色用户可查看/管理本单位数据</p>
              <div className="grid grid-cols-2 gap-4">
                <RoleSelect label="集团管理" role="group_admin" value={form.groupAdminId} onChange={(v) => setForm({ ...form, groupAdminId: v })} />
                <RoleSelect label="军工干部" role="military_cadre" value={form.militaryCadreId} onChange={(v) => setForm({ ...form, militaryCadreId: v })} />
                <RoleSelect label="组织部" role="org_department" value={form.orgDeptId} onChange={(v) => setForm({ ...form, orgDeptId: v })} />
                <RoleSelect label="单位负责人" role="unit_leader" value={form.unitLeaderId} onChange={(v) => setForm({ ...form, unitLeaderId: v })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>备注说明</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="单位描述或备注"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingUnit ? "保存" : "新增"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除该销售单位将同时删除其下所有人员数据，此操作不可撤销。
            </AlertDialogDescription>
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
