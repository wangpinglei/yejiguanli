/**
 * 业绩系统单位战报：拉 API → SVG → sharp PNG → 钉钉 markdown（对齐现有战报出图方式）
 */
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const sharp = require('sharp')
const { buildYejiBattleSvg } = require('./yejiBattleReportSvg')

const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'yeji-battle')
const SENT_FILE = path.join(__dirname, '..', 'data', 'sent_yeji_battle_reports.json')

function addLog(msg) {
  console.log(`[单位战报] ${msg}`)
}

function ensureDirs() {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true })
  const dataDir = path.dirname(SENT_FILE)
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function loadSent() {
  try {
    return JSON.parse(fs.readFileSync(SENT_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveSent(obj) {
  fs.writeFileSync(SENT_FILE, JSON.stringify(obj, null, 2), 'utf-8')
}

function getDateKey(month) {
  return month || new Date().toISOString().slice(0, 7)
}

/** 与战报一致：优先 WAR_REPORT_PUBLIC_BASE_URL=http://101.132.42.171 */
function getPublicBase() {
  return (
    process.env.YEJI_BATTLE_PUBLIC_BASE ||
    process.env.WAR_REPORT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    'http://101.132.42.171'
  ).replace(/\/$/, '')
}

function getWebhookUrl() {
  return (
    process.env.YEJI_BATTLE_WEBHOOK_URL ||
    process.env.DINGTALK_WEBHOOK_URL ||
    ''
  )
}

async function sendMarkdown(title, text) {
  const url = getWebhookUrl()
  if (!url) throw new Error('未配置 YEJI_BATTLE_WEBHOOK_URL')
  const res = await axios.post(
    url,
    {
      msgtype: 'markdown',
      markdown: { title, text },
    },
    { timeout: 15000 },
  )
  if (res.data && res.data.errcode && res.data.errcode !== 0) {
    throw new Error(res.data.errmsg || JSON.stringify(res.data))
  }
  addLog(`钉钉消息已发送: ${title}`)
}

async function fetchBattleData(month) {
  const base = (process.env.YEJI_API_BASE || 'http://127.0.0.1:3001').replace(
    /\/$/,
    '',
  )
  const apiKey =
    process.env.YEJI_API_KEY ||
    process.env.BATTLE_REPORT_API_KEY ||
    'eco-sync-2026-secret'
  const url = `${base}/api/battle-report`
  const res = await axios.get(url, {
    params: { month },
    headers: { 'X-API-Key': apiKey },
    timeout: 30000,
  })
  if (!res.data || !res.data.success) {
    throw new Error((res.data && res.data.message) || '战报接口返回失败')
  }
  return res.data
}

async function renderPng(report) {
  ensureDirs()
  const svg = buildYejiBattleSvg(report)
  const dateKey = (report.yearMonth || getDateKey()).replace(/-/g, '')
  const safeUnit = String(report.salesUnitId || 'unit').replace(/[^\w-]/g, '_')
  const fileName = `yeji-battle-${safeUnit}-${report.yearMonth || getDateKey()}.png`
  const filePath = path.join(PUBLIC_DIR, fileName)
  const latestPath = path.join(PUBLIC_DIR, `yeji-battle-${safeUnit}-latest.png`)
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()
  // 与 warReport 相同：落盘到 public，供 http://101.132.42.171/... 访问
  fs.writeFileSync(filePath, pngBuffer)
  fs.writeFileSync(latestPath, pngBuffer)
  const publicBase = getPublicBase()
  const imageUrl = `${publicBase}/yeji-battle/${fileName}`
  addLog(`图片已保存: ${filePath}`)
  addLog(`公网地址: ${imageUrl}`)
  return { filePath, imageUrl, fileName, latestPath }
}

/**
 * 仅生成图片，不推送
 */
async function generatePreview(month) {
  const data = await fetchBattleData(month || getDateKey())
  const images = []
  for (const unit of data.units || []) {
    const { imageUrl, fileName } = await renderPng(unit)
    images.push({
      salesUnitId: unit.salesUnitId,
      salesUnitName: unit.salesUnitName,
      imageUrl,
      fileName,
    })
  }
  addLog(`已生成 ${images.length} 张预览图`)
  return { month: data.month, images }
}

/**
 * 推送全部单位战报图
 * @param {{ month?: string, force?: boolean, slot?: string }} options
 */
async function pushAll(options = {}) {
  const month = options.month || getDateKey()
  const force = !!options.force
  const slot = options.slot || 'manual'
  const sent = loadSent()
  const dedupeKey = `${month}:${slot}`

  if (!force && sent[dedupeKey]) {
    addLog(`今日该时段已推送过，跳过 (${dedupeKey})`)
    return { skipped: true, reason: 'already_sent', key: dedupeKey }
  }

  addLog(`正在拉取单位战报数据... month=${month} slot=${slot}`)
  const data = await fetchBattleData(month)
  const units = data.units || []
  if (!units.length) {
    addLog('无销售单位数据')
    return { skipped: true, reason: 'empty' }
  }

  const results = []
  for (const unit of units) {
    addLog(`生成图片: ${unit.salesUnitName}`)
    const { imageUrl } = await renderPng(unit)
    const title = `${unit.salesUnitName} ${month} 单位战报`
    let markdown = `### ${title}\n\n`
    markdown += `团队总业绩 **${fmtShort(unit.teamTotal)}**`
    markdown += `　团队目标 **${fmtShort(unit.effectiveTeamTarget)}**\n\n`
    markdown += `![战报](${imageUrl})`
    await sendMarkdown(title, markdown)
    results.push({ salesUnitId: unit.salesUnitId, imageUrl })
  }

  sent[dedupeKey] = {
    at: new Date().toISOString(),
    count: results.length,
  }
  saveSent(sent)
  addLog(`✅ 已推送 ${results.length} 个单位 (${dedupeKey})`)
  return { skipped: false, results, key: dedupeKey }
}

function fmtShort(n) {
  const num = Number(n) || 0
  return '¥' + num.toLocaleString('zh-CN')
}

module.exports = {
  addLog,
  generatePreview,
  pushAll,
  fetchBattleData,
}
