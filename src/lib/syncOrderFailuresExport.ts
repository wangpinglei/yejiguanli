import * as XLSX from 'xlsx'
import { syncOrdersApi } from '@/lib/api'
import type { SyncOrderFailure } from '@/types'

const CODE_LABEL: Record<string, string> = {
  invalid_fields: '字段无法识别',
  missing_required: '缺少必填',
  deleted_blocklist: '已删黑名单',
  db_error: '写入异常',
  upstream_error: '上游异常',
}

const SOURCE_LABEL: Record<string, string> = {
  push: '生态圈推送',
  pull: '主动拉取',
}

const FETCH_PAGE = 200
export const SYNC_FAILURE_EXPORT_MAX = 5000

export async function fetchSyncOrderFailuresForExport(
  maxRows = SYNC_FAILURE_EXPORT_MAX,
): Promise<{ rows: SyncOrderFailure[]; truncated: boolean; total: number }> {
  const rows: SyncOrderFailure[] = []
  let offset = 0
  let total = 0
  while (rows.length < maxRows) {
    const res = await syncOrdersApi.listFailures({
      limit: Math.min(FETCH_PAGE, maxRows - rows.length),
      offset,
    })
    total = res.total ?? 0
    const batch = res.items || []
    if (batch.length === 0) break
    rows.push(...batch)
    offset += batch.length
    if (rows.length >= total) break
  }
  const truncated = total > rows.length
  return { rows, truncated, total }
}

export function downloadSyncOrderFailuresExcel(rows: SyncOrderFailure[]): void {
  const headers = [
    '记录时间',
    '失败类型',
    '来源',
    '失败原因',
    '生态圈订单号',
    '客户姓名',
    '购买产品',
    '销售单位',
    '销售人员',
    '成交日期',
    '原始payload',
  ]
  const data = rows.map((r) => [
    r.createdAt?.replace('T', ' ').slice(0, 19) || '',
    CODE_LABEL[r.failureCode] || r.failureCode || '',
    SOURCE_LABEL[r.source] || r.source || '',
    r.reason || '',
    r.externalOrderId || '',
    r.customerName || '',
    r.productName || '',
    r.salesUnitName || '',
    r.salesPersonName || '',
    r.saleDate || '',
    r.payloadJson || '',
  ])
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
  ws['!cols'] = [
    { wch: 20 },
    { wch: 12 },
    { wch: 10 },
    { wch: 36 },
    { wch: 22 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 40 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '推送失败')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `生态圈推送失败记录_${stamp}.xlsx`)
}