import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '@/context/DataContext'
import { formatCurrency } from '@/lib/format'
import type { Personnel, Product, ProductPersonCommission, UnitProductSettlement } from '@/types'
import { Layers, Package, Pencil, Percent, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
  internalSalesCommissionType: 'percentage' as PersonalCommissionType,
  internalSalesCommissionRate: 0,
  internalSalesCommissionAmount: 0,
  internalSalesCommissionThreshold: 0,
  internalSalesCommissionCondition: '',
  internalSalesCommissionRecipientId: '',
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

function hasInternalSalesPpc(ppc: ProductPersonCommission): boolean {
  if (ppc.internalSalesCommissionType === 'fixed') {
    return (ppc.internalSalesCommissionAmount || 0) > 0
  }
  return (ppc.internalSalesCommissionRate || 0) > 0
}

function formatInternalPpcSummary(ppc: ProductPersonCommission): string {
  const type = ppc.internalSalesCommissionType || 'percentage'
  if (type === 'fixed') {
    return `按件 ¥${ppc.internalSalesCommissionAmount || 0}`
  }
  const threshold = ppc.internalSalesCommissionThreshold || 0
  return (
    `比例 ${ppc.internalSalesCommissionRate || 0}%` +
    (threshold > 0 ? `（门槛 ${formatCurrency(threshold)}）` : '')
  )
}

function getInternalRecipientName(
  ppc: ProductPersonCommission,
  person: Personnel,
  colleagueList: Personnel[],
): string | null {
  const recipientId = (ppc.internalSalesCommissionRecipientId || '').trim()
  if (!recipientId || recipientId === person.id) return null
  return colleagueList.find((p) => p.id === recipientId)?.name || null
}

function toggleIdInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
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
    personnel,
    upsertProductPersonCommission,
    batchUpsertProductPersonCommissions,
    deleteProductPersonCommission,
  } = useData()

  const [search, setSearch] = useState('')
  const [editProductId, setEditProductId] = useState<string | null>(null)
  const [batchProductIds, setBatchProductIds] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [addProductId, setAddProductId] = useState('')
  const [saving, setSaving] = useState(false)

  const unitName = useMemo(() => {
    if (!person) return ''
    return salesUnits.find((u) => u.id === person.salesUnitId)?.name || '未分配单位'
  }, [person, salesUnits])

  const unitColleagues = useMemo(() => {
    if (!person) return []
    return personnel
      .filter(
        (p) =>
          p.status === 'active'
          && p.salesUnitId === person.salesUnitId
          && p.id !== person.id,
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [person, personnel])

  function getInternalRecipientSelectValue(recipientId?: string): string {
    if (!person) return '__inherit__'
    const rid = (recipientId || '').trim()
    if (!rid) return '__inherit__'
    if (rid === person.id) return '__self__'
    return rid
  }

  function parseInternalRecipientSelectValue(value: string): string {
    if (!person) return ''
    if (value === '__inherit__') return ''
    if (value === '__self__') return person.id
    return value
  }

  const personProductIds = useMemo(() => {
    if (!person) return new Set<string>()
    const ids = new Set<string>()
    salesRecords.forEach((s) => {
      const inCollab = (s.collaborators || []).some((c) => c.personnelId === person.id)
      if ((s.personnelId === person.id || inCollab) && s.productId) ids.add(s.productId)
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
        // 未配置的排前面，方便从清单点进来立刻看到缺项
        const aCfg = a.ppc ? 1 : 0
        const bCfg = b.ppc ? 1 : 0
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
  const visibleIds = productRows.map((r) => r.product.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  const someVisibleSelected = visibleIds.some((id) => selectedIds.includes(id))

  function resetTransientState() {
    setEditProductId(null)
    setBatchProductIds([])
    setSelectedIds([])
    setSearch('')
    setAddProductId('')
    setForm({ ...EMPTY_FORM })
  }

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
        internalSalesCommissionType: ppc.internalSalesCommissionType || 'percentage',
        internalSalesCommissionRate: ppc.internalSalesCommissionRate || 0,
        internalSalesCommissionAmount: ppc.internalSalesCommissionAmount || 0,
        internalSalesCommissionThreshold: ppc.internalSalesCommissionThreshold || 0,
        internalSalesCommissionCondition: ppc.internalSalesCommissionCondition || '',
        internalSalesCommissionRecipientId: ppc.internalSalesCommissionRecipientId || '',
        rewardAmount: ppc.rewardAmount || 0,
        rewardFrom: ppc.rewardFrom || '',
        rewardTo: ppc.rewardTo || '',
      })
    } else {
      setForm({ ...EMPTY_FORM, personalCommissionType: defaultType })
    }
    setBatchProductIds([])
    setEditProductId(productId)
  }

  function openBatchEdit() {
    if (!person || selectedIds.length === 0) return
    const firstId = selectedIds[0]
    const defaultType = getDefaultPersonalCommissionType(
      firstId,
      person.salesUnitId,
      upsList,
      products,
    )
    // 若所选产品结算方式一致为固定，默认固定提成
    const allFixed = selectedIds.every((pid) =>
      getDefaultPersonalCommissionType(pid, person.salesUnitId, upsList, products) === 'fixed',
    )
    setForm({
      ...EMPTY_FORM,
      personalCommissionType: allFixed ? 'fixed' : defaultType,
    })
    setEditProductId(null)
    setBatchProductIds([...selectedIds])
  }

  function buildPpcPayload(productId: string) {
    if (!person) return null
    return {
      salesUnitId: person.salesUnitId,
      productId,
      personnelId: person.id,
      managementCommissionRate: 0,
      managementCommissionThreshold: 0,
      managementCommissionCondition: '',
      personalCommissionType: form.personalCommissionType || 'percentage',
      personalCommissionRate: form.personalCommissionRate || 0,
      personalCommissionAmount: form.personalCommissionAmount || 0,
      personalCommissionThreshold: form.personalCommissionThreshold || 0,
      personalCommissionCondition: form.personalCommissionCondition,
      internalSalesCommissionType: form.internalSalesCommissionType || 'percentage',
      internalSalesCommissionRate: form.internalSalesCommissionRate || 0,
      internalSalesCommissionAmount: form.internalSalesCommissionAmount || 0,
      internalSalesCommissionThreshold: form.internalSalesCommissionThreshold || 0,
      internalSalesCommissionCondition: form.internalSalesCommissionCondition,
      internalSalesCommissionRecipientId: form.internalSalesCommissionRecipientId || '',
      rewardAmount: form.rewardAmount || 0,
      rewardFrom: form.rewardFrom || '',
      rewardTo: form.rewardTo || '',
    }
  }

  async function handleSave() {
    if (!person) return
    if (!person.salesUnitId) {
      alert('该人员尚未归属销售单位，请先在人员信息中设置所属单位')
      return
    }
    const targetIds = batchProductIds.length > 0
      ? batchProductIds
      : editProductId
        ? [editProductId]
        : []
    if (targetIds.length === 0) return

    setSaving(true)
    try {
      if (targetIds.length === 1) {
        const payload = buildPpcPayload(targetIds[0])
        if (!payload) return
        await upsertProductPersonCommission(payload)
      } else {
        const items = targetIds
          .map((id) => buildPpcPayload(id))
          .filter((x): x is NonNullable<typeof x> => !!x)
        await batchUpsertProductPersonCommissions(items)
      }
      setEditProductId(null)
      setBatchProductIds([])
      setSelectedIds([])
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

  function handleToggleAllVisible(checked: boolean) {
    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])))
    } else {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
    }
  }

  function handleSelectUnconfigured() {
    const ids = productRows.filter((r) => !r.ppc).map((r) => r.product.id)
    setSelectedIds(ids)
  }

  const editProduct = editProductId
    ? products.find((p) => p.id === editProductId)
    : undefined
  const isBatchEdit = batchProductIds.length > 0
  const editDialogOpen = !!editProductId || isBatchEdit

  return (
    <>
      <Dialog
        open={open && !!person}
        onOpenChange={(v) => {
          if (!v) resetTransientState()
          onOpenChange(v)
        }}
      >
        <DialogContent
          className="flex h-[90vh] max-h-[90vh] w-[min(96vw,80rem)]
            max-w-[min(96vw,80rem)] flex-col overflow-hidden
            sm:max-w-[min(96vw,80rem)]"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-violet-600" />
              个人提成配置
            </DialogTitle>
          </DialogHeader>

          {person && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
                  按「人员 × 产品」设置提成；可多选后一键配置相同规则。团队管理提成仍在
                  <Link to="/cost-management" className="mx-1 text-emerald-700 underline">
                    成本管理
                  </Link>
                  。已配 {configuredCount} / {productRows.length} 个产品
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
                {canEdit && productRows.some((r) => !r.ppc) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectUnconfigured}
                  >
                    勾选未配置
                  </Button>
                )}
                {canEdit && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={selectedIds.length === 0}
                    onClick={openBatchEdit}
                  >
                    <Layers className="mr-1 h-3.5 w-3.5" />
                    一键配置所选（{selectedIds.length}）
                  </Button>
                )}
              </div>

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          {canEdit && (
                            <TableHead className="w-10">
                              <Checkbox
                                checked={
                                  allVisibleSelected
                                    ? true
                                    : someVisibleSelected
                                      ? 'indeterminate'
                                      : false
                                }
                                onCheckedChange={(v) => handleToggleAllVisible(!!v)}
                                aria-label="全选当前列表"
                              />
                            </TableHead>
                          )}
                          <TableHead className="min-w-[12rem]">产品</TableHead>
                          <TableHead className="whitespace-normal">分销奖金</TableHead>
                          <TableHead className="whitespace-normal">个人提成</TableHead>
                          <TableHead className="text-right w-28">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {productRows.map(({ product, ppc }) => {
                          const checked = selectedIds.includes(product.id)
                          return (
                            <TableRow key={product.id}>
                              {canEdit && (
                                <TableCell>
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() =>
                                      setSelectedIds((prev) => toggleIdInList(prev, product.id))
                                    }
                                    aria-label={`选择 ${product.name}`}
                                  />
                                </TableCell>
                              )}
                              <TableCell className="whitespace-normal">
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
                              <TableCell className="whitespace-normal">
                                {ppc && hasInternalSalesPpc(ppc) ? (
                                  <div className="space-y-1">
                                    <Badge className="bg-sky-100 text-sky-800">
                                      已配置
                                    </Badge>
                                    <p className="text-xs text-muted-foreground">
                                      {formatInternalPpcSummary(ppc)}
                                    </p>
                                    {(() => {
                                      const recipientName = getInternalRecipientName(
                                        ppc,
                                        person,
                                        personnel,
                                      )
                                      return recipientName ? (
                                        <p className="text-[10px] text-sky-700">
                                          受益人：{recipientName}
                                        </p>
                                      ) : null
                                    })()}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-normal">
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
                          )
                        })}
                        {productRows.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={canEdit ? 5 : 4}
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
        open={editDialogOpen}
        onOpenChange={(v) => {
          if (!v) {
            setEditProductId(null)
            setBatchProductIds([])
          }
        }}
      >
        <DialogContent
          className="flex max-h-[90vh] w-[min(92vw,48rem)] flex-col
            overflow-y-auto max-w-[min(92vw,48rem)]
            sm:max-w-[min(92vw,48rem)]"
        >
          <DialogHeader>
            <DialogTitle>
              {isBatchEdit
                ? `一键配置所选产品（${batchProductIds.length}）`
                : canEdit
                  ? '配置产品提成'
                  : '查看产品提成'}
            </DialogTitle>
          </DialogHeader>
          {person && isBatchEdit && (
            <div className="mb-2 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">人员：</span>
                {person.name}
              </p>
              <p>
                <span className="text-muted-foreground">单位：</span>
                {unitName}
              </p>
              <p className="text-xs text-muted-foreground">
                将把同一套提成规则应用到已选 {batchProductIds.length} 个产品（覆盖已有配置）
              </p>
              <div className="max-h-24 overflow-y-auto text-xs text-muted-foreground space-y-0.5">
                {batchProductIds.map((id) => {
                  const name = products.find((p) => p.id === id)?.name || id
                  return <div key={id}>· {name}</div>
                })}
              </div>
            </div>
          )}
          {person && editProduct && !isBatchEdit && (
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

            <div className="rounded-lg border-2 border-sky-200 bg-sky-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-sky-100 text-sky-800">内部销售提成</Badge>
                <span className="text-xs text-muted-foreground">不计入业额，计入人力成本</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">提成方式</Label>
                <Select
                  value={form.internalSalesCommissionType}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      internalSalesCommissionType: v as PersonalCommissionType,
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
              {form.internalSalesCommissionType === 'fixed' ? (
                <div className="space-y-1">
                  <Label className="text-xs">每件提成金额 (¥)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={!canEdit}
                    value={form.internalSalesCommissionAmount}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        internalSalesCommissionAmount: Number(e.target.value),
                      })
                    }
                    placeholder="如：20"
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
                      value={form.internalSalesCommissionRate}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          internalSalesCommissionRate: Number(e.target.value),
                        })
                      }
                      placeholder="如：5"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">起算门槛 (¥)</Label>
                    <Input
                      type="number"
                      disabled={!canEdit}
                      value={form.internalSalesCommissionThreshold}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          internalSalesCommissionThreshold: Number(e.target.value),
                        })
                      }
                      placeholder="如：0"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">内部销售受益人</Label>
                <Select
                  disabled={!canEdit}
                  value={getInternalRecipientSelectValue(form.internalSalesCommissionRecipientId)}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      internalSalesCommissionRecipientId: parseInternalRecipientSelectValue(v),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择受益人" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__inherit__">沿用人员薪酬默认</SelectItem>
                    <SelectItem value="__self__">成交人本人</SelectItem>
                    {unitColleagues.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.position ? `（${p.position}）` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  仅显示本单位在职同事；未单独设置时沿用人员薪酬中的受益人
                </p>
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
            {canEdit && editProductId && !isBatchEdit && (
              <Button
                variant="destructive"
                onClick={() => handleClear(editProductId)}
              >
                删除配置
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setEditProductId(null)
                setBatchProductIds([])
              }}
            >
              {canEdit ? '取消' : '关闭'}
            </Button>
            {canEdit && (
              <Button disabled={saving} onClick={handleSave}>
                {saving
                  ? '保存中…'
                  : isBatchEdit
                    ? `应用到 ${batchProductIds.length} 个产品`
                    : '保存'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
