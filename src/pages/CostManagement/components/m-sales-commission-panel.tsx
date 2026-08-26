import { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { usePermissions } from '@/hooks/usePermissions'
import { formatCurrency, formatDate } from '@/lib/format'
import { filterByMonth } from '@/lib/salary'
import { getPersonShareAmount } from '@/lib/saleCollaborators'
import {
  formatCommissionRewardPeriod,
  groupCommissionRewardHits,
} from '@/lib/commissionReward'
import type { SalesUnit, ProductPersonCommission, Personnel, Product, UnitProductSettlement } from '@/types'
import {
  Building2, Package, Pencil, Users, Layers, Calculator,
  ChevronDown, ChevronRight, ListOrdered,
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type PersonalCommissionType = 'percentage' | 'fixed'

const EMPTY_PERSON_COMMISSION = {
  managementCommissionRate: 0,
  managementCommissionThreshold: 0,
  managementCommissionCondition: '',
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

/** 产品结算为固定金额时，个人提成默认固定金额 */
function getDefaultPersonalCommissionType(
  productId: string,
  unitId: string | undefined,
  upsList: UnitProductSettlement[],
  productList: Product[],
): PersonalCommissionType {
  if (unitId) {
    const ups = upsList.find((x) => x.productId === productId && x.salesUnitId === unitId)
    if (ups?.settlementType === 'fixed') return 'fixed'
    if (ups?.settlementType === 'percentage') return 'percentage'
  }
  const product = productList.find((p) => p.id === productId)
  if (product?.settlementType === 'fixed') return 'fixed'
  return 'percentage'
}

function getInternalRecipientSelectValue(
  sourcePersonnelId: string,
  recipientId?: string,
): string {
  const rid = (recipientId || '').trim()
  if (!rid) return '__inherit__'
  if (rid === sourcePersonnelId) return '__self__'
  return rid
}

function parseInternalRecipientSelectValue(
  sourcePersonnelId: string,
  value: string,
): string {
  if (value === '__inherit__') return ''
  if (value === '__self__') return sourcePersonnelId
  return value
}

function resolveBatchInternalRecipient(
  sourcePersonnelId: string,
  selectOrStored: string,
): string {
  const v = (selectOrStored || '').trim()
  if (!v || v === '__inherit__') return ''
  if (v === '__self__') return sourcePersonnelId
  return v
}

type Props = {
  selectedMonth: string
}

export default function MSalesCommissionPanel({ selectedMonth }: Props) {
  const {
    products,
    allSalesRecords: salesRecords,
    productPersonCommissions: ppcList,
    unitProductSettlements: upsList,
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
  const [rewardHitsKey, setRewardHitsKey] = useState<{
    productId: string
    unitId?: string
    personnelId?: string
  } | null>(null)

  const [expandedPpcProductIds, setExpandedPpcProductIds] = useState<Set<string>>(new Set())
  const [expandedPpcUnitKeys, setExpandedPpcUnitKeys] = useState<Set<string>>(new Set())

  const ppcUnitColleagues = useMemo(() => {
    if (!ppcEditKey) return []
    return personnel
      .filter(
        (p) =>
          p.status === 'active'
          && p.salesUnitId === ppcEditKey.unitId
          && p.id !== ppcEditKey.personnelId,
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [ppcEditKey, personnel])

  const batchUnitColleagues = useMemo(() => {
    const unitSet = new Set(batchPpcSelectedUnitIds)
    if (unitSet.size === 0) return []
    return personnel
      .filter((p) => p.status === 'active' && unitSet.has(p.salesUnitId))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [batchPpcSelectedUnitIds, personnel])

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
      .filter((s) => s.productId === productId)
      .reduce((sum, s) => sum + getPersonShareAmount(s, personId), 0)
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
    const defaultType = getDefaultPersonalCommissionType(productId, unitId, upsList, products)
    if (ppc) {
      setPpcForm({
        ...EMPTY_PERSON_COMMISSION,
        ...ppc,
        personalCommissionType: ppc.personalCommissionType || defaultType,
        personalCommissionAmount: ppc.personalCommissionAmount || 0,
        internalSalesCommissionRecipientId: ppc.internalSalesCommissionRecipientId || '',
        rewardAmount: ppc.rewardAmount || 0,
        rewardFrom: ppc.rewardFrom || '',
        rewardTo: ppc.rewardTo || '',
      })
    } else {
      setPpcForm({
        ...EMPTY_PERSON_COMMISSION,
        personalCommissionType: defaultType,
      })
    }
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
        managementCommissionRate: 0,
        managementCommissionThreshold: 0,
        managementCommissionCondition: '',
        personalCommissionType: ppcForm.personalCommissionType || 'percentage',
        personalCommissionRate: ppcForm.personalCommissionRate || 0,
        personalCommissionAmount: ppcForm.personalCommissionAmount || 0,
        personalCommissionThreshold: ppcForm.personalCommissionThreshold || 0,
        personalCommissionCondition: ppcForm.personalCommissionCondition,
        internalSalesCommissionType: ppcForm.internalSalesCommissionType || 'percentage',
        internalSalesCommissionRate: ppcForm.internalSalesCommissionRate || 0,
        internalSalesCommissionAmount: ppcForm.internalSalesCommissionAmount || 0,
        internalSalesCommissionThreshold: ppcForm.internalSalesCommissionThreshold || 0,
        internalSalesCommissionCondition: ppcForm.internalSalesCommissionCondition,
        internalSalesCommissionRecipientId: ppcForm.internalSalesCommissionRecipientId || '',
        rewardAmount: ppcForm.rewardAmount || 0,
        rewardFrom: ppcForm.rewardFrom || '',
        rewardTo: ppcForm.rewardTo || '',
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
          managementCommissionRate: 0,
          managementCommissionThreshold: 0,
          managementCommissionCondition: '',
          personalCommissionType: ppcForm.personalCommissionType || 'percentage',
          personalCommissionRate: ppcForm.personalCommissionRate || 0,
          personalCommissionAmount: ppcForm.personalCommissionAmount || 0,
          personalCommissionThreshold: ppcForm.personalCommissionThreshold || 0,
          personalCommissionCondition: ppcForm.personalCommissionCondition,
          internalSalesCommissionType: ppcForm.internalSalesCommissionType || 'percentage',
          internalSalesCommissionRate: ppcForm.internalSalesCommissionRate || 0,
          internalSalesCommissionAmount: ppcForm.internalSalesCommissionAmount || 0,
          internalSalesCommissionThreshold: ppcForm.internalSalesCommissionThreshold || 0,
          internalSalesCommissionCondition: ppcForm.internalSalesCommissionCondition,
          internalSalesCommissionRecipientId: resolveBatchInternalRecipient(
            person.id,
            ppcForm.internalSalesCommissionRecipientId,
          ),
          rewardAmount: ppcForm.rewardAmount || 0,
          rewardFrom: ppcForm.rewardFrom || '',
          rewardTo: ppcForm.rewardTo || '',
        })),
      ),
    )
  }

  function openBatchPpc(target: BatchPpcTarget) {
    let defaultType: PersonalCommissionType = 'percentage'
    if (target.mode === 'unit') {
      defaultType = getDefaultPersonalCommissionType(
        target.productId, target.unitId, upsList, products,
      )
    } else if (target.mode === 'product') {
      defaultType = getDefaultPersonalCommissionType(
        target.productId, undefined, upsList, products,
      )
      // 若该产品在任一单位为固定结算，优先固定
      const anyFixed = upsList.some(
        (u) => u.productId === target.productId && u.settlementType === 'fixed',
      )
      if (anyFixed) defaultType = 'fixed'
    } else {
      const productIds = filteredProducts.map((p) => p.id)
      const anyFixed = productIds.some((pid) =>
        upsList.some((u) => u.productId === pid && u.settlementType === 'fixed')
        || products.find((p) => p.id === pid)?.settlementType === 'fixed',
      )
      if (anyFixed) defaultType = 'fixed'
    }
    setPpcForm({ ...EMPTY_PERSON_COMMISSION, personalCommissionType: defaultType })
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

  const rewardHitGroups = useMemo(() => {
    if (!rewardHitsKey) return []
    return groupCommissionRewardHits({
      salesRecords,
      ppcList,
      units,
      productId: rewardHitsKey.productId,
      unitId: rewardHitsKey.unitId,
      personnelId: rewardHitsKey.personnelId,
    })
  }, [rewardHitsKey, salesRecords, ppcList, units])

  const rewardHitsMeta = rewardHitsKey
    ? {
        product: products.find((p) => p.id === rewardHitsKey.productId),
        unit: rewardHitsKey.unitId
          ? units.find((u) => u.id === rewardHitsKey.unitId)
          : undefined,
        person: rewardHitsKey.personnelId
          ? personnel.find((p) => p.id === rewardHitsKey.personnelId)
          : undefined,
      }
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-5 w-5 text-violet-600" />
        <h3 className="text-base font-semibold">销售提成配置（按产品 × 单位 × 人员）</h3>
        <p className="text-xs text-muted-foreground w-full sm:w-auto">
          配置个人提成与特殊奖励；团队管理提成请在上方「团队管理提成」区设置。
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
            const hasPersonalFixed =
              ppc?.personalCommissionType === 'fixed' && (ppc.personalCommissionAmount || 0) > 0
            return (
              (ppc?.personalCommissionRate || 0) > 0 ||
              hasPersonalFixed ||
              (ppc?.rewardAmount || 0) > 0
            )
          }).length
          const hasAnyReward = rows.some((r) => (r.ppc?.rewardAmount || 0) > 0)

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
                  {hasAnyReward && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 border-amber-200 text-amber-800"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRewardHitsKey({ productId: product.id })
                      }}
                    >
                      <ListOrdered className="mr-1.5 h-3.5 w-3.5" />
                      奖励命中（按单位）
                    </Button>
                  )}
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
                        const unitConfigured = people.filter((r) => {
                          const hasPersonalFixed =
                            r.ppc?.personalCommissionType === 'fixed'
                            && (r.ppc.personalCommissionAmount || 0) > 0
                          return (
                            (r.ppc?.personalCommissionRate || 0) > 0 ||
                            hasPersonalFixed ||
                            (r.ppc?.rewardAmount || 0) > 0
                          )
                        }).length
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
                                      <TableHead className="text-right">个人提成</TableHead>
                                      <TableHead className="text-right">特殊奖励</TableHead>
                                      <TableHead className="text-right">
                                        本月该产品销售额
                                      </TableHead>
                                      <TableHead className="text-right">操作</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {people.map(({ person, ppc, personSales }) => {
                                      const isPersonalFixed = ppc?.personalCommissionType === 'fixed'
                                      const hasPersonal = isPersonalFixed
                                        ? (ppc?.personalCommissionAmount || 0) > 0
                                        : (ppc?.personalCommissionRate || 0) > 0
                                      const hasReward = (ppc?.rewardAmount || 0) > 0
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
                                            {hasPersonal ? (
                                              <Badge className="bg-orange-100 text-orange-700">
                                                {isPersonalFixed
                                                  ? `${formatCurrency(ppc!.personalCommissionAmount || 0)}/件`
                                                  : `${ppc!.personalCommissionRate}%`}
                                              </Badge>
                                            ) : (
                                              <span className="text-xs text-muted-foreground">
                                                未设置
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right text-sm">
                                            {hasReward ? (
                                              <div className="flex flex-col items-end gap-0.5">
                                                <span className="text-amber-600 font-medium">
                                                  +{formatCurrency(ppc!.rewardAmount || 0)}/件
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">
                                                  {formatCommissionRewardPeriod(ppc)}
                                                </span>
                                              </div>
                                            ) : (
                                              <span className="text-xs text-muted-foreground">-</span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right text-sm font-medium text-blue-600">
                                            {personSales > 0
                                              ? formatCurrency(personSales)
                                              : '-'}
                                          </TableCell>
                                          <TableCell className="text-right">
                                            <div className="flex justify-end gap-0.5">
                                              {hasReward && (
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  title="查看命中记录"
                                                  onClick={() =>
                                                    setRewardHitsKey({
                                                      productId: product.id,
                                                      unitId: unit.id,
                                                      personnelId: person.id,
                                                    })
                                                  }
                                                >
                                                  <ListOrdered className="h-4 w-4 text-amber-600" />
                                                </Button>
                                              )}
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
                                            </div>
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
            <strong>个人提成</strong>（比例）= max(0, 销售额 - 门槛) × 比例%；
            （固定）= 销售数量 × 每件提成金额；可叠加特殊时段按件奖励
          </div>
          <div>
            <strong>团队管理提成</strong>在上方单独配置：可计实收 × 档位比例，再按管理人员权重分摊
          </div>
          <div>销售提成合计 = 个人提成 + 团队管理提成，自动进入人力成本与收支利润</div>
          <div>未配置个人提成时，沿用「人员管理」中的默认提成参数（如有）</div>
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
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs text-emerald-800">
              管理提成已改为单位级「团队管理提成」，请在成本管理上方配置区设置。
            </div>

            <div className="rounded-lg border-2 border-orange-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-orange-100 text-orange-700">个人提成</Badge>
                <span className="text-xs text-muted-foreground">
                  {ppcForm.personalCommissionType === 'fixed'
                    ? '按件固定金额'
                    : '按个人该产品销售额计算'}
                </span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">提成方式</Label>
                <Select
                  value={ppcForm.personalCommissionType}
                  onValueChange={(v) =>
                    setPpcForm({
                      ...ppcForm,
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
                {ppcForm.personalCommissionType === 'fixed' && (
                  <p className="text-[11px] text-violet-700">
                    该产品结算为固定金额时，默认使用按件固定提成（可改回比例）
                  </p>
                )}
              </div>
              {ppcForm.personalCommissionType === 'fixed' ? (
                <div className="space-y-1">
                  <Label className="text-xs">每件提成金额 (¥)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={ppcForm.personalCommissionAmount}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
                        personalCommissionAmount: Number(e.target.value),
                      })
                    }
                    placeholder="如：50"
                  />
                  <p className="text-xs text-muted-foreground">
                    计算公式：销售数量 × 每件提成金额
                  </p>
                </div>
              ) : (
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
              )}
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
              {ppcForm.personalCommissionType !== 'fixed' && (
                <p className="text-xs text-muted-foreground">
                  计算公式：(个人该产品销售额 - 起算门槛) × 提成比例%
                </p>
              )}
            </div>

            <div className="rounded-lg border-2 border-sky-200 bg-sky-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-sky-100 text-sky-800">内部销售提成</Badge>
                <span className="text-xs text-muted-foreground">不计入业额，计入人力成本</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">提成方式</Label>
                <Select
                  value={ppcForm.internalSalesCommissionType}
                  onValueChange={(v) =>
                    setPpcForm({
                      ...ppcForm,
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
              {ppcForm.internalSalesCommissionType === 'fixed' ? (
                <div className="space-y-1">
                  <Label className="text-xs">每件提成金额 (¥)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={ppcForm.internalSalesCommissionAmount}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
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
                      value={ppcForm.internalSalesCommissionRate}
                      onChange={(e) =>
                        setPpcForm({
                          ...ppcForm,
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
                      value={ppcForm.internalSalesCommissionThreshold}
                      onChange={(e) =>
                        setPpcForm({
                          ...ppcForm,
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
                  value={
                    ppcEditKey
                      ? getInternalRecipientSelectValue(
                          ppcEditKey.personnelId,
                          ppcForm.internalSalesCommissionRecipientId,
                        )
                      : ppcForm.internalSalesCommissionRecipientId || '__inherit__'
                  }
                  onValueChange={(v) =>
                    setPpcForm({
                      ...ppcForm,
                      internalSalesCommissionRecipientId: ppcEditKey
                        ? parseInternalRecipientSelectValue(ppcEditKey.personnelId, v)
                        : v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择受益人" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__inherit__">沿用人员薪酬默认</SelectItem>
                    <SelectItem value="__self__">成交人本人</SelectItem>
                    {ppcUnitColleagues.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.position ? `（${p.position}）` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  仅显示本单位在职同事
                </p>
              </div>
            </div>

            <div className="rounded-lg border-2 border-amber-200 bg-amber-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-amber-100 text-amber-800">特殊时段奖励</Badge>
                  <span className="text-xs text-muted-foreground">按件额外计入个人提成</span>
                </div>
                {ppcEditKey && (ppcForm.rewardAmount || 0) > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setRewardHitsKey({
                        productId: ppcEditKey.productId,
                        unitId: ppcEditKey.unitId,
                        personnelId: ppcEditKey.personnelId,
                      })
                    }
                  >
                    <ListOrdered className="mr-1 h-3 w-3" />
                    查看命中记录
                  </Button>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">每件奖励金额 (¥)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={ppcForm.rewardAmount}
                  onChange={(e) =>
                    setPpcForm({ ...ppcForm, rewardAmount: Number(e.target.value) })
                  }
                  placeholder="0 表示无奖励"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">奖励开始日期</Label>
                  <Input
                    type="date"
                    value={ppcForm.rewardFrom}
                    onChange={(e) =>
                      setPpcForm({ ...ppcForm, rewardFrom: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">奖励结束日期</Label>
                  <Input
                    type="date"
                    value={ppcForm.rewardTo}
                    onChange={(e) =>
                      setPpcForm({ ...ppcForm, rewardTo: e.target.value })
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                留空表示不限；仅销售日落在区间内的成交按件加奖
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
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs text-emerald-800">
              管理提成请到「团队管理提成」配置；此处仅设置个人提成与特殊奖励。
            </div>
            <div className="rounded-lg border-2 border-orange-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-orange-100 text-orange-700">个人提成</Badge>
                <span className="text-xs text-muted-foreground">
                  {ppcForm.personalCommissionType === 'fixed'
                    ? '按件固定金额'
                    : '按个人该产品销售额计算'}
                </span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">提成方式</Label>
                <Select
                  value={ppcForm.personalCommissionType}
                  onValueChange={(v) =>
                    setPpcForm({
                      ...ppcForm,
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
                {ppcForm.personalCommissionType === 'fixed' && (
                  <p className="text-[11px] text-violet-700">
                    勾选产品若结算为固定金额，已默认按件固定提成
                  </p>
                )}
              </div>
              {ppcForm.personalCommissionType === 'fixed' ? (
                <div className="space-y-1">
                  <Label className="text-xs">每件提成金额 (¥)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={ppcForm.personalCommissionAmount}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
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
              )}
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

            <div className="rounded-lg border-2 border-sky-200 bg-sky-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-sky-100 text-sky-800">内部销售提成</Badge>
                <span className="text-xs text-muted-foreground">不计入业额，批量写入每人配置</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">提成方式</Label>
                <Select
                  value={ppcForm.internalSalesCommissionType}
                  onValueChange={(v) =>
                    setPpcForm({
                      ...ppcForm,
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
              {ppcForm.internalSalesCommissionType === 'fixed' ? (
                <div className="space-y-1">
                  <Label className="text-xs">每件提成金额 (¥)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={ppcForm.internalSalesCommissionAmount}
                    onChange={(e) =>
                      setPpcForm({
                        ...ppcForm,
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
                      value={ppcForm.internalSalesCommissionRate}
                      onChange={(e) =>
                        setPpcForm({
                          ...ppcForm,
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
                      value={ppcForm.internalSalesCommissionThreshold}
                      onChange={(e) =>
                        setPpcForm({
                          ...ppcForm,
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
                  value={ppcForm.internalSalesCommissionRecipientId || '__inherit__'}
                  onValueChange={(v) =>
                    setPpcForm({
                      ...ppcForm,
                      internalSalesCommissionRecipientId: v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择受益人" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__inherit__">沿用人员薪酬默认</SelectItem>
                    <SelectItem value="__self__">各成交人本人（批量分别生效）</SelectItem>
                    {batchUnitColleagues.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.position ? `（${p.position}）` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  显示已选单位内的在职同事
                </p>
              </div>
            </div>

            <div className="rounded-lg border-2 border-amber-200 bg-amber-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-100 text-amber-800">特殊时段奖励</Badge>
                <span className="text-xs text-muted-foreground">批量写入每人配置</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">每件奖励金额 (¥)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={ppcForm.rewardAmount}
                  onChange={(e) =>
                    setPpcForm({ ...ppcForm, rewardAmount: Number(e.target.value) })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">奖励开始</Label>
                  <Input
                    type="date"
                    value={ppcForm.rewardFrom}
                    onChange={(e) =>
                      setPpcForm({ ...ppcForm, rewardFrom: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">奖励结束</Label>
                  <Input
                    type="date"
                    value={ppcForm.rewardTo}
                    onChange={(e) =>
                      setPpcForm({ ...ppcForm, rewardTo: e.target.value })
                    }
                  />
                </div>
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

      <Dialog open={!!rewardHitsKey} onOpenChange={(open) => !open && setRewardHitsKey(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>特殊奖励命中成交记录</DialogTitle>
          </DialogHeader>
          {rewardHitsMeta && (
            <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">产品：</span>
                {rewardHitsMeta.product?.name || '-'}
              </p>
              {rewardHitsMeta.unit && (
                <p>
                  <span className="text-muted-foreground">单位：</span>
                  {rewardHitsMeta.unit.name}
                </p>
              )}
              {rewardHitsMeta.person && (
                <p>
                  <span className="text-muted-foreground">人员：</span>
                  {rewardHitsMeta.person.name}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                按销售单位分组；仅展示已配置奖励且销售日落在奖励区间内的成交
              </p>
            </div>
          )}
          <div className="space-y-4">
            {rewardHitGroups.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                暂无命中记录（请确认已配置奖励金额与时间段，且存在对应成交）
              </p>
            )}
            {rewardHitGroups.map((group) => (
              <Card key={group.unitId}>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{group.unitName}</span>
                      <Badge variant="outline" className="text-xs">
                        {group.hits.length} 笔
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-x-3">
                      <span>数量 {group.totalQty}</span>
                      <span>订单额 {formatCurrency(group.totalAmount)}</span>
                      <span className="font-medium text-amber-700">
                        奖励合计 {formatCurrency(group.totalReward)}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>销售日期</TableHead>
                          <TableHead>人员</TableHead>
                          <TableHead>客户</TableHead>
                          <TableHead className="text-right">数量</TableHead>
                          <TableHead className="text-right">订单金额</TableHead>
                          <TableHead className="text-right">本单奖励</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.hits
                          .slice()
                          .sort((a, b) =>
                            (b.sale.saleDate || '').localeCompare(a.sale.saleDate || ''),
                          )
                          .map((hit) => {
                            const person = personnel.find((p) => p.id === hit.sale.personnelId)
                            return (
                              <TableRow key={hit.sale.id}>
                                <TableCell className="text-sm">
                                  {formatDate(hit.sale.saleDate)}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {person?.name || hit.sale.salesPersonName || '-'}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {hit.sale.customerName || '-'}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {hit.sale.quantity || 0}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {formatCurrency(hit.sale.totalAmount)}
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium text-amber-600">
                                  {formatCurrency(hit.reward)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRewardHitsKey(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
