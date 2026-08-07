import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '@/context/DataContext'
import { formatCurrency } from '@/lib/format'
import type { Personnel, Product, UnitProductSettlement } from '@/types'
import { Package, Pencil, Percent, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type PersonalCommissionType = 'percentage' | 'fixed'

const EMPTY_FORM = {
  personalCommissionType: 'percentage' as PersonalCommissionType,
  personalCommissionRate: 0,
  personalCommissionAmount: 0,
  personalCommissionThreshold: 0,
  personalCommissionCondition: '',
  rewardAmount: 0,
  rewardFrom: '',
  rewardTo: '',
}

function getDefaultPersonalCommissionType(
  productId: string,
  unitId: string,
  upsList: UnitProductSettlement[],
  productList: Product[],
): PersonalCommissionType {
  const ups = upsList.find((x) => x.productId === productId && x.salesUnitId === unitId)
  if (ups?.settlementType === 'fixed') return 'fixed'
  if (ups?.settlementType === 'percentage') return 'percentage'
  const product = productList.find((p) => p.id === productId)
  if (product?.settlementType === 'fixed') return 'fixed'
  return 'percentage'
}

function formatPpcSummary(opts: {
  type: PersonalCommissionType
  rate: number
  amount: number
  threshold: number
  rewardAmount: number
  rewardFrom?: string
  rewardTo?: string
}): string {
  const base =
    opts.type === 'fixed'
      ? `按件 ¥${opts.amount || 0}`
      : `比例 ${opts.rate || 0}%` +
        (opts.threshold > 0 ? `（门槛 ${formatCurrency(opts.threshold)}）` : '')
  const rewardFrom = opts.rewardFrom || '不限'
  const rewardTo = opts.rewardTo || '不限'
  const rewardPeriod =
    !opts.rewardFrom && !opts.rewardTo
      ? '长期'
      : `${rewardFrom || '不限'} ~ ${rewardTo || '不限'}`
  const reward =
    (opts.rewardAmount || 0) > 0
      ? `；奖励 ¥${opts.rewardAmount}/件（${rewardPeriod}）`
      : ''
  return base + reward
}

type Props = {
  person: Personnel | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
}

export default function MPersonProductCommission({
  person,
  open,
  onOpenChange,
  canEdit,
}: Props) {
  const {
    products,
    allSalesRecords: salesRecords,
    productPersonCommissions: ppcList,
    unitProductSettlements: upsList,
    salesUnits,
    upsertProductPersonCommission,
    deleteProductPersonCommission,
  } = useData()

  const [search, setSearch] = useState('')
  const [editProductId, setEditProductId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [addProductId, setAddProductId] = useState('')
  const [saving, setSaving] = useState(false)

  const unitName = useMemo(() => {
    if (!person) return ''
    return salesUnits.find((u) => u.id === person.salesUnitId)?.name || '未分配单位'
  }, [person, salesUnits])

  const personProductIds = useMemo(() => {
    if (!person) return new Set<string>()
    const ids = new Set<string>()
    salesRecords.forEach((s) => {
      if (s.personnelId === person.id && s.productId) ids.add(s.productId)
    })
    ppcList.forEach((c) => {
      if (c.personnelId === person.id) ids.add(c.productId)
    })
    return ids
  }, [person, salesRecords, ppcList])

  const productRows = useMemo(() => {
    if (!person) return []
    const kw = search.trim().toLowerCase()
    return products
      .filter((p) => personProductIds.has(p.id))
      .filter(
        (p) =>
          !kw ||
          p.name.toLowerCase().includes(kw) ||
          (p.category || '').toLowerCase().includes(kw),
      )
      .map((product) => {
        const ppc = ppcList.find(
          (x) =>
            x.personnelId === person.id &&
            x.productId === product.id &&
            x.salesUnitId === person.salesUnitId,
        )
        return { product, ppc }
      })
      .sort((a, b) => {
        const aCfg = a.ppc ? 0 : 1
        const bCfg = b.ppc ? 0 : 1
        if (aCfg !== bCfg) return aCfg - bCfg
        return a.product.name.localeCompare(b.product.name, 'zh')
      })
  }, [person, products, personProductIds, ppcList, search])

  const otherProducts = useMemo(() => {
    if (!person) return []
    return products
      .filter((p) => !personProductIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [person, products, personProductIds])

  const configuredCount = productRows.filter((r) => r.ppc).length

  function openEdit(productId: string) {
    if (!person) return
    const ppc = ppcList.find(
      (x) =>
        x.personnelId === person.id &&
        x.productId === productId &&
        x.salesUnitId === person.salesUnitId,
    )
    const defaultType = getDefaultPersonalCommissionType(
      productId,
      person.salesUnitId,
      upsList,
      products,
    )
    if (ppc) {
      setForm({
        ...EMPTY_FORM,
        personalCommissionType: ppc.personalCommissionType || defaultType,
        personalCommissionRate: ppc.personalCommissionRate || 0,
        personalCommissionAmount: ppc.personalCommissionAmount || 0,
        personalCommissionThreshold: ppc.personalCommissionThreshold || 0,
        personalCommissionCondition: ppc.personalCommissionCondition || '',
        rewardAmount: ppc.rewardAmount || 0,
        rewardFrom: ppc.rewardFrom || '',
        rewardTo: ppc.rewardTo || '',
      })
    } else {
      setForm({ ...EMPTY_FORM, personalCommissionType: defaultType })
    }
    setEditProductId(productId)
  }

  async function handleSave() {
    if (!person || !editProductId) return
    if (!person.salesUnitId) {
      alert('该人员尚未归属销售单位，请先在人员信息中设置所属单位')
      return
    }
    setSaving(true)
    try {
      await upsertProductPersonCommission({
        salesUnitId: person.salesUnitId,
        productId: editProductId,
        personnelId: person.id,
        managementCommissionRate: 0,
        managementCommissionThreshold: 0,
        managementCommissionCondition: '',
        personalCommissionType: form.personalCommissionType || 'percentage',
        personalCommissionRate: form.personalCommissionRate || 0,
        personalCommissionAmount: form.personalCommissionAmount || 0,
        personalCommissionThreshold: form.personalCommissionThreshold || 0,
        personalCommissionCondition: form.personalCommissionCondition,
        rewardAmount: form.rewardAmount || 0,
        rewardFrom: form.rewardFrom || '',
        rewardTo: form.rewardTo || '',
      })
      setEditProductId(null)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('保存失败: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleClear(productId: string) {
    if (!person) return
    const ppc = ppcList.find(
      (x) =>
        x.personnelId === person.id &&
        x.productId === productId &&
        x.salesUnitId === person.salesUnitId,
    )
    if (!ppc?.id) {
      setEditProductId(null)
      return
    }
    if (!confirm('确定删除该产品的个人提成配置？')) return
    try {
      await deleteProductPersonCommission(ppc.id)
      setEditProductId(null)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('删除失败: ' + msg)
    }
  }

  function handleAddProduct() {
    if (!addProductId) return
    openEdit(addProductId)
    setAddProductId('')
  }

  const editProduct = editProductId
    ? products.find((p) => p.id === editProductId)
    : undefined

  return (
    <>
      <Dialog
        open={open && !!person}
        onOpenChange={(v) => {
          if (!v) {
            setEditProductId(null)
            setSearch('')
            setAddProductId('')
          }
          onOpenChange(v)
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-violet-600" />
              个人提成配置
            </DialogTitle>
          </DialogHeader>

          {person && (
            <div className="space-y-4">
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">销售人员：</span>
                  <strong>{person.name}</strong>
                  <span className="text-muted-foreground">（{person.position || '未填岗位'}）</span>
                </p>
                <p>
                  <span className="text-muted-foreground">所属单位：</span>
                  {unitName}
                </p>
                <p className="text-xs text-muted-foreground">
                  按「人员 × 产品」单独设置提成；团队管理提成仍在
                  <Link to="/cost-management" className="mx-1 text-emerald-700 underline">
                    成本管理
                  </Link>
                  配置。已配 {configuredCount} / {productRows.length} 个产品
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="搜索产品名称或分类..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-xs"
                />
                {canEdit && otherProducts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={addProductId || undefined} onValueChange={setAddProductId}>
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="添加其他产品…" />
                      </SelectTrigger>
                      <SelectContent>
                        {otherProducts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!addProductId}
                      onClick={handleAddProduct}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      配置
                    </Button>
                  </div>
                )}
              </div>

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead>产品</TableHead>
                          <TableHead>个人提成</TableHead>
                          <TableHead className="text-right w-28">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {productRows.map(({ product, ppc }) => (
                          <TableRow key={product.id}>
                            <TableCell>
                              <div className="flex items-center gap-2 min-w-0">
                                <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{product.name}</p>
                                  {product.category ? (
                                    <p className="text-xs text-muted-foreground">
                                      {product.category}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {ppc ? (
                                <div className="space-y-1">
                                  <Badge className="bg-violet-100 text-violet-800">
                                    已配置
                                  </Badge>
                                  <p className="text-xs text-muted-foreground">
                                    {formatPpcSummary({
                                      type: ppc.personalCommissionType || 'percentage',
                                      rate: ppc.personalCommissionRate,
                                      amount: ppc.personalCommissionAmount || 0,
                                      threshold: ppc.personalCommissionThreshold,
                                      rewardAmount: ppc.rewardAmount || 0,
                                      rewardFrom: ppc.rewardFrom,
                                      rewardTo: ppc.rewardTo,
                                    })}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">未配置</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {canEdit ? (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="编辑提成"
                                      onClick={() => openEdit(product.id)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    {ppc?.id && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        title="删除配置"
                                        onClick={() => handleClear(product.id)}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    )}
                                  </>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openEdit(product.id)}
                                  >
                                    查看
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {productRows.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={3}
                              className="py-10 text-center text-sm text-muted-foreground"
                            >
                              暂无关联产品。可从销售记录产生关联，或上方选择产品进行配置。
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editProductId}
        onOpenChange={(v) => {
          if (!v) setEditProductId(null)
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{canEdit ? '配置产品提成' : '查看产品提成'}</DialogTitle>
          </DialogHeader>
          {person && editProduct && (
            <div className="mb-2 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">人员：</span>
                {person.name}
              </p>
              <p>
                <span className="text-muted-foreground">产品：</span>
                {editProduct.name}
              </p>
              <p>
                <span className="text-muted-foreground">单位：</span>
                {unitName}
              </p>
            </div>
          )}
          <div className="space-y-4 py-2">
            <div className="rounded-lg border-2 border-orange-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-orange-100 text-orange-700">个人提成</Badge>
                <span className="text-xs text-muted-foreground">
                  {form.personalCommissionType === 'fixed'
                    ? '按件固定金额'
                    : '按个人该产品销售额计算'}
                </span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">提成方式</Label>
                <Select
                  value={form.personalCommissionType}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      personalCommissionType: v as PersonalCommissionType,
                    })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">按销售额比例</SelectItem>
                    <SelectItem value="fixed">按件固定金额</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.personalCommissionType === 'fixed' ? (
                <div className="space-y-1">
                  <Label className="text-xs">每件提成金额 (¥)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={!canEdit}
                    value={form.personalCommissionAmount}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        personalCommissionAmount: Number(e.target.value),
                      })
                    }
                    placeholder="如：50"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">提成比例 (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      disabled={!canEdit}
                      value={form.personalCommissionRate}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          personalCommissionRate: Number(e.target.value),
                        })
                      }
                      placeholder="如：3"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">起算门槛 (¥)</Label>
                    <Input
                      type="number"
                      disabled={!canEdit}
                      value={form.personalCommissionThreshold}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          personalCommissionThreshold: Number(e.target.value),
                        })
                      }
                      placeholder="如：50000"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">发放条件</Label>
                <Input
                  disabled={!canEdit}
                  value={form.personalCommissionCondition}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      personalCommissionCondition: e.target.value,
                    })
                  }
                  placeholder="如：个人达标后发放"
                />
              </div>
            </div>

            <div className="rounded-lg border-2 border-amber-200 bg-amber-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-100 text-amber-800">特殊时段奖励</Badge>
                <span className="text-xs text-muted-foreground">按件额外计入个人提成</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">每件奖励金额 (¥)</Label>
                <Input
                  type="number"
                  step="0.01"
                  disabled={!canEdit}
                  value={form.rewardAmount}
                  onChange={(e) =>
                    setForm({ ...form, rewardAmount: Number(e.target.value) })
                  }
                  placeholder="0 表示无奖励"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">奖励开始日期</Label>
                  <Input
                    type="date"
                    disabled={!canEdit}
                    value={form.rewardFrom}
                    onChange={(e) =>
                      setForm({ ...form, rewardFrom: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">奖励结束日期</Label>
                  <Input
                    type="date"
                    disabled={!canEdit}
                    value={form.rewardTo}
                    onChange={(e) =>
                      setForm({ ...form, rewardTo: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            {canEdit && editProductId && (
              <Button
                variant="destructive"
                onClick={() => handleClear(editProductId)}
              >
                删除配置
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditProductId(null)}>
              {canEdit ? '取消' : '关闭'}
            </Button>
            {canEdit && (
              <Button disabled={saving} onClick={handleSave}>
                {saving ? '保存中…' : '保存'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
