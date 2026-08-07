/**
 * 业绩系统单位战报：拉 API → SVG → sharp PNG → 钉钉 markdown（对齐现有战报出图方式）
 */
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const sharp = require('sharp')
const { buildYejiBattleSvg } = require('./yejiBattleReportSvg')

const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'war-reports')
const SENT_FILE = path.join(__dirname, '..', 'data', 'sent_yeji_battle_reports.json')
/** 与现有钉钉战报同一 URL 前缀，走同一域名反代 */
const PUBLIC_PATH_PREFIX = '/war-reports'

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

/** 与战报一致：优先 WAR_REPORT_PUBLIC_BASE_URL（域名反代地址） */
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

/** 只推指定单位，默认：海南运营中心 */
function getTargetUnitName() {
  return (process.env.YEJI_BATTLE_UNIT_NAME || '海南运营中心').trim()
}

function filterTargetUnits(units) {
  const name = getTargetUnitName()
  const id = (process.env.YEJI_BATTLE_UNIT_ID || '').trim()
  const list = Array.isArray(units) ? units : []
  const matched = list.filter((u) => {
    if (id && String(u.salesUnitId) === id) return true
    if (name && String(u.salesUnitName || '').trim() === name) return true
    return false
  })
  if (!matched.length) {
    addLog(
      `未找到目标单位「${name || id}」，当前单位: ${
        list.map((u) => u.salesUnitName).join('、') || '(空)'
      }`,
    )
  }
  return matched
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
  const base = (process.env.YEJI_API_BASE || 'http://127.0.0.1:8100').replace(
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
  // 落盘到 public/war-reports，与钉钉战报同一反代路径
  fs.writeFileSync(filePath, pngBuffer)
  fs.writeFileSync(latestPath, pngBuffer)
  const publicBase = getPublicBase()
  const imageUrl = `${publicBase}${PUBLIC_PATH_PREFIX}/${fileName}`
  addLog(`图片已保存: ${filePath}`)
  addLog(`公网地址: ${imageUrl}`)
  return { filePath, imageUrl, fileName, latestPath }
}

/**
 * 仅生成图片，不推送
 */
async function generatePreview(month) {
  const data = await fetchBattleData(month || getDateKey())
  const units = filterTargetUnits(data.units || [])
  const images = []
  for (const unit of units) {
    const { imageUrl, fileName } = await renderPng(unit)
    images.push({
      salesUnitId: unit.salesUnitId,
      salesUnitName: unit.salesUnitName,
      imageUrl,
      fileName,
    })
  }
  addLog(`已生成 ${images.length} 张预览图（仅 ${getTargetUnitName()}）`)
  return { month: data.month, images, targetUnit: getTargetUnitName() }
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

  addLog(
    `正在拉取单位战报... month=${month} slot=${slot} 目标=${getTargetUnitName()}`,
  )
  const data = await fetchBattleData(month)
  const units = filterTargetUnits(data.units || [])
  if (!units.length) {
    addLog('无匹配的目标单位，跳过推送')
    return {
      skipped: true,
      reason: 'unit_not_found',
      targetUnit: getTargetUnitName(),
    }
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
    results.push({
      salesUnitId: unit.salesUnitId,
      salesUnitName: unit.salesUnitName,
      imageUrl,
    })
  }

  sent[dedupeKey] = {
    at: new Date().toISOString(),
    count: results.length,
    targetUnit: getTargetUnitName(),
  }
  saveSent(sent)
  addLog(`✅ 已推送 ${results.length} 张（${getTargetUnitName()}）(${dedupeKey})`)
  return {
    skipped: false,
    results,
    key: dedupeKey,
    targetUnit: getTargetUnitName(),
  }
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
