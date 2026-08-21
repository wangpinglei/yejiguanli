/**
 * 按销售单位折叠的结算比例列表
 * 单位 → 业务域 → 产品，比产品×单位矩阵更直观
 */
import { useMemo, useState } from 'react'
import type { Product, SalesUnit, UnitProductSettlement, ProductPersonCommission, SalesRecord } from '@/types'
import { formatCurrency } from '@/lib/format'
import { calcSaleSettlementIncome, formatSettlementPeriod } from '@/lib/settlement'
import {
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
  getProductDomainKey,
} from './m-business-domain-section'
import {
  Building2, ChevronDown, ChevronRight, Package, Pencil, Trash2, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Props = {
  units: SalesUnit[]
  products: Product[]
  upsList: UnitProductSettlement[]
  ppcList: ProductPersonCommission[]
  monthlySales: SalesRecord[]
  selectedMonth: string
  canEdit: boolean
  /** 业务域筛选；空 = 全部 */
  selectedDomainKeys: string[]
  search: string
  gapFilter: 'all' | 'noSettle' | 'noCommission'
  onEdit: (productId: string, unitId: string) => void
  onClear: (productId: string, unitId: string) => void
}

type DomainGroup = {
  key: string
  name: string
  rows: Array<{
    product: Product
    ups?: UnitProductSettlement
    income: number
    hasCommission: boolean
  }>
}

function toggleId(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export default function MUnitSettlementList({
  units,
  products,
  upsList,
  ppcList,
  monthlySales,
  selectedMonth,
  canEdit,
  selectedDomainKeys,
  search,
  gapFilter,
  onEdit,
  onClear,
}: Props) {
  const [filterUnitId, setFilterUnitId] = useState('all')
  const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(new Set())
  const [onlyShowGaps, setOnlyShowGaps] = useState(false)

  const productsFiltered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return products.filter((p) => {
      if (kw && !p.name.toLowerCase().includes(kw)
        && !(p.category || '').toLowerCase().includes(kw)) {
        return false
      }
      if (selectedDomainKeys.length > 0
        && !selectedDomainKeys.includes(getProductDomainKey(p))) {
        return false
      }
      return true
    })
  }, [products, search, selectedDomainKeys])

  const visibleUnits = useMemo(() => {
    if (filterUnitId === 'all') return units
    return units.filter((u) => u.id === filterUnitId)
  }, [units, filterUnitId])

  function findUps(productId: string, unitId: string) {
    return upsList.find((x) => x.salesUnitId === unitId && x.productId === productId)
  }

  function calcUnitIncome(productId: string, unitId: string): number {
    return monthlySales
      .filter((s) => s.productId === productId && s.salesUnitId === unitId)
      .reduce((sum, s) => sum + calcSaleSettlementIncome(s, upsList), 0)
  }

  function buildDomainGroups(unitId: string): DomainGroup[] {
    const map = new Map<string, DomainGroup>()
    for (const product of productsFiltered) {
      const ups = findUps(product.id, unitId)
      const hasCommission = ppcList.some((x) => x.productId === product.id)
      const isGapSettle = !ups
      const isGapCommission = !hasCommission

      if (gapFilter === 'noSettle' && !isGapSettle) continue
      if (gapFilter === 'noCommission' && !isGapCommission) continue
      if (onlyShowGaps && ups) continue

      const key = getProductDomainKey(product)
      const name = key === UNCATEGORIZED ? UNCATEGORIZED_LABEL : key
      let group = map.get(key)
      if (!group) {
        group = { key, name, rows: [] }
        map.set(key, group)
      }
      group.rows.push({
        product,
        ups,
        income: calcUnitIncome(product.id, unitId),
        hasCommission,
      })
    }
    return Array.from(map.values())
      .map((g) => ({
        ...g,
        rows: g.rows.sort((a, b) => a.product.name.localeCompare(b.product.name, 'zh-CN')),
      }))
      .sort((a, b) => {
        if (a.key === UNCATEGORIZED) return 1
        if (b.key === UNCATEGORIZED) return -1
        return a.name.localeCompare(b.name, 'zh-CN')
      })
  }

  function getUnitStats(unitId: string) {
    const configured = productsFiltered.filter((p) => findUps(p.id, unitId)).length
    const missing = productsFiltered.length - configured
    return { configured, missing, total: productsFiltered.length }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterUnitId} onValueChange={setFilterUnitId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="筛选单位" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部单位</SelectItem>
            {units.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={onlyShowGaps ? 'default' : 'outline'}
          className={onlyShowGaps ? '' : 'border-amber-300 text-amber-800'}
          onClick={() => setOnlyShowGaps((v) => !v)}
        >
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
          {onlyShowGaps ? '仅看缺口（开）' : '仅看缺口'}
        </Button>
        <Badge variant="secondary">{visibleUnits.length} 个单位</Badge>
        <Badge variant="outline">{productsFiltered.length} 个产品</Badge>
      </div>

      {visibleUnits.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            暂无销售单位
          </CardContent>
        </Card>
      )}

      {visibleUnits.map((unit) => {
        const expanded = expandedUnitIds.has(unit.id) || filterUnitId === unit.id
        const stats = getUnitStats(unit.id)
        const groups = expanded ? buildDomainGroups(unit.id) : []
        const rowCount = groups.reduce((n, g) => n + g.rows.length, 0)

        return (
          <Card key={unit.id}>
            <CardContent className="p-0">
              <button
                type="button"
                className="flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-muted/30"
                onClick={() => setExpandedUnitIds((prev) => toggleId(prev, unit.id))}
              >
                {expanded
                  ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                  <Building2 className="h-4 w-4 text-indigo-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{unit.name}</p>
                  <p className="text-xs text-muted-foreground">
                    已配结算 {stats.configured}/{stats.total}
                    {stats.missing > 0 && (
                      <span className="ml-2 text-amber-700">缺口 {stats.missing}</span>
                    )}
                  </p>
                </div>
                {stats.missing > 0 && (
                  <Badge variant="outline" className="border-amber-300 text-amber-800 shrink-0">
                    未设 {stats.missing}
                  </Badge>
                )}
              </button>

              {expanded && (
                <div className="space-y-4 p-4">
                  {rowCount === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      当前筛选下暂无产品
                    </p>
                  )}
                  {groups.map((group) => (
                    <div key={group.key} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-semibold">{group.name}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {group.rows.length}
                        </Badge>
                      </div>
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/40">
                              <TableHead>产品</TableHead>
                              <TableHead className="text-right">结算方式</TableHead>
                              <TableHead className="text-right">比例 / 金额</TableHead>
                              <TableHead>生效时间</TableHead>
                              <TableHead className="text-right">结算奖励</TableHead>
                              <TableHead>管理/业绩</TableHead>
                              <TableHead className="text-right">
                                {selectedMonth} 结算收入
                              </TableHead>
                              <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.rows.map(({ product, ups, income, hasCommission }) => (
                              <TableRow
                                key={product.id}
                                className={!ups ? 'bg-amber-50/50' : undefined}
                              >
                                <TableCell className="text-sm font-medium">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span>{product.name}</span>
                                    {!ups && (
                                      <Badge
                                        variant="outline"
                                        className="border-amber-300 text-amber-800 text-[10px] px-1.5 py-0"
                                      >
                                        未设结算
                                      </Badge>
                                    )}
                                    {!hasCommission && (
                                      <Badge
                                        variant="outline"
                                        className="border-violet-300 text-violet-800 text-[10px] px-1.5 py-0"
                                      >
                                        未设提成
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  {ups ? (
                                    <Badge
                                      className={
                                        ups.settlementType === 'percentage'
                                          ? 'bg-cyan-100 text-cyan-700'
                                          : 'bg-teal-100 text-teal-700'
                                      }
                                    >
                                      {ups.settlementType === 'percentage' ? '按比例' : '按件固定'}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">未配置</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium">
                                  {ups
                                    ? (ups.settlementType === 'percentage'
                                      ? `${ups.settlementRate}%`
                                      : `${formatCurrency(ups.settlementAmount || 0)}/件`)
                                    : (
                                      <span className="text-muted-foreground">默认 100%</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {ups ? formatSettlementPeriod(ups) : '-'}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {ups && (ups.rewardAmount || 0) > 0 ? (
                                    <span className="text-amber-600">
                                      +{formatCurrency(ups.rewardAmount || 0)}/件
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-1 items-start">
                                    {ups?.excludeFromTeamMgmt ? (
                                      <Badge className="bg-slate-100 text-slate-700 text-[10px]">
                                        不参与管理提成
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">管理提成·参与</span>
                                    )}
                                    {ups?.excludeFromPerformance ? (
                                      <Badge className="bg-orange-100 text-orange-800 text-[10px]">
                                        不参与业绩汇入
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">业绩汇入·参与</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium text-cyan-600">
                                  {income > 0 ? formatCurrency(income) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {canEdit ? (
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => onEdit(product.id, unit.id)}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      {ups?.id && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => onClear(product.id, unit.id)}
                                        >
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">仅查看</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
