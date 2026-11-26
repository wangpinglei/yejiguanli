/**
 * 按单位名测试财务通知 webhook（从内置配置表读取）
 * 用法: node ops/test-webhook-by-name.mjs 四合院
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const unitArg = process.argv[2]?.trim()
if (!unitArg) {
  console.error('用法: node ops/test-webhook-by-name.mjs <单位名>')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cfgPath = path.join(__dirname, '..', 'server', 'src', 'config', 'financeNoticeWebhookTargets.ts')
const cfg = readFileSync(cfgPath, 'utf8')
const blockRe = new RegExp(
  `unitName:\\s*"${unitArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?webhook:\\s*\\n\\s*"([^"]+)"`,
)
const m = cfg.match(blockRe)
if (!m) {
  console.error(`未在 financeNoticeWebhookTargets.ts 中找到单位: ${unitArg}`)
  process.exit(1)
}

const webhook = m[1]
const title = '财务通知连通性测试'
const text = [
  '### 财务通知连通性测试',
  '',
  `单位：**${unitArg}**`,
  '',
  '这是一条测试消息，用于确认该群机器人已接入业绩系统财务通知。',
  '',
  `时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
].join('\n')

const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text } }),
})
const raw = await res.text()
let data = {}
try {
  data = JSON.parse(raw)
} catch {
  /* ignore */
}
console.log('单位:', unitArg)
console.log('HTTP', res.status)
console.log(raw)
if (!res.ok) process.exit(1)
if (data.errcode && data.errcode !== 0) process.exit(1)
console.log('OK')