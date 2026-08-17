/**
 * 核对「单位全量销售」与「战报个人行」差额：列出未进入战报行的销售记录
 *
 * 用法（在服务器）：
 *   cd /root/yejiguanli/server
 *   node ../ops/diagnose-battle-gap.mjs 无锡运营中心 2026-08
 *
 * 可选第 3 个参数：数据库路径，默认 ./data/database.db
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const unitNameArg = process.argv[2] || '无锡运营中心'
const yearMonth = process.argv[3] || '2026-08'
const dbPath =
  process.argv[4] ||
  path.join(__dirname, '..', 'server', 'data', 'database.db')

const db = new DatabaseSync(dbPath)

const unit = db
  .prepare('SELECT id, name FROM sales_units WHERE name = ? COLLATE NOCASE')
  .get(unitNameArg)

if (!unit) {
  const like = db
    .prepare('SELECT id, name FROM sales_units WHERE name LIKE ?')
    .all(`%${unitNameArg}%`)
  console.error('未找到销售单位:', unitNameArg)
  console.error('近似匹配:', like)
  process.exit(1)
}

const sales = db
  .prepare(
    `SELECT id, sale_date, total_amount, personnel_id, sales_person_name,
            order_number, external_order_id, customer_name, product_name
     FROM sales_records
     WHERE sales_unit_id = ? AND sale_date LIKE ?
     ORDER BY total_amount DESC`,
  )
  .all(unit.id, `${yearMonth}%`)

const people = db.prepare('SELECT id, name, sales_unit_id, position, status FROM personnel').all()
const personById = new Map(people.map((p) => [p.id, p]))
const unitNameById = new Map(
  db.prepare('SELECT id, name FROM sales_units').all().map((u) => [u.id, u.name]),
)

const teamTotal = sales.reduce((s, r) => s + (Number(r.total_amount) || 0), 0)

/** 与战报 getPersonalSales 相同：有 personnelId 只用 id；无 id 才用姓名 */
function attributedToPerson(record, person) {
  if (record.personnel_id && String(record.personnel_id).trim()) {
    return record.personnel_id === person.id
  }
  const name = (person.name || '').trim()
  return !!name && (record.sales_person_name || '').trim() === name
}

/** 粗略：挂在本单位、或当月该单位有业绩的人（便于对照） */
function isLikelyOnRoster(person) {
  if (person.sales_unit_id === unit.id) return true
  return sales.some((r) => attributedToPerson(r, person))
}

const rosterPeople = people.filter(isLikelyOnRoster)

const gaps = []
for (const r of sales) {
  const hit = rosterPeople.some((p) => attributedToPerson(r, p))
  if (hit) continue

  const pid = (r.personnel_id || '').trim()
  const pname = (r.sales_person_name || '').trim()
  const linked = pid ? personById.get(pid) : null

  let reason = ''
  if (!pid && !pname) {
    reason = '无人员ID且无销售员姓名'
  } else if (pid && !linked) {
    reason = `人员ID不存在于人事表: ${pid}`
  } else if (pid && linked) {
    const linkedUnit = unitNameById.get(linked.sales_unit_id) || linked.sales_unit_id
    reason =
      `有人员ID但该人未进入本单位战报归集（当前挂靠单位=${linkedUnit}，` +
      `岗位=${linked.position || '-'}，状态=${linked.status}，姓名=${linked.name}）` +
      `；页面上的「销售」文案可能来自 sales_person_name=${pname || '-'}`
  } else {
    reason = `仅有姓名「${pname}」，本单位战报名单中无同名人员，且未走外援归集条件`
  }

  gaps.push({
    id: r.id,
    sale_date: r.sale_date,
    total_amount: Number(r.total_amount) || 0,
    personnel_id: pid || null,
    sales_person_name: pname || null,
    linked_person_name: linked?.name || null,
    linked_person_unit: linked ? unitNameById.get(linked.sales_unit_id) : null,
    order_number: r.order_number || r.external_order_id || '',
    customer_name: r.customer_name || '',
    product_name: r.product_name || '',
    reason,
  })
}

const gapTotal = gaps.reduce((s, g) => s + g.total_amount, 0)
const attributedApprox = teamTotal - gapTotal

console.log(JSON.stringify({
  unit: unit.name,
  unitId: unit.id,
  yearMonth,
  dbPath,
  teamTotal,
  attributedApprox,
  gapTotal,
  gapCount: gaps.length,
  salesCount: sales.length,
  note:
    'gap=挂在本单位当月、但按战报规则挂不到「本单位名单人员」的销售。' +
    '界面「有销售员」常看的是 sales_person_name；归集优先用 personnel_id。',
  gaps,
}, null, 2))
