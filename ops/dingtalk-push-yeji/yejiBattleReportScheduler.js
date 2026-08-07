/**
 * 单位战报定时：默认每天 8:00、17:00（Asia/Shanghai）
 */
const yejiBattleReport = require('./yejiBattleReport')

const DEFAULT_CRON_LIST = ['0 8 * * *', '0 17 * * *']

let cronTasks = []

function parseCronList(raw) {
  if (!raw) return DEFAULT_CRON_LIST
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseSlotList(raw, len) {
  const defaults = ['morning', 'evening']
  if (!raw) return defaults.slice(0, len)
  const list = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  while (list.length < len) list.push(`slot${list.length + 1}`)
  return list.slice(0, len)
}

function start() {
  if (process.env.YEJI_BATTLE_ENABLED === '0') {
    yejiBattleReport.addLog('单位战报定时已禁用 (YEJI_BATTLE_ENABLED=0)')
    return false
  }

  let cron
  try {
    cron = require('node-cron')
  } catch {
    yejiBattleReport.addLog('未安装 node-cron，单位战报定时未启动')
    return false
  }

  const timezone = process.env.YEJI_BATTLE_TZ || 'Asia/Shanghai'
  const exprList = parseCronList(process.env.YEJI_BATTLE_CRON)
  const slotList = parseSlotList(process.env.YEJI_BATTLE_CRON_SLOTS, exprList.length)

  exprList.forEach((expr, i) => {
    if (!cron.validate(expr)) {
      yejiBattleReport.addLog(`单位战报 cron 无效: ${expr}`)
      return
    }
    const slot = slotList[i] || `slot${i + 1}`
    const task = cron.schedule(
      expr,
      () => {
        yejiBattleReport
          .pushAll({ slot })
          .catch((err) => yejiBattleReport.addLog(`定时推送失败: ${err.message}`))
      },
      { timezone },
    )
    cronTasks.push(task)
  })

  if (!cronTasks.length) return false
  const desc = exprList.map((e, i) => `${e}(${slotList[i]})`).join(' | ')
  yejiBattleReport.addLog(`单位战报定时已启动: ${desc} (${timezone})`)
  return true
}

function stop() {
  cronTasks.forEach((task) => task.stop())
  cronTasks = []
  yejiBattleReport.addLog('单位战报定时已停止')
}

module.exports = { start, stop }
