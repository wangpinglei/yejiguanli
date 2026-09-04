import { useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import type { Product } from '@/types'
import {
  formatProductMergeStats,
  getSimilarGroupIgnoreKey,
  groupSimilarProducts,
  pickKeepProduct,
  saveIgnoredSimilarGroupKeys,
  type SimilarProductGroup,
} from '@/lib/productMerge'
import { Layers, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
  ignoredKeys: string[]
  onIgnoredKeysChange: (keys: string[]) => void
}

function ProductMergeMeta({
  product,
  saleCount,
  settleCount,
  ppcCount,
}: {
  product: Product
  saleCount: number
  settleCount: number
  ppcCount: number
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="font-medium break-words">{product.name}</p>
      <p className="text-xs text-muted-foreground">
        {product.category || '未分类'}
        {' · '}
        销售 {saleCount} 笔
        {' · '}
        结算 {settleCount}
        {' · '}
        提成 {ppcCount}
      </p>
      {(product.aliases || []).length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          别名：{(product.aliases || []).join('、')}
        </p>
      )}
    </div>
  )
}

export default function MProductMergeDialog({
  open,
  onOpenChange,
  canEdit,
  ignoredKeys,
  onIgnoredKeysChange,
}: Props) {
  const {
    products,
    allSalesRecords: salesRecords,
    unitProductSettlements: upsList,
    productPersonCommissions: ppcList,
    mergeProducts,
    updateProduct,
  } = useData()

  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({})
  const [manualKeepId, setManualKeepId] = useState('')
  const [manualRemoveId, setManualRemoveId] = useState('')
  const [mergingKey, setMergingKey] = useState('')
  const [editingProductId, setEditingProductId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const groups = useMemo(
    () => groupSimilarProducts(products, ignoredKeys),
    [products, ignoredKeys],
  )

  const saleCountById = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of salesRecords) {
      if (!s.productId) continue
      map.set(s.productId, (map.get(s.productId) || 0) + 1)
    }
    return map
  }, [salesRecords])

  const settleCountById = useMemo(() => {
    const map = new Map<string, number>()
    for (const x of upsList) {
      map.set(x.productId, (map.get(x.productId) || 0) + 1)
    }
    return map
  }, [upsList])

  const ppcCountById = useMemo(() => {
    const map = new Map<string, number>()
    for (const x of ppcList) {
      map.set(x.productId, (map.get(x.productId) || 0) + 1)
    }
    return map
  }, [ppcList])

  function getKeepId(group: SimilarProductGroup): string {
    if (keepByGroup[group.key]) return keepByGroup[group.key]
    return pickKeepProduct(
      group.products,
      upsList,
      ppcList,
      salesRecords,
    ).id
  }

  async function handleMerge(keepId: string, removeIds: string[], key: string) {
    const ids = removeIds.filter((id) => id && id !== keepId)
    if (!keepId || ids.length === 0) return
    const keep = products.find((p) => p.id === keepId)
    const names = ids
      .map((id) => products.find((p) => p.id === id)?.name || id)
      .join('、')
    if (!confirm(
      `确认将「${names}」合并到「${keep?.name || keepId}」？\n`
      + '销售记录会改挂主产品；主产品没有的结算/提成会沿用被合并项。'
      + '此操作不可撤销。',
    )) return
    setMergingKey(key)
    try {
      const result = await mergeProducts(keepId, ids)
      alert(`${result.message}\n${formatProductMergeStats(result.stats)}`)
      setManualKeepId('')
      setManualRemoveId('')
    } catch (error: any) {
      alert('合并失败: ' + (error.message || '未知错误'))
    } finally {
      setMergingKey('')
    }
  }

  function handleIgnoreGroup(group: SimilarProductGroup) {
    const ignoreKey = getSimilarGroupIgnoreKey(group.products)
    if (!confirm(
      '确认这组不是同一产品？之后不再提示为疑似相同。需要合并时仍可在下方手动选择。',
    )) return
    const next = ignoredKeys.includes(ignoreKey)
      ? ignoredKeys
      : [...ignoredKeys, ignoreKey]
    onIgnoredKeysChange(next)
    saveIgnoredSimilarGroupKeys(next)
  }

  function startRename(product: Product) {
    setEditingProductId(product.id)
    setEditingName(product.name)
  }

  async function handleRenameSave() {
    const name = editingName.trim()
    if (!editingProductId || !name) return
    const current = products.find((p) => p.id === editingProductId)
    if (current && current.name === name) {
      setEditingProductId('')
      return
    }
    setRenaming(true)
    try {
      await updateProduct(editingProductId, { name })
      setEditingProductId('')
    } catch (error: any) {
      alert('改名失败: ' + (error.message || '未知错误'))
    } finally {
      setRenaming(false)
    }
  }

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'zh-CN'),
    ),
    [products],
  )

  const busy = mergingKey !== '' || renaming

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-[min(96vw,56rem)] flex-col overflow-hidden
          max-w-[min(96vw,56rem)] sm:max-w-[min(96vw,56rem)]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-amber-700" />
            合并相同产品
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <p className="text-sm text-muted-foreground">
            去掉「柜柜软件」等前缀后名称相同的，会提示为一组。
            不同业务域不会自动成组。请确认是同一产品后再合并；
            不是同一产品可点「不是同一产品」取消提示，也可改产品名称。
          </p>

          {groups.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center
              text-sm text-muted-foreground">
              暂未发现名称高度相似的产品。仍可在下方手动选择合并。
            </div>
          ) : (
            groups.map((group) => {
              const keepId = getKeepId(group)
              return (
                <div
                  key={group.key}
                  className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge className="bg-amber-100 text-amber-800">
                      {group.products.length} 条疑似相同
                    </Badge>
                    <div className="flex flex-wrap gap-2">
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleIgnoreGroup(group)}
                        >
                          不是同一产品
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => handleMerge(
                            keepId,
                            group.products.map((p) => p.id),
                            group.key,
                          )}
                        >
                          {mergingKey === group.key ? '合并中…' : '合并本组'}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {group.products.map((product) => (
                      <div
                        key={product.id}
                        className="flex items-start gap-2 rounded-md border bg-background px-2 py-2"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            className="mt-1"
                            name={`keep-${group.key}`}
                            checked={keepId === product.id}
                            disabled={!canEdit || busy}
                            onChange={() => setKeepByGroup((prev) => ({
                              ...prev,
                              [group.key]: product.id,
                            }))}
                          />
                          {editingProductId === product.id ? (
                            <div className="min-w-0 flex-1 space-y-1">
                              <Input
                                value={editingName}
                                autoFocus
                                disabled={renaming}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void handleRenameSave()
                                  }
                                  if (e.key === 'Escape') setEditingProductId('')
                                }}
                              />
                              <p className="text-xs text-muted-foreground">
                                {product.category || '未分类'}
                              </p>
                            </div>
                          ) : (
                            <ProductMergeMeta
                              product={product}
                              saleCount={saleCountById.get(product.id) || 0}
                              settleCount={settleCountById.get(product.id) || 0}
                              ppcCount={ppcCountById.get(product.id) || 0}
                            />
                          )}
                        </label>
                        {keepId === product.id && editingProductId !== product.id && (
                          <Badge variant="secondary" className="shrink-0">
                            主产品
                          </Badge>
                        )}
                        {canEdit && (
                          editingProductId === product.id ? (
                            <div className="flex shrink-0 gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2"
                                disabled={renaming || !editingName.trim()}
                                onClick={() => void handleRenameSave()}
                              >
                                保存
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                disabled={renaming}
                                onClick={() => setEditingProductId('')}
                              >
                                取消
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0 px-2"
                              disabled={busy}
                              title="改产品名称"
                              onClick={() => startRename(product)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">手动选择合并</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={manualKeepId || undefined}
                onValueChange={setManualKeepId}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择主产品（保留）" />
                </SelectTrigger>
                <SelectContent>
                  {sortedProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={manualRemoveId || undefined}
                onValueChange={setManualRemoveId}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择并入产品（删除）" />
                </SelectTrigger>
                <SelectContent>
                  {sortedProducts
                    .filter((p) => p.id !== manualKeepId)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                disabled={!manualKeepId || !manualRemoveId || busy}
                onClick={() => handleMerge(
                  manualKeepId,
                  [manualRemoveId],
                  'manual',
                )}
              >
                {mergingKey === 'manual' ? '合并中…' : '确认合并'}
              </Button>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
