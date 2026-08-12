/**
 * 业绩系统单位战报：拉 API → SVG → sharp PNG → 钉钉 markdown（对齐现有战报出图方式）
 * 支持多单位分别推到不同 webhook（YEJI_BATTLE_TARGETS）
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

const HAINAN_WEBHOOK =
  'https://oapi.dingtalk.com/robot/send?access_token=d64d7d63b39a6c65988de2deec51885d6680aa0df0afbf8f13e463528148587c'
const SHENZHEN_WEBHOOK =
  'https://oapi.dingtalk.com/robot/send?access_token=9a3807029645a88017d8c367b5813a816fbc475ecd5a5fb9db2c6924d87fcf27'
const FUZHOU_WEBHOOK =
  'https://oapi.dingtalk.com/robot/send?access_token=44060aaa07294373e9fcc93333c43c2d6e9c86a3e20a1482a11284b851289dc4'
const FOSHAN_WEBHOOK =
  'https://oapi.dingtalk.com/robot/send?access_token=d32c7adc8fcf5e7eb9aa58195c6d8c2e4dc757c18643d4f75975bc8e54d15d9e'
const WUXI_WEBHOOK =
  'https://oapi.dingtalk.com/robot/send?access_token=13871d8e98a307657126cdc4974c8fedcad0b6d0dbb39a0a3af9c2cceae3bc23'

/** 默认：海南 / 深圳 / 抚州 / 佛山 / 无锡 → 各自群机器人 */
const DEFAULT_TARGETS = [
  { unitName: '海南运营中心', webhook: HAINAN_WEBHOOK },
  { unitName: '深圳运营中心', webhook: SHENZHEN_WEBHOOK },
  { unitName: '抚州运营中心', webhook: FUZHOU_WEBHOOK },
  { unitName: '佛山运营中心', webhook: FOSHAN_WEBHOOK },
  { unitName: '无锡运营中心', webhook: WUXI_WEBHOOK },
]

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

/** 去重用日历日（上海时区），避免整月只推一次 */
function getDedupeDayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.YEJI_BATTLE_TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** 与战报一致：优先 WAR_REPORT_PUBLIC_BASE_URL（域名反代地址） */
function getPublicBase() {
  return (
    process.env.YEJI_BATTLE_PUBLIC_BASE ||
    process.env.WAR_REPORT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    'https://isales.santi.ren'
  ).replace(/\/$/, '')
}

/**
 * 解析推送目标
 * YEJI_BATTLE_TARGETS 格式：单位名|webhook,单位名|webhook
 * 未配置时用 DEFAULT_TARGETS（海南/深圳/抚州/佛山/无锡）
 */
function getPushTargets() {
  const raw = (process.env.YEJI_BATTLE_TARGETS || '').trim()
  if (!raw) return DEFAULT_TARGETS

  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const idx = item.indexOf('|')
      if (idx < 0) return null
      const unitName = item.slice(0, idx).trim()
      const webhook = item.slice(idx + 1).trim()
      if (!unitName || !webhook) return null
      return { unitName, webhook }
    })
    .filter(Boolean)

  return list.length ? list : DEFAULT_TARGETS
}

function matchUnit(units, unitName) {
  const name = String(unitName || '').trim()
  return (units || []).find((u) => String(u.salesUnitName || '').trim() === name)
}

async function sendMarkdown(webhook, title, text) {
  if (!webhook) throw new Error('未配置 webhook')
  const res = await axios.post(
    webhook,
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
  const safeUnit = String(report.salesUnitId || 'unit').replace(/[^\w-]/g, '_')
  const fileName = `yeji-battle-${safeUnit}-${report.yearMonth || getDateKey()}.png`
  const filePath = path.join(PUBLIC_DIR, fileName)
  const latestPath = path.join(PUBLIC_DIR, `yeji-battle-${safeUnit}-latest.png`)
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()
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
  const targets = getPushTargets()
  const images = []
  for (const t of targets) {
    const unit = matchUnit(data.units, t.unitName)
    if (!unit) {
      addLog(`预览跳过：未找到单位「${t.unitName}」`)
      continue
    }
    const { imageUrl, fileName } = await renderPng(unit)
    images.push({
      salesUnitId: unit.salesUnitId,
      salesUnitName: unit.salesUnitName,
      imageUrl,
      fileName,
    })
  }
  addLog(`已生成 ${images.length} 张预览图`)
  return {
    month: data.month,
    images,
    targets: targets.map((t) => t.unitName),
  }
}

/**
 * 按目标列表逐个单位出图并推到对应 webhook
 * @param {{ month?: string, force?: boolean, slot?: string }} options
 */
async function pushAll(options = {}) {
  const month = options.month || getDateKey()
  const force = !!options.force
  const slot = options.slot || 'manual'
  const sent = loadSent()
  // 按「日+时段」去重（旧版误用 month:slot，导致整月只推一次）
  const dedupeKey = `${getDedupeDayKey()}:${slot}`
  const legacyMonthKey = `${month}:${slot}`

  if (!force && sent[dedupeKey]) {
    addLog(`今日该时段已推送过，跳过 (${dedupeKey})`)
    return { skipped: true, reason: 'already_sent', key: dedupeKey }
  }

  const targets = getPushTargets()
  addLog(
    `正在拉取单位战报... month=${month} slot=${slot} 目标=${targets
      .map((t) => t.unitName)
      .join('、')}`,
  )
  const data = await fetchBattleData(month)
  const allUnits = data.units || []

  const results = []
  const errors = []
  for (const t of targets) {
    const unit = matchUnit(allUnits, t.unitName)
    if (!unit) {
      const msg = `未找到单位「${t.unitName}」`
      addLog(msg)
      errors.push({ unitName: t.unitName, error: msg })
      continue
    }
    try {
      addLog(`生成图片: ${unit.salesUnitName}`)
      const { imageUrl } = await renderPng(unit)
      const title = `${unit.salesUnitName} ${month} 单位战报`
      let markdown = `### ${title}\n\n`
      markdown += `团队总业绩 **${fmtShort(unit.teamTotal)}**`
      markdown += `　团队目标 **${fmtShort(unit.effectiveTeamTarget)}**\n\n`
      markdown += `![战报](${imageUrl})`
      await sendMarkdown(t.webhook, title, markdown)
      results.push({
        salesUnitId: unit.salesUnitId,
        salesUnitName: unit.salesUnitName,
        imageUrl,
      })
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      addLog(`推送失败「${t.unitName}」: ${msg}`)
      errors.push({ unitName: t.unitName, error: msg })
    }
  }

  if (!results.length) {
    return {
      skipped: true,
      reason: 'all_failed_or_empty',
      errors,
      targets: targets.map((t) => t.unitName),
    }
  }

  sent[dedupeKey] = {
    at: new Date().toISOString(),
    count: results.length,
    units: results.map((r) => r.salesUnitName),
  }
  // 清掉旧的「整月」去重键，避免继续挡住后续日期
  if (sent[legacyMonthKey]) delete sent[legacyMonthKey]
  saveSent(sent)
  addLog(`✅ 已推送 ${results.length} 张 (${dedupeKey})`)
  return {
    skipped: false,
    results,
    errors,
    key: dedupeKey,
    targets: targets.map((t) => t.unitName),
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
  getPushTargets,
}
