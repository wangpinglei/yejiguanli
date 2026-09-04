import type {
  Product,
  ProductPersonCommission,
  SalesRecord,
  UnitProductSettlement,
} from '@/types'

const NAME_PREFIXES = [
  '柜柜软件',
  '云排版',
  '外购产品',
  '老板良软件',
  '小渲风',
  '手画cad',
] as const

/** 去掉空格、括号和常见业务域前缀，便于判断是否同一产品 */
export function normalizeProductName(name: string): string {
  let s = String(name || '').trim().toLowerCase()
  s = s.replace(/[\s\u3000\-_/|｜]+/g, '')
  s = s.replace(/[（）()【】「」《》,，.。\[\]]+/g, '')
  for (const prefix of NAME_PREFIXES) {
    const compact = prefix.toLowerCase().replace(/[\s\-_/]+/g, '')
    if (s.startsWith(compact) && s.length > compact.length) {
      s = s.slice(compact.length)
      break
    }
  }
  return s
}

export type SimilarProductGroup = {
  key: string
  products: Product[]
}

export function groupSimilarProducts(products: Product[]): SimilarProductGroup[] {
  const buckets = new Map<string, Product[]>()
  for (const product of products) {
    const key = normalizeProductName(product.name)
    if (!key) continue
    const list = buckets.get(key) || []
    list.push(product)
    buckets.set(key, list)
  }
  return Array.from(buckets.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      key,
      products: [...list].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'zh-CN'),
      ),
    }))
    .sort((a, b) => b.products.length - a.products.length)
}

export function scoreProductAsKeep(
  product: Product,
  upsList: UnitProductSettlement[],
  ppcList: ProductPersonCommission[],
  salesRecords: SalesRecord[],
): number {
  const settleN = upsList.filter((x) => x.productId === product.id).length
  const ppcN = ppcList.filter((x) => x.productId === product.id).length
  const saleN = salesRecords.filter((x) => x.productId === product.id).length
  return settleN * 10000 + ppcN * 100 + saleN
}

export function pickKeepProduct(
  group: Product[],
  upsList: UnitProductSettlement[],
  ppcList: ProductPersonCommission[],
  salesRecords: SalesRecord[],
): Product {
  const ranked = [...group].sort((a, b) => {
    const diff = scoreProductAsKeep(b, upsList, ppcList, salesRecords)
      - scoreProductAsKeep(a, upsList, ppcList, salesRecords)
    if (diff !== 0) return diff
    return (b.name || '').length - (a.name || '').length
  })
  return ranked[0]
}

export type ProductMergeStats = {
  sales: number
  settlementsMoved: number
  settlementsDropped: number
  commissionsMoved: number
  commissionsDropped: number
  aliasesAdded: number
  fieldsFilled: string[]
  mergedCount: number
}

export function formatProductMergeStats(stats: ProductMergeStats): string {
  const parts = [
    `迁销售 ${stats.sales} 笔`,
    `沿用结算 ${stats.settlementsMoved} 条`,
    stats.settlementsDropped > 0
      ? `结算冲突保留主产品 ${stats.settlementsDropped} 条`
      : '',
    `沿用提成 ${stats.commissionsMoved} 条`,
    stats.commissionsDropped > 0
      ? `提成冲突保留主产品 ${stats.commissionsDropped} 条`
      : '',
    `别名 +${stats.aliasesAdded}`,
  ].filter(Boolean)
  if (stats.fieldsFilled.length > 0) {
    parts.push(`补全 ${stats.fieldsFilled.join('、')}`)
  }
  return parts.join('；')
}
