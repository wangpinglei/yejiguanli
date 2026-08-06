import { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { usePermissions } from '@/hooks/usePermissions'
import { formatCurrency } from '@/lib/format'
import { filterByMonth } from '@/lib/salary'
import type { SalesUnit, ProductPersonCommission, Personnel } from '@/types'
import {
  Building2, Package, Pencil, Users, Layers, Calculator,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

const EMPTY_PERSON_COMMISSION = {
  managementCommissionRate: 0,
  managementCommissionThreshold: 0,
  managementCommissionCondition: '',
  personalCommissionRate: 0,
  personalCommissionThreshold: 0,
  personalCommissionCondition: '',
}

type BatchPpcTarget =
  | { mode: 'all' }
  | { mode: 'product'; productId: string }
  | { mode: 'unit'; productId: string; unitId: string }

function toggleIdInSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function toggleIdInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

type Props = {
  selectedMonth: string
}

export default function MSalesCommissionPanel({ selectedMonth }: Props) {
  const {
    products,
    allSalesRecords: salesRecords,
    productPersonCommissions: ppcList,
    personnel,
    upsertProductPersonCommission,
    deleteProductPersonCommission,
    batchUpsertProductPersonCommissions,
  } = useData()
  const {
    visibleSalesUnits: units,
    canEditCost,
    canEditProduct,
    isReadOnly,
  } = usePermissions()

  const canEdit = (canEditCost || canEditProduct) && !isReadOnly
  const [search, setSearch] = useState('')

  const [batchPpcTarget, setBatchPpcTarget] = useState<BatchPpcTarget | null>(null)
  const [batchPpcSaving, setBatchPpcSaving] = useState(false)
  const [batchPpcSelectedProductIds, setBatchPpcSelectedProductIds] = useState<string[]>([])
  const [batchPpcSelectedUnitIds, setBatchPpcSelectedUnitIds] = useState<string[]>([])

  const [ppcEditKey, setPpcEditKey] = useState<{
    productId: string
    unitId: string
    personnelId: string
  } | null>(null)
  const [ppcForm, setPpcForm] = useState(EMPTY_PERSON_COMMISSION)

  const [expandedPpcProductIds, setExpandedPpcProductIds] = useState<Set<string>>(new Set())
  const [expandedPpcUnitKeys, setExpandedPpcUnitKeys] = useState<Set<string>>(new Set())

  const monthlySales = useMemo(
    () => filterByMonth(salesRecords, selectedMonth),
    [salesRecords, selectedMonth],
  )

  const productsFromSales = useMemo(() => {
    const idSet = new Set(salesRecords.map((s) => s.productId).filter(Boolean))
    return products.filter((p) => idSet.has(p.id))
  }, [products, salesRecords])

  const filteredProducts = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return productsFromSales.filter(
      (p) =>
        !kw ||
        p.name.toLowerCase().includes(kw) ||
        (p.category || '').toLowerCase().includes(kw),
    )
  }, [productsFromSales, search])

  function findPpc(productId: string, unitId: string, personnelId: string) {
    return ppcList.find(
      (x) =>
        x.salesUnitId === unitId &&
        x.productId === productId &&
        x.personnelId === personnelId,
    )
  }

  function getPeopleForProductUnit(_productId: string, unitId: string): Personnel[] {
    return personnel.filter((p) => p.salesUnitId === unitId && p.status === 'active')
  }

  function calcPersonProductSales(personId: string, productId: string): number {
    return monthlySales
      .filter((s) => s.personnelId === personId && s.productId === productId)
      .reduce((sum, s) => sum + s.totalAmount, 0)
  }

  function calcTeamSales(unitId: string): number {
    return monthlySales
      .filter((s) => s.salesUnitId === unitId)
      .reduce((sum, s) => sum + s.totalAmount, 0)
  }

  const productPersonGroups = useMemo(
    () =>
      filteredProducts.map((product) => {
        const rows: {
          unit: SalesUnit
          person: Personnel
          ppc: ProductPersonCommission | undefined
          personSales: number
          teamSales: number
        }[] = []
        units.forEach((unit) => {
          const unitPeople = getPeopleForProductUnit(product.id, unit.id)
          const teamSales = calcTeamSales(unit.id)
          unitPeople.forEach((person) => {
            rows.push({
              unit,
              person,
              ppc: findPpc(product.id, unit.id, person.id),
              personSales: calcPersonProductSales(person.id, product.id),
              teamSales,
            })
          })
        })
        return { product, rows }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredProducts, units, personnel, ppcList, monthlySales],
  )

  function openPpcEdit(productId: string, unitId: string, personnelId: string) {
    const ppc = findPpc(productId, unitId, personnelId)
    setPpcForm(ppc ? { ...EMPTY_PERSON_COMMISSION, ...ppc } : { ...EMPTY_PERSON_COMMISSION })
    setPpcEditKey({ productId, unitId, personnelId })
    setExpandedPpcProductIds((prev) => new Set(prev).add(productId))
    setExpandedPpcUnitKeys((prev) => new Set(prev).add(`${productId}|${unitId}`))
  }

  async function handlePpcSave() {
    if (!ppcEditKey) return
    try {
      await upsertProductPersonCommission({
        salesUnitId: ppcEditKey.unitId,
        productId: ppcEditKey.productId,
        personnelId: ppcEditKey.personnelId,
        managementCommissionRate: ppcForm.managementCommissionRate || 0,
        managementCommissionThreshold: ppcForm.managementCommissionThreshold || 0,
        managementCommissionCondition: ppcForm.managementCommissionCondition,
        personalCommissionRate: ppcForm.personalCommissionRate || 0,
        personalCommissionThreshold: ppcForm.personalCommissionThreshold || 0,
        personalCommissionCondition: ppcForm.personalCommissionCondition,
      })
      setPpcEditKey(null)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('保存失败: ' + msg)
    }
  }

  async function handlePpcClear() {
    if (!ppcEditKey) return
    const ppc = findPpc(ppcEditKey.productId, ppcEditKey.unitId, ppcEditKey.personnelId)
    if (ppc?.id) {
      try {
        await deleteProductPersonCommission(ppc.id)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : '未知错误'
        alert('删除失败: ' + msg)
      }
    }
    setPpcEditKey(null)
  }

  function buildBatchPpcItems(productIds: string[], unitIds: string[]) {
    const selectedUnits = units.filter((unit) => unitIds.includes(unit.id))
    return productIds.flatMap((productId) =>
      selectedUnits.flatMap((unit) =>
        getPeopleForProductUnit(productId, unit.id).map((person) => ({
          salesUnitId: unit.id,
          productId,
          personnelId: person.id,
          managementCommissionRate: ppcForm.managementCommissionRate || 0,
          managementCommissionThreshold: ppcForm.managementCommissionThreshold || 0,
          managementCommissionCondition: ppcForm.managementCommissionCondition,
          personalCommissionRate: ppcForm.personalCommissionRate || 0,
          personalCommissionThreshold: ppcForm.personalCommissionThreshold || 0,
          personalCommissionCondition: ppcForm.personalCommissionCondition,
        })),
      ),
    )
  }

  function openBatchPpc(target: BatchPpcTarget) {
    setPpcForm({ ...EMPTY_PERSON_COMMISSION })
    if (target.mode === 'all') {
      setBatchPpcSelectedProductIds(filteredProducts.map((p) => p.id))
      setBatchPpcSelectedUnitIds(units.map((u) => u.id))
    } else if (target.mode === 'product') {
      setBatchPpcSelectedProductIds([target.productId])
      setBatchPpcSelectedUnitIds(units.map((u) => u.id))
    } else {
      setBatchPpcSelectedProductIds([target.productId])
      setBatchPpcSelectedUnitIds([target.unitId])
    }
    setBatchPpcTarget(target)
  }

  const batchPpcPreviewCount = useMemo(
    () => buildBatchPpcItems(batchPpcSelectedProductIds, batchPpcSelectedUnitIds).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batchPpcSelectedProductIds, batchPpcSelectedUnitIds, units, personnel, filteredProducts],
  )

  async function handleBatchPpcSave() {
    if (!batchPpcTarget) return
    if (batchPpcSelectedProductIds.length === 0) {
      alert('请至少勾选一个产品')
      return
    }
    if (batchPpcSelectedUnitIds.length === 0) {
      alert('请至少勾选一个销售单位')
      return
    }
    const items = buildBatchPpcItems(batchPpcSelectedProductIds, batchPpcSelectedUnitIds)
    if (items.length === 0) {
      alert('没有可配置的在职人员，请先在「人员管理」中录入')
      return
    }
    if (
      !confirm(
        `将把相同提成规则应用到已勾选的 ${batchPpcSelectedProductIds.length} 个产品 × ` +
          `${batchPpcSelectedUnitIds.length} 个单位，共 ${items.length} 条配置（覆盖已有），是否继续？`,
      )
    ) {
      return
    }
    setBatchPpcSaving(true)
    try {
      await batchUpsertProductPersonCommissions(items)
      setBatchPpcTarget(null)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('批量保存失败: ' + msg)
    } finally {
      setBatchPpcSaving(false)
    }
  }

  const ppcTarget = ppcEditKey
    ? {
        product: products.find((p) => p.id === ppcEditKey.productId),
        unit: units.find((u) => u.id === ppcEditKey.unitId),
        person: personnel.find((p) => p.id === ppcEditKey.personnelId),
      }
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-5 w-5 text-violet-600" />
        <h3 className="text-base font-semibold">销售提成配置（按产品 × 单位 × 人员）</h3>
        <p className="text-xs text-muted-foreground w-full sm:w-auto">
          在此配置，自动计入人力成本与收支利润。
        </p>
        <Badge variant="outline" className="border-violet-200 text-violet-700">
          默认折叠 · 展开后再编辑 / 批量设置
        </Badge>
        {canEdit && filteredProducts.length > 0 && (
          <Button size="sm" onClick={() => openBatchPpc({ mode: 'all' })}>
            <Layers className="mr-2 h-4 w-4" />
            批量设置全部产品×人员
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Input
          placeholder="搜索产品名称或分类..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {productsFromSales.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-sm text-muted-foreground">
            暂无来自销售的产品。请先到「销售记录」导入或录入订单，产品会自动出现后再配置提成。
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {productPersonGroups.map(({ product, rows }) => {
          const isProductOpen = expandedPpcProductIds.has(product.id)
          const unitGroups: { unit: SalesUnit; people: typeof rows }[] = []
          const unitMap = new Map<string, { unit: SalesUnit; people: typeof rows }>()
          rows.forEach((row) => {
            let g = unitMap.get(row.unit.id)
            if (!g) {
              g = { unit: row.unit, people: [] }
              unitMap.set(row.unit.id, g)
              unitGroups.push(g)
            }
            g.people.push(row)
          })
          const configuredPeople = rows.filter((r) => {
            const ppc = r.ppc
            return (
              (ppc?.managementCommissionRate || 0) > 0 ||
              (ppc?.personalCommissionRate || 0) > 0
            )
          }).length

          return (
            <Card key={'ppc-' + product.id}>
              <CardContent className="p-0">
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <button
                    type="button"
                    className="flex flex-1 min-w-0 items-center gap-3 text-left"
                    onClick={() =>
                      setExpandedPpcProductIds((prev) => toggleIdInSet(prev, product.id))
                    }
                  >
                    {isProductOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                      <Package className="h-4 w-4 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.category} · {unitGroups.length} 个单位 · {rows.length} 人
                        · 已配提成 {configuredPeople}
                      </p>
                    </div>
                  </button>
                  <Badge variant="secondary" className="shrink-0">
                    {rows.length} 人
                  </Badge>
                  {canEdit && rows.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        openBatchPpc({ mode: 'product', productId: product.id })
                      }}
                    >
                      <Layers className="mr-1.5 h-3.5 w-3.5" />
                      批量设置本产品
                    </Button>
                  )}
                </div>

                {isProductOpen &&
                  (rows.length > 0 ? (
                    <div className="divide-y">
                      {unitGroups.map(({ unit, people }) => {
                        const unitKey = `${product.id}|${unit.id}`
                        const isUnitOpen = expandedPpcUnitKeys.has(unitKey)
                        const unitConfigured = people.filter(
                          (r) =>
                            (r.ppc?.managementCommissionRate || 0) > 0 ||
                            (r.ppc?.personalCommissionRate || 0) > 0,
                        ).length
                        return (
                          <div key={unitKey}>
                            <div className="flex items-center gap-2 bg-violet-50/40 px-4 py-2.5">
                              <button
                                type="button"
                                className="flex flex-1 min-w-0 items-center gap-2 text-left"
                                onClick={() =>
                                  setExpandedPpcUnitKeys((prev) =>
                                    toggleIdInSet(prev, unitKey),
                                  )
                                }
                              >
                                {isUnitOpen ? (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <Building2 className="h-3.5 w-3.5 shrink-0 text-violet-700" />
                                <span className="text-sm font-medium truncate">{unit.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {people.length} 人 · 已配 {unitConfigured}
                                </span>
                              </button>
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 shrink-0 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openBatchPpc({
                                      mode: 'unit',
                                      productId: product.id,
                                      unitId: unit.id,
                                    })
                                  }}
                                >
                                  <Layers className="mr-1 h-3 w-3" />
                                  批量本单位
                                </Button>
                              )}
                            </div>

                            {isUnitOpen && (
                              <div className="overflow-x-auto">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-muted/20">
                                      <TableHead>销售人员</TableHead>
                                      <TableHead className="text-right">管理提成比例</TableHead>
                                      <TableHead className="text-right">管理起算门槛</TableHead>
                                      <TableHead className="text-right">个人提成比例</TableHead>
                                      <TableHead className="text-right">个人起算门槛</TableHead>
                                      <TableHead className="text-right">
                                        本月该产品销售额
                                      </TableHead>
                                      <TableHead className="text-right">操作</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {people.map(({ person, ppc, personSales }) => {
                                      const hasMgmt =
                                        (ppc?.managementCommissionRate || 0) > 0
                                      const hasPersonal =
                                        (ppc?.personalCommissionRate || 0) > 0
                                      return (
                                        <TableRow key={person.id}>
                                          <TableCell>
                                            <div className="flex items-center gap-2">
                                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                                                <Users className="h-3 w-3 text-primary" />
                                              </div>
                                              <span className="text-sm">{person.name}</span>
                                              <span className="text-xs text-muted-foreground">
                                                ({person.position})
                                              </span>
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-right">
                                            {hasMgmt ? (
                                              <Badge className="bg-emerald-100 text-emerald-700">
                                                {ppc!.managementCommissionRate}%
                                              </Badge>
                                            ) : (
                                              <span className="text-xs text-muted-foreground">
                                                未设置
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right text-sm">
                                            {ppc?.managementCommissionThreshold ? (
                                              formatCurrency(ppc.managementCommissionThreshold)
                                            ) : (
                                              <span className="text-xs text-muted-foreground">
                                                -
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right">
                                            {hasPersonal ? (
                                              <Badge className="bg-orange-100 text-orange-700">
                                                {ppc!.personalCommissionRate}%
                                              </Badge>
                                            ) : (
                                              <span className="text-xs text-muted-foreground">
                                                未设置
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right text-sm">
                                            {ppc?.personalCommissionThreshold ? (
                                              formatCurrency(ppc.personalCommissionThreshold)
                                            ) : (
                                              <span className="text-xs text-muted-foreground">
                                                -
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right text-sm font-medium text-blue-600">
                                            {personSales > 0
                                              ? formatCurrency(personSales)
                                              : '-'}
                                          </TableCell>
                                          <TableCell className="text-right">
                                            {canEdit ? (
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                  openPpcEdit(product.id, unit.id, person.id)
                                                }
                                              >
                                                <Pencil className="h-4 w-4" />
                                              </Button>
                                            ) : (
                                              <span className="text-xs text-muted-foreground">
                                                仅查看
                                              </span>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      )
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      该产品下各单位暂无在职人员，请先在「人员管理」中录入。
                    </div>
                  ))}
              </CardContent>
            </Card>
          )
        })}
        {productPersonGroups.length === 0 && productsFromSales.length > 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              没有匹配的产品，请调整搜索条件。
            </CardContent>
          </Card>
        )}
      </div>

      <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 text-sm space-y-2">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-violet-600" />
          <span className="font-semibold text-violet-700">提成计算公式</span>
        </div>
        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground md:grid-cols-2">
          <div>
            <strong>管理提成</strong> = max(0, 团队销售额 - 起算门槛) × 管理提成比例%
          </div>
          <div>
            <strong>个人提成</strong> = max(0, 个人该产品销售额 - 起算门槛) × 个人提成比例%
          </div>
          <div>销售提成 = 管理提成 + 个人提成，按单位×人员配置，自动进入人力成本与收支利润</div>
          <div>未配置人员提成时，沿用「人员管理」中的默认提成参数（如有）</div>
        </div>
      </div>

      <Dialog open={!!ppcEditKey} onOpenChange={(open) => !open && setPpcEditKey(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>配置人员提成</DialogTitle>
          </DialogHeader>
          {ppcTarget?.product && ppcTarget?.unit && ppcTarget?.person && (
            <div className="mb-2 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">产品：</span>
                {ppcTarget.product.name}
              </p>
              <p>
                <span className="text-muted-foreground">销售单位：</span>
                {ppcTarget.unit.name}
              </p>
              <p>
                <span className="text-muted-foreground">销售人员：</span>
                {ppcTarget.person.name}（{ppcTarget.person.position}）
              </p>
            </div>
          )}
          <div className="space-y-4 py-2">
            <div className="rounded-lg border-2 border-emerald-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-700">管理提成</Badge>
                <span className="text-xs text-muted-foreground">按团队销售额计算</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">提成比例 (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={ppcForm.managementCommissionRate}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
                        managementCommissionRate: Number(e.target.value),
                      })
                    }
                    placeholder="如：2"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">起算门槛 (¥)</Label>
                  <Input
                    type="number"
                    value={ppcForm.managementCommissionThreshold}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
                        managementCommissionThreshold: Number(e.target.value),
                      })
                    }
                    placeholder="如：100000"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">发放条件</Label>
                <Input
                  value={ppcForm.managementCommissionCondition}
                  onChange={(e) =>
                    setPpcForm({
                      ...ppcForm,
                      managementCommissionCondition: e.target.value,
                    })
                  }
                  placeholder="如：团队达标后发放"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                计算公式：(团队销售额 - 起算门槛) × 提成比例%
              </p>
            </div>

            <div className="rounded-lg border-2 border-orange-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-orange-100 text-orange-700">个人提成</Badge>
                <span className="text-xs text-muted-foreground">按个人该产品销售额计算</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">提成比例 (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={ppcForm.personalCommissionRate}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
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
                    value={ppcForm.personalCommissionThreshold}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
                        personalCommissionThreshold: Number(e.target.value),
                      })
                    }
                    placeholder="如：50000"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">发放条件</Label>
                <Input
                  value={ppcForm.personalCommissionCondition}
                  onChange={(e) =>
                    setPpcForm({
                      ...ppcForm,
                      personalCommissionCondition: e.target.value,
                    })
                  }
                  placeholder="如：个人达标后发放"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                计算公式：(个人该产品销售额 - 起算门槛) × 提成比例%
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            {ppcEditKey &&
              findPpc(ppcEditKey.productId, ppcEditKey.unitId, ppcEditKey.personnelId)?.id && (
                <Button variant="destructive" onClick={handlePpcClear}>
                  删除配置
                </Button>
              )}
            <Button variant="outline" onClick={() => setPpcEditKey(null)}>
              取消
            </Button>
            <Button onClick={handlePpcSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!batchPpcTarget}
        onOpenChange={(open) => !open && !batchPpcSaving && setBatchPpcTarget(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>一键批量设置人员提成</DialogTitle>
          </DialogHeader>
          <div className="mb-2 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm space-y-1">
            <p>
              已勾选 <strong>{batchPpcSelectedProductIds.length}</strong> 个产品 ×{' '}
              <strong>{batchPpcSelectedUnitIds.length}</strong> 个单位的在职人员
              （覆盖已有提成配置）
            </p>
            <p className="text-xs text-muted-foreground">预计约 {batchPpcPreviewCount} 条</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">选择产品</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      setBatchPpcSelectedProductIds(filteredProducts.map((p) => p.id))
                    }
                  >
                    全选
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setBatchPpcSelectedProductIds([])}
                  >
                    清空
                  </Button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {filteredProducts.map((p) => {
                  const checked = batchPpcSelectedProductIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setBatchPpcSelectedProductIds((prev) => toggleIdInList(prev, p.id))
                        }
                        className="mt-0.5"
                      />
                      <span className="text-sm leading-snug">{p.name}</span>
                    </label>
                  )
                })}
                {filteredProducts.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">暂无产品</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">选择销售单位</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setBatchPpcSelectedUnitIds(units.map((u) => u.id))}
                  >
                    全选
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setBatchPpcSelectedUnitIds([])}
                  >
                    清空
                  </Button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {units.map((u) => {
                  const checked = batchPpcSelectedUnitIds.includes(u.id)
                  return (
                    <label
                      key={u.id}
                      className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setBatchPpcSelectedUnitIds((prev) => toggleIdInList(prev, u.id))
                        }
                        className="mt-0.5"
                      />
                      <span className="text-sm leading-snug">{u.name}</span>
                    </label>
                  )
                })}
                {units.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">暂无销售单位</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border-2 border-emerald-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-700">管理提成</Badge>
                <span className="text-xs text-muted-foreground">按团队销售额计算</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">提成比例 (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={ppcForm.managementCommissionRate}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
                        managementCommissionRate: Number(e.target.value),
                      })
                    }
                    placeholder="如：2"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">起算门槛 (¥)</Label>
                  <Input
                    type="number"
                    value={ppcForm.managementCommissionThreshold}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
                        managementCommissionThreshold: Number(e.target.value),
                      })
                    }
                    placeholder="如：100000"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">发放条件</Label>
                <Input
                  value={ppcForm.managementCommissionCondition}
                  onChange={(e) =>
                    setPpcForm({
                      ...ppcForm,
                      managementCommissionCondition: e.target.value,
                    })
                  }
                  placeholder="如：团队达标后发放"
                />
              </div>
            </div>
            <div className="rounded-lg border-2 border-orange-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-orange-100 text-orange-700">个人提成</Badge>
                <span className="text-xs text-muted-foreground">按个人该产品销售额计算</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">提成比例 (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={ppcForm.personalCommissionRate}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
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
                    value={ppcForm.personalCommissionThreshold}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
                        personalCommissionThreshold: Number(e.target.value),
                      })
                    }
                    placeholder="如：50000"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">发放条件</Label>
                <Input
                  value={ppcForm.personalCommissionCondition}
                  onChange={(e) =>
                    setPpcForm({
                      ...ppcForm,
                      personalCommissionCondition: e.target.value,
                    })
                  }
                  placeholder="如：个人达标后发放"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={batchPpcSaving}
              onClick={() => setBatchPpcTarget(null)}
            >
              取消
            </Button>
            <Button
              disabled={
                batchPpcSaving ||
                batchPpcSelectedProductIds.length === 0 ||
                batchPpcSelectedUnitIds.length === 0
              }
              onClick={handleBatchPpcSave}
            >
              {batchPpcSaving ? '保存中…' : '一键应用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
