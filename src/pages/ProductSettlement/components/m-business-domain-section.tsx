import { useMemo, useState } from 'react'
import type { Product, SalesRecord, UnitProductSettlement } from '@/types'
import { formatCurrency } from '@/lib/format'
import { calcSaleSettlementIncome } from '@/lib/settlement'
import { Tags, Plus, CheckSquare } from 'lucide-react'
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

const UNCATEGORIZED = '__uncategorized__'
const UNCATEGORIZED_LABEL = '未分类'

type DomainSummary = {
  key: string
  name: string
  productCount: number
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
  onUpdateCategory: (productId: string, category: string) => Promise<void>
}

export default function MBusinessDomainSection({
  products,
  monthlySales,
  upsList,
  selectedMonth,
  canEdit,
  domainOptions,
  onAddDomain,
  onUpdateCategory,
}: Props) {
  const [newDomain, setNewDomain] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchDomain, setBatchDomain] = useState('')
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

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
      const name = (p.category || '').trim() || UNCATEGORIZED_LABEL
      const key = (p.category || '').trim() || UNCATEGORIZED
      ensure(key, name).productCount += 1
    })

    monthlySales.forEach((s) => {
      const product = products.find((p) => p.id === s.productId)
      if (!product) return
      const name = (product.category || '').trim() || UNCATEGORIZED_LABEL
      const key = (product.category || '').trim() || UNCATEGORIZED
      const row = ensure(key, name)
      row.salesAmount += s.totalAmount || 0
      row.settlementIncome += calcSaleSettlementIncome(s, upsList)
    })

    return Array.from(map.values()).sort((a, b) => {
      if (a.key === UNCATEGORIZED) return 1
      if (b.key === UNCATEGORIZED) return -1
      return b.settlementIncome - a.settlementIncome
    })
  }, [products, monthlySales, upsList])

  function handleAddDomain() {
    const name = newDomain.trim()
    if (!name) return
    onAddDomain?.(name)
    setNewDomain('')
  }

  function openBatchAssign() {
    setBatchDomain(domainOptions[0] || '')
    setSelectedProductIds([])
    setBatchOpen(true)
  }

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) =>
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
            手动为产品设置业务域；下方按业务域汇总 {selectedMonth} 实收与结算收入
          </p>
        </div>
        {canEdit && products.length > 0 && (
          <Button variant="outline" size="sm" onClick={openBatchAssign}>
            <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
            勾选产品归入业务域
          </Button>
        )}
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
          <Button type="button" variant="secondary" onClick={handleAddDomain}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加
          </Button>
          {domainOptions.length > 0 && (
            <div className="w-full flex flex-wrap gap-1.5 pt-1">
              {domainOptions.map((d) => (
                <Badge key={d} variant="secondary" className="bg-teal-50 text-teal-800">
                  {d}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>业务域</TableHead>
                <TableHead className="text-right">产品数</TableHead>
                <TableHead className="text-right">{selectedMonth} 实收</TableHead>
                <TableHead className="text-right">{selectedMonth} 结算收入</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((row) => (
                <TableRow key={row.key}>
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
              ))}
              {summaries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                    暂无产品，导入销售记录后可在此分类并查看汇总
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
              <div className="flex items-center justify-between">
                <Label>勾选产品</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setSelectedProductIds(
                      selectedProductIds.length === products.length
                        ? []
                        : products.map((p) => p.id),
                    )
                  }
                >
                  {selectedProductIds.length === products.length ? '取消全选' : '全选'}
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border p-2">
                {products.map((p) => {
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
                          当前：{(p.category || '').trim() || UNCATEGORIZED_LABEL}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                已选 {selectedProductIds.length} 个产品
              </p>
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
