/**
 * 核对财务通知 webhook 配置与 sales_units 名称是否一致
 * 用法: node ops/verify-finance-notice-webhooks.mjs
 * 可选: DB_PATH=server/data/pm.db node ops/verify-finance-notice-webhooks.mjs
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'data', 'pm.db')

const targets = [
  '南平分仓',
  '无锡运营中心',
  '武汉分仓',
  '哈尔滨分仓',
  '南京运营中心',
  '四合院资源项目组',
  '武汉运营中心',
  '深圳运营中心',
  '龙鳞文创',
  '宣城分仓',
  '青岛分仓',
  '济南分仓',
  '盐城分仓',
  '宿迁分仓',
  '镇江分仓',
  '兰山分仓',
  '泉州分仓',
  '新都分仓',
  '金牛分仓',
  '宜宾分仓',
  '宜宾叙州分仓',
  '天府分仓',
  '绵阳分仓',
  '西安分仓',
  '石家庄代理',
  '成都分仓',
  '成都运营中心',
  '乌鲁木齐运营中心',
  '贵阳分仓',
  '昆明分仓',
  '佛山运营中心',
  '抚州运营中心',
  '海南运营中心',
  '郑州分仓',
  '武昌分仓',
  '长沙分仓',
  '九龙坡分仓',
  '南阳分仓',
  '茂名分仓',
  '潍坊分仓',
  '宜宾运营中心',
  '太原服务站',
  '组织部业务通知对接群',
]

const db = new Database(dbPath, { readonly: true })
const units = db.prepare('SELECT name FROM sales_units ORDER BY name').all().map((r) => r.name)
const unitSet = new Set(units)
const targetSet = new Set(targets)

const matched = targets.filter((n) => unitSet.has(n))
const onlyTargets = targets.filter((n) => !unitSet.has(n))
const onlyUnits = units.filter((n) => !targetSet.has(n))

console.log(`配置群数: ${targets.length}`)
console.log(`系统销售单位数: ${units.length}`)
console.log(`名称完全匹配: ${matched.length}`)
console.log('')
if (onlyTargets.length) {
  console.log('【配置有、销售单位无】（多为对接群，可忽略）:')
  onlyTargets.forEach((n) => console.log(`  - ${n}`))
}
if (onlyUnits.length) {
  console.log('【销售单位有、配置无 webhook】:')
  onlyUnits.forEach((n) => console.log(`  - ${n}`))
}
if (!onlyTargets.length && !onlyUnits.length) {
  console.log('全部销售单位均已配置财务通知 webhook。')
}
