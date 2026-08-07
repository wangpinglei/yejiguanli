import { useMemo, useState } from 'react'
import type { Product, SalesRecord, UnitProductSettlement } from '@/types'
import { formatCurrency } from '@/lib/format'
import { calcSaleSettlementIncome } from '@/lib/settlement'
import { Tags, Plus, CheckSquare, X, Eraser, Pencil, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const UNCATEGORIZED = '__uncategorized__'
const UNCATEGORIZED_LABEL = '未分类'

type DomainSummary = {
  key: string
  name: string
  productCount: number
  salesAmount: number
  settlementIncome: number
}

type ProductMetric = {
  productId: string
  salesAmount: number
  settlementIncome: number
}

type Props = {
  products: Product[]
  monthlySales: SalesRecord[]
  upsList: UnitProductSettlement[]
  selectedMonth: string
  canEdit: boolean
  domainOptions: string[]
  onAddDomain?: (name: string) => void
  onRemoveDomain?: (name: string) => Promise<void> | void
  onClearAllDomains?: () => Promise<void> | void
  onUpdateCategory: (productId: string, category: string) => Promise<void>
}

function getProductDomainKey(product: Product): string {
  return (product.category || '').trim() || UNCATEGORIZED
}

function getProductDomainName(product: Product): string {
  return (product.category || '').trim() || UNCATEGORIZED_LABEL
}

function emptySummary(): Omit<DomainSummary, 'key' | 'name'> {
  return { productCount: 0, salesAmount: 0, settlementIncome: 0 }
}

function sumRows(rows: DomainSummary[]): Omit<DomainSummary, 'key' | 'name'> {
  return rows.reduce(
    (acc, row) => ({
      productCount: acc.productCount + row.productCount,
      salesAmount: acc.salesAmount + row.salesAmount,
      settlementIncome: acc.settlementIncome + row.settlementIncome,
    }),
    emptySummary(),
  )
}

export default function MBusinessDomainSection({
  products,
  monthlySales,
  upsList,
  selectedMonth,
  canEdit,
  domainOptions,
  onAddDomain,
  onRemoveDomain,
  onClearAllDomains,
  onUpdateCategory,
}: Props) {
  const [newDomain, setNewDomain] = useState('')
  const [isDomainEditMode, setIsDomainEditMode] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchDomain, setBatchDomain] = useState('')
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [batchOnlyUncategorized, setBatchOnlyUncategorized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedDomainKeys, setSelectedDomainKeys] = useState<string[]>([])
  const [productPickOpen, setProductPickOpen] = useState(false)
  const [pickedProductIds, setPickedProductIds] = useState<string[]>([])

  const uncategorizedProducts = useMemo(
    () => products.filter((p) => getProductDomainKey(p) === UNCATEGORIZED),
    [products],
  )

  const batchProductList = useMemo(
    () => (batchOnlyUncategorized ? uncategorizedProducts : products),
    [batchOnlyUncategorized, uncategorizedProducts, products],
  )

  const productMetricMap = useMemo(() => {
    const map = new Map<string, ProductMetric>()
    monthlySales.forEach((s) => {
      if (!s.productId) return
      let row = map.get(s.productId)
      if (!row) {
        row = { productId: s.productId, salesAmount: 0, settlementIncome: 0 }
        map.set(s.productId, row)
      }
      row.salesAmount += s.totalAmount || 0
      row.settlementIncome += calcSaleSettlementIncome(s, upsList)
    })
    return map
  }, [monthlySales, upsList])

  const summaries = useMemo((): DomainSummary[] => {
    const map = new Map<string, DomainSummary>()
    function ensure(key: string, name: string) {
      let row = map.get(key)
      if (!row) {
        row = {
          key,
          name,
          productCount: 0,
          salesAmount: 0,
          settlementIncome: 0,
        }
        map.set(key, row)
      }
      return row
    }

    products.forEach((p) => {
      ensure(getProductDomainKey(p), getProductDomainName(p)).productCount += 1
    })

    monthlySales.forEach((s) => {
      const product = products.find((p) => p.id === s.productId)
      if (!product) return
      const row = ensure(getProductDomainKey(product), getProductDomainName(product))
      row.salesAmount += s.totalAmount || 0
      row.settlementIncome += calcSaleSettlementIncome(s, upsList)
    })

    return Array.from(map.values()).sort((a, b) => {
      if (a.key === UNCATEGORIZED) return 1
      if (b.key === UNCATEGORIZED) return -1
      return b.settlementIncome - a.settlementIncome
    })
  }, [products, monthlySales, upsList])

  const totalSummary = useMemo(() => sumRows(summaries), [summaries])

  const selectedDomainSummaries = useMemo(
    () => summaries.filter((row) => selectedDomainKeys.includes(row.key)),
    [summaries, selectedDomainKeys],
  )

  const selectedDomainTotal = useMemo(
    () => sumRows(selectedDomainSummaries),
    [selectedDomainSummaries],
  )

  const productsInSelectedDomains = useMemo(() => {
    if (selectedDomainKeys.length === 0) return []
    return products.filter((p) => selectedDomainKeys.includes(getProductDomainKey(p)))
  }, [products, selectedDomainKeys])

  const pickedProductTotal = useMemo(() => {
    const idSet = new Set(pickedProductIds)
    let productCount = 0
    let salesAmount = 0
    let settlementIncome = 0
    productsInSelectedDomains.forEach((p) => {
      if (!idSet.has(p.id)) return
      productCount += 1
      const metric = productMetricMap.get(p.id)
      salesAmount += metric?.salesAmount || 0
      settlementIncome += metric?.settlementIncome || 0
    })
    return { productCount, salesAmount, settlementIncome }
  }, [pickedProductIds, productsInSelectedDomains, productMetricMap])

  const batchSelectedTotal = useMemo(() => {
    const idSet = new Set(selectedProductIds)
    let productCount = 0
    let salesAmount = 0
    let settlementIncome = 0
    products.forEach((p) => {
      if (!idSet.has(p.id)) return
      productCount += 1
      const metric = productMetricMap.get(p.id)
      salesAmount += metric?.salesAmount || 0
      settlementIncome += metric?.settlementIncome || 0
    })
    return { productCount, salesAmount, settlementIncome }
  }, [selectedProductIds, products, productMetricMap])

  async function handleRemoveDomain(name: string) {
    if (!onRemoveDomain) return
    if (!confirm(`确定删除业务域「${name}」？相关产品将变为未分类。`)) return
    setSaving(true)
    try {
      await onRemoveDomain(name)
      setSelectedDomainKeys((prev) => prev.filter((k) => k !== name))
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('删除失败: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleClearAllDomains() {
    if (!onClearAllDomains) return
    if (!confirm('确定清空全部业务域？所有产品将变为未分类，可再自行添加。')) return
    setSaving(true)
    try {
      await onClearAllDomains()
      setSelectedDomainKeys([])
      setPickedProductIds([])
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('清空失败: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  function handleAddDomain() {
    const name = newDomain.trim()
    if (!name) return
    onAddDomain?.(name)
    setNewDomain('')
  }

  function openBatchAssign(onlyUncategorized = false) {
    setBatchDomain(domainOptions[0] || '')
    setBatchOnlyUncategorized(onlyUncategorized)
    const list = onlyUncategorized
      ? products.filter((p) => getProductDomainKey(p) === UNCATEGORIZED)
      : []
    setSelectedProductIds(list.map((p) => p.id))
    setBatchOpen(true)
  }

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function toggleBatchSelectAll() {
    const ids = batchProductList.map((p) => p.id)
    const allSelected = ids.length > 0 && ids.every((id) => selectedProductIds.includes(id))
    setSelectedProductIds(allSelected ? [] : ids)
  }

  function toggleDomain(key: string) {
    setSelectedDomainKeys((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    )
  }

  function toggleAllDomains() {
    if (selectedDomainKeys.length === summaries.length) {
      setSelectedDomainKeys([])
      return
    }
    setSelectedDomainKeys(summaries.map((row) => row.key))
  }

  function openProductPick() {
    if (selectedDomainKeys.length === 0) {
      alert('请先勾选要组合查看的业务域')
      return
    }
    setPickedProductIds(productsInSelectedDomains.map((p) => p.id))
    setProductPickOpen(true)
  }

  function togglePickedProduct(id: string) {
    setPickedProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function handleBatchSave() {
    const domain = batchDomain.trim()
    if (!domain) {
      alert('请先选择或输入业务域')
      return
    }
    if (selectedProductIds.length === 0) {
      alert('请勾选要归入该业务域的产品')
      return
    }
    setSaving(true)
    try {
      for (const id of selectedProductIds) {
        await onUpdateCategory(id, domain)
      }
      if (!domainOptions.includes(domain)) {
        onAddDomain?.(domain)
      }
      setBatchOpen(false)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误'
      alert('批量设置失败: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Tags className="h-4 w-4 text-teal-700" />
            业务域分类与汇总
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            勾选业务域可组合查看汇总；也可多选产品查看产品数 / 实收 / 结算收入
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summaries.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={openProductPick}
              disabled={selectedDomainKeys.length === 0}
            >
              <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
              组合多选产品
            </Button>
          )}
          {canEdit && uncategorizedProducts.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="border-amber-300 text-amber-800 hover:bg-amber-50"
              onClick={() => openBatchAssign(true)}
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              查阅未分类（{uncategorizedProducts.length}）
            </Button>
          )}
          {canEdit && products.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => openBatchAssign(false)}>
              <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
              勾选产品归入业务域
            </Button>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <div className="space-y-1 min-w-[180px] flex-1">
            <Label className="text-xs">新增业务域名称</Label>
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="例如：教育 / 医疗 / 政务"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddDomain()
              }}
            />
          </div>
          <Button type="button" variant="secondary" onClick={handleAddDomain} disabled={saving}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加
          </Button>
          <Button
            type="button"
            variant={isDomainEditMode ? 'default' : 'outline'}
            onClick={() => setIsDomainEditMode((v) => !v)}
            disabled={saving}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {isDomainEditMode ? '完成编辑' : '编辑业务域'}
          </Button>
          {isDomainEditMode && domainOptions.length > 0 && onClearAllDomains && (
            <Button
              type="button"
              variant="outline"
              className="text-destructive border-destructive/30"
              onClick={handleClearAllDomains}
              disabled={saving}
            >
              <Eraser className="mr-1 h-3.5 w-3.5" />
              清空全部
            </Button>
          )}
          {domainOptions.length > 0 && (
            <div className="w-full flex flex-wrap gap-1.5 pt-1">
              {domainOptions.map((d) => (
                <Badge
                  key={d}
                  variant="secondary"
                  className={`bg-teal-50 text-teal-800 gap-1 ${isDomainEditMode ? 'pr-1' : ''}`}
                >
                  {d}
                  {isDomainEditMode && onRemoveDomain && (
                    <button
                      type="button"
                      className="ml-0.5 rounded-sm p-0.5 hover:bg-teal-200/80 disabled:opacity-50"
                      title={`删除「${d}」`}
                      disabled={saving}
                      onClick={() => handleRemoveDomain(d)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          )}
          {isDomainEditMode && (
            <p className="w-full text-xs text-muted-foreground pt-0.5">
              编辑模式下可删除单个业务域或清空全部；完成后请点「完成编辑」
            </p>
          )}
        </div>
      )}

      {selectedDomainKeys.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
          <div>
            <p className="text-xs text-muted-foreground">已选业务域</p>
            <p className="text-lg font-semibold text-teal-800">
              {selectedDomainKeys.length} 个
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">产品数汇总</p>
            <p className="text-lg font-semibold">{selectedDomainTotal.productCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{selectedMonth} 实收汇总</p>
            <p className="text-lg font-semibold text-blue-700">
              {formatCurrency(selectedDomainTotal.salesAmount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{selectedMonth} 结算收入汇总</p>
            <p className="text-lg font-semibold text-cyan-700">
              {formatCurrency(selectedDomainTotal.settlementIncome)}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-10 text-center">
                  {summaries.length > 0 && (
                    <Checkbox
                      checked={
                        selectedDomainKeys.length > 0
                        && selectedDomainKeys.length === summaries.length
                      }
                      onCheckedChange={toggleAllDomains}
                      aria-label="全选业务域"
                    />
                  )}
                </TableHead>
                <TableHead>业务域</TableHead>
                <TableHead className="text-right">产品数</TableHead>
                <TableHead className="text-right">{selectedMonth} 实收</TableHead>
                <TableHead className="text-right">{selectedMonth} 结算收入</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((row) => {
                const checked = selectedDomainKeys.includes(row.key)
                return (
                  <TableRow
                    key={row.key}
                    className={checked ? 'bg-teal-50/50' : undefined}
                  >
                    <TableCell className="text-center">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleDomain(row.key)}
                        aria-label={`选择业务域 ${row.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.key === UNCATEGORIZED ? (
                        <span className="text-muted-foreground">{row.name}</span>
                      ) : (
                        <Badge className="bg-teal-100 text-teal-800">{row.name}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{row.productCount}</TableCell>
                    <TableCell className="text-right">
                      {row.salesAmount > 0 ? formatCurrency(row.salesAmount) : '-'}
                    </TableCell>
                    <TableCell className="text-right text-cyan-700 font-medium">
                      {row.settlementIncome > 0
                        ? formatCurrency(row.settlementIncome)
                        : '-'}
                    </TableCell>
                  </TableRow>
                )
              })}
              {summaries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-8 text-muted-foreground text-sm"
                  >
                    暂无产品，导入销售记录后可在此分类并查看汇总
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {summaries.length > 0 && (
              <TableFooter>
                <TableRow className="bg-muted/60 font-semibold">
                  <TableCell />
                  <TableCell>合计</TableCell>
                  <TableCell className="text-right">{totalSummary.productCount}</TableCell>
                  <TableCell className="text-right">
                    {totalSummary.salesAmount > 0
                      ? formatCurrency(totalSummary.salesAmount)
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right text-cyan-800">
                    {totalSummary.settlementIncome > 0
                      ? formatCurrency(totalSummary.settlementIncome)
                      : '-'}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Dialog open={productPickOpen} onOpenChange={setProductPickOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>组合多选产品 · 查看汇总</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              已选业务域：
              {selectedDomainSummaries.map((d) => d.name).join('、') || '-'}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <p className="text-xs text-muted-foreground">产品数汇总</p>
                <p className="text-base font-semibold">{pickedProductTotal.productCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{selectedMonth} 实收汇总</p>
                <p className="text-base font-semibold text-blue-700">
                  {formatCurrency(pickedProductTotal.salesAmount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{selectedMonth} 结算收入汇总</p>
                <p className="text-base font-semibold text-cyan-700">
                  {formatCurrency(pickedProductTotal.settlementIncome)}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>勾选产品（可跨业务域组合）</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setPickedProductIds(
                    pickedProductIds.length === productsInSelectedDomains.length
                      ? []
                      : productsInSelectedDomains.map((p) => p.id),
                  )
                }
              >
                {pickedProductIds.length === productsInSelectedDomains.length
                  ? '取消全选'
                  : '全选'}
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1 rounded-lg border p-2">
              {productsInSelectedDomains.map((p) => {
                const checked = pickedProductIds.includes(p.id)
                const metric = productMetricMap.get(p.id)
                return (
                  <label
                    key={p.id}
                    className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => togglePickedProduct(p.id)}
                      className="mt-0.5"
                    />
                    <span className="text-sm leading-snug flex-1 min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {getProductDomainName(p)}
                        {' · '}
                        实收 {formatCurrency(metric?.salesAmount || 0)}
                        {' · '}
                        结算 {formatCurrency(metric?.settlementIncome || 0)}
                      </span>
                    </span>
                  </label>
                )
              })}
              {productsInSelectedDomains.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  所选业务域暂无产品
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductPickOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOpen} onOpenChange={(open) => !saving && setBatchOpen(open)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>勾选产品归入业务域</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>目标业务域</Label>
              <Select
                value={batchDomain || undefined}
                onValueChange={setBatchDomain}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择已有业务域" />
                </SelectTrigger>
                <SelectContent>
                  {domainOptions.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={batchDomain}
                onChange={(e) => setBatchDomain(e.target.value)}
                placeholder="或直接输入新业务域名称"
              />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>勾选产品</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={batchOnlyUncategorized ? 'default' : 'ghost'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const next = !batchOnlyUncategorized
                      setBatchOnlyUncategorized(next)
                      if (next) {
                        setSelectedProductIds(
                          products
                            .filter((p) => getProductDomainKey(p) === UNCATEGORIZED)
                            .map((p) => p.id),
                        )
                      }
                    }}
                  >
                    <Filter className="mr-1 h-3 w-3" />
                    仅未分类
                    {uncategorizedProducts.length > 0
                      ? `（${uncategorizedProducts.length}）`
                      : ''}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={toggleBatchSelectAll}
                  >
                    {batchProductList.length > 0
                    && batchProductList.every((p) => selectedProductIds.includes(p.id))
                      ? '取消全选'
                      : '全选'}
                  </Button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border p-2">
                {batchProductList.map((p) => {
                  const checked = selectedProductIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleProduct(p.id)}
                        className="mt-0.5"
                      />
                      <span className="text-sm leading-snug flex-1 min-w-0">
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          当前：{getProductDomainName(p)}
                        </span>
                      </span>
                    </label>
                  )
                })}
                {batchProductList.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {batchOnlyUncategorized ? '暂无未分类产品' : '暂无产品'}
                  </p>
                )}
              </div>
              {selectedProductIds.length > 0 && (
                <div className="rounded-lg border bg-muted/20 p-2 text-xs space-y-1">
                  <p>已选产品数：{batchSelectedTotal.productCount}</p>
                  <p>
                    {selectedMonth} 实收汇总：
                    <span className="font-medium text-blue-700">
                      {formatCurrency(batchSelectedTotal.salesAmount)}
                    </span>
                  </p>
                  <p>
                    {selectedMonth} 结算收入汇总：
                    <span className="font-medium text-cyan-700">
                      {formatCurrency(batchSelectedTotal.settlementIncome)}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setBatchOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={handleBatchSave}>
              {saving ? '保存中…' : '确认归入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { UNCATEGORIZED, UNCATEGORIZED_LABEL }

/** 产品行上的业务域选择器 */
export function MProductDomainSelect({
  product,
  domainOptions,
  canEdit,
  onChange,
}: {
  product: Product
  domainOptions: string[]
  canEdit: boolean
  onChange: (category: string) => void
}) {
  const value = (product.category || '').trim() || UNCATEGORIZED
  if (!canEdit) {
    return (
      <span className="text-xs text-muted-foreground">
        {value === UNCATEGORIZED ? UNCATEGORIZED_LABEL : product.category}
      </span>
    )
  }
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v === UNCATEGORIZED ? '' : v)}
    >
      <SelectTrigger
        className="h-8 w-[140px]"
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder="业务域" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNCATEGORIZED}>{UNCATEGORIZED_LABEL}</SelectItem>
        {domainOptions.map((d) => (
          <SelectItem key={d} value={d}>{d}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
