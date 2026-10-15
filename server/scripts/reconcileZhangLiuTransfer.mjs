/**
 * 梳理张鑫 / 刘志才转岗重复档案 + 归属时间轴
 *
 * 安全约定：
 * - 只改 personnel_id / personnel_unit_assignments / personnel.sales_unit_id
 * - 绝不 UPDATE sales_records.sales_unit_id / sales_unit_name（历史分仓销售单位不动）
 *
 * 用法（在正式服项目根或 server 目录）：
 *   node --experimental-sqlite server/scripts/reconcileZhangLiuTransfer.mjs
 *   node --experimental-sqlite server/scripts/reconcileZhangLiuTransfer.mjs --apply
 *
 * 默认 dry-run，加 --apply 才写入。
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apply = process.argv.includes('--apply')
const dbPath = process.env.YEJI_DB_PATH
  || path.join(__dirname, '..', 'data', 'database.db')

const WUHAN = 'unit_1785918932372_1887'
const NANJING = 'unit_1785918954497_8311'

/** @type {Array<{
 *  label: string
 *  keepId: string
 *  removeId: string
 *  keepNameExpect: string
 *  removeNameExpect: string
 *  transferDate: string
 *  fromUnitId: string
 *  toUnitId: string
 * }>} */
const JOBS = [
  {
    label: '张鑫',
    keepId: 'p_1786002577521_9157',
    removeId: 'p_1792066928698_5547',
    keepNameExpect: '分销张鑫',
    removeNameExpect: '张鑫',
    transferDate: '2026-09-23',
    fromUnitId: WUHAN,
    toUnitId: NANJING,
  },
  {
    label: '刘志才',
    keepId: 'p_1786002447349_1882',
    removeId: 'p_1792066938555_7470',
    keepNameExpect: '刘志才',
    removeNameExpect: '刘志才',
    transferDate: '2026-10-13',
    fromUnitId: WUHAN,
    toUnitId: NANJING,
  },
]

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`
}

function unitName(db, id) {
  const row = db.prepare('SELECT name FROM sales_units WHERE id = ?').get(id)
  return row?.name || id
}

function dumpPerson(db, id) {
  const p = db.prepare('SELECT * FROM personnel WHERE id = ?').get(id)
  if (!p) return null
  const assigns = db.prepare(`
    SELECT id, sales_unit_id, start_date, end_date, remark
    FROM personnel_unit_assignments
    WHERE personnel_id = ?
    ORDER BY start_date ASC, created_at ASC
  `).all(id)
  const salesByUnit = db.prepare(`
    SELECT sales_unit_id, COUNT(*) AS cnt, ROUND(SUM(total_amount), 2) AS amount
    FROM sales_records
    WHERE personnel_id = ?
    GROUP BY sales_unit_id
  `).all(id)
  return { person: p, assigns, salesByUnit }
}

function mergePerson(db, keepId, removeId) {
  const keep = db.prepare('SELECT * FROM personnel WHERE id = ?').get(keepId)
  const remove = db.prepare('SELECT * FROM personnel WHERE id = ?').get(removeId)
  if (!keep || !remove) {
    throw new Error(`合并失败：人员不存在 keep=${!!keep} remove=${!!remove}`)
  }

  const salesMoved = db.prepare(
    'UPDATE sales_records SET personnel_id = ? WHERE personnel_id = ?',
  ).run(keepId, removeId)

  // 提成：冲突删 remove，否则迁 keep
  const removePpc = db.prepare(
    'SELECT * FROM product_person_commissions WHERE personnel_id = ?',
  ).all(removeId)
  let ppcMoved = 0
  let ppcDropped = 0
  for (const row of removePpc) {
    const clash = db.prepare(`
      SELECT id FROM product_person_commissions
      WHERE sales_unit_id = ? AND product_id = ? AND personnel_id = ?
    `).get(row.sales_unit_id, row.product_id, keepId)
    if (clash) {
      db.prepare('DELETE FROM product_person_commissions WHERE id = ?').run(row.id)
      ppcDropped += 1
    } else {
      db.prepare(
        'UPDATE product_person_commissions SET personnel_id = ? WHERE id = ?',
      ).run(keepId, row.id)
      ppcMoved += 1
    }
  }

  // 目标
  const removeTargets = db.prepare(
    'SELECT * FROM performance_targets WHERE personnel_id = ?',
  ).all(removeId)
  let targetsMoved = 0
  let targetsDropped = 0
  for (const row of removeTargets) {
    const clash = db.prepare(`
      SELECT id FROM performance_targets
      WHERE sales_unit_id = ? AND year_month = ? AND personnel_id = ?
    `).get(row.sales_unit_id, row.year_month, keepId)
    if (clash) {
      db.prepare('DELETE FROM performance_targets WHERE id = ?').run(row.id)
      targetsDropped += 1
    } else {
      db.prepare(
        'UPDATE performance_targets SET personnel_id = ? WHERE id = ?',
      ).run(keepId, row.id)
      targetsMoved += 1
    }
  }

  // 人事
  const keepHr = db.prepare(
    'SELECT id FROM hr_profiles WHERE personnel_id = ?',
  ).get(keepId)
  const removeHr = db.prepare(
    'SELECT id FROM hr_profiles WHERE personnel_id = ?',
  ).get(removeId)
  if (removeHr) {
    if (keepHr) {
      db.prepare('DELETE FROM hr_profiles WHERE id = ?').run(removeHr.id)
    } else {
      db.prepare('UPDATE hr_profiles SET personnel_id = ? WHERE id = ?').run(
        keepId,
        removeHr.id,
      )
    }
  }

  db.prepare('DELETE FROM product_person_commissions WHERE personnel_id = ?').run(removeId)
  db.prepare('DELETE FROM monthly_adjustments WHERE personnel_id = ?').run(removeId)
  db.prepare('DELETE FROM performance_targets WHERE personnel_id = ?').run(removeId)
  db.prepare('DELETE FROM hr_profiles WHERE personnel_id = ?').run(removeId)
  db.prepare('DELETE FROM personnel_unit_assignments WHERE personnel_id = ?').run(removeId)
  db.prepare('DELETE FROM personnel_pay_plans WHERE personnel_id = ?').run(removeId)
  db.prepare('DELETE FROM personnel WHERE id = ?').run(removeId)

  return {
    salesMoved: Number(salesMoved.changes || 0),
    ppcMoved,
    ppcDropped,
    targetsMoved,
    targetsDropped,
    keepName: keep.name,
    removeName: remove.name,
  }
}

/**
 * 重建归属：武汉段 end=transferDate；南京段 start=transferDate 至今
 * 不改任何销售记录单位
 */
function rebuildAssignments(db, personnelId, fromUnitId, toUnitId, transferDate) {
  const person = db.prepare('SELECT * FROM personnel WHERE id = ?').get(personnelId)
  if (!person) throw new Error(`人员不存在 ${personnelId}`)

  const oldAssigns = db.prepare(`
    SELECT id, sales_unit_id, start_date, end_date, remark
    FROM personnel_unit_assignments
    WHERE personnel_id = ?
    ORDER BY start_date ASC
  `).all(personnelId)

  db.prepare(
    'DELETE FROM personnel_unit_assignments WHERE personnel_id = ?',
  ).run(personnelId)

  const hire = String(person.hire_date || '').slice(0, 10)
  let wuhanStart = hire && hire <= transferDate ? hire : '2026-01-01'
  for (const a of oldAssigns) {
    if (String(a.sales_unit_id) === fromUnitId) {
      const s = String(a.start_date || '').slice(0, 10)
      if (s && s < wuhanStart) wuhanStart = s
    }
  }
  if (wuhanStart > transferDate) wuhanStart = transferDate

  db.prepare(`
    INSERT INTO personnel_unit_assignments (
      id, personnel_id, sales_unit_id, start_date, end_date, remark, created_at,
      operator, operator_id
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), '系统梳理', '')
  `).run(
    genId('pua'),
    personnelId,
    fromUnitId,
    wuhanStart,
    transferDate,
    '转岗梳理：武汉段（含转岗日前）',
  )

  db.prepare(`
    INSERT INTO personnel_unit_assignments (
      id, personnel_id, sales_unit_id, start_date, end_date, remark, created_at,
      operator, operator_id
    ) VALUES (?, ?, ?, ?, NULL, ?, datetime('now'), '系统梳理', '')
  `).run(
    genId('pua'),
    personnelId,
    toUnitId,
    transferDate,
    '转岗梳理：南京段（转岗日起）',
  )

  db.prepare('UPDATE personnel SET sales_unit_id = ? WHERE id = ?').run(
    toUnitId,
    personnelId,
  )

  return { wuhanStart, transferDate, oldAssignCount: oldAssigns.length }
}

function assertSalesUnitsUntouched(beforeById, afterRows) {
  for (const row of afterRows) {
    const before = beforeById.get(row.id)
    if (!before) continue
    if (String(before.sales_unit_id) !== String(row.sales_unit_id)) {
      throw new Error(
        `安全校验失败：订单 ${row.id} 销售单位被改动 ${before.sales_unit_id} -> ${row.sales_unit_id}`,
      )
    }
  }
}

console.log(`DB: ${dbPath}`)
console.log(`模式: ${apply ? 'APPLY（写入）' : 'DRY-RUN（只预览）'}`)
console.log('')

const db = new DatabaseSync(dbPath)

// 快照相关订单的销售单位，结束后校验未变
const relatedIds = JOBS.flatMap((j) => [j.keepId, j.removeId])
const placeholders = relatedIds.map(() => '?').join(',')
const beforeSales = db.prepare(`
  SELECT id, personnel_id, sales_unit_id, sales_unit_name, total_amount, sale_date
  FROM sales_records
  WHERE personnel_id IN (${placeholders})
`).all(...relatedIds)
const beforeById = new Map(beforeSales.map((r) => [r.id, r]))
console.log(`相关销售记录快照: ${beforeSales.length} 笔（将校验销售单位不变）`)
console.log('')

for (const job of JOBS) {
  console.log(`======== ${job.label} ========`)
  const keepBefore = dumpPerson(db, job.keepId)
  const removeBefore = dumpPerson(db, job.removeId)
  if (!keepBefore) {
    console.log(`跳过：保留人不存在 ${job.keepId}`)
    continue
  }
  console.log('保留人:', keepBefore.person.name, '|', keepBefore.person.position, '|', job.keepId)
  console.log(
    '  当前单位:',
    unitName(db, keepBefore.person.sales_unit_id),
    '| 归属段数:',
    keepBefore.assigns.length,
  )
  console.log('  订单按单位:', keepBefore.salesByUnit.map((x) => ({
    unit: unitName(db, x.sales_unit_id),
    cnt: x.cnt,
    amount: x.amount,
  })))
  if (removeBefore) {
    console.log('并入人:', removeBefore.person.name, '|', removeBefore.person.position, '|', job.removeId)
    console.log('  订单按单位:', removeBefore.salesByUnit.map((x) => ({
      unit: unitName(db, x.sales_unit_id),
      cnt: x.cnt,
      amount: x.amount,
    })))
  } else {
    console.log('并入人: 已不存在（可能已合并）', job.removeId)
  }
  console.log(
    `计划时间轴: ${unitName(db, job.fromUnitId)} ~ ${job.transferDate}  →  ${unitName(db, job.toUnitId)} 自 ${job.transferDate} 至今`,
  )

  if (!String(keepBefore.person.name || '').includes(job.keepNameExpect)) {
    console.warn(`警告：保留人姓名不含「${job.keepNameExpect}」，请人工确认`)
  }
  if (removeBefore && String(removeBefore.person.name || '').trim() !== job.removeNameExpect
    && !String(removeBefore.person.name || '').includes(job.removeNameExpect)) {
    console.warn(`警告：并入人姓名与预期「${job.removeNameExpect}」不一致`)
  }

  if (!apply) {
    console.log('（dry-run 未写入）\n')
    continue
  }

  db.exec('BEGIN')
  try {
    let mergeStats = null
    if (removeBefore) {
      mergeStats = mergePerson(db, job.keepId, job.removeId)
      console.log('合并结果:', mergeStats)
    }
    const timeline = rebuildAssignments(
      db,
      job.keepId,
      job.fromUnitId,
      job.toUnitId,
      job.transferDate,
    )
    console.log('时间轴重建:', timeline)

    if (beforeSales.length > 0) {
      const afterSales = db.prepare(`
        SELECT id, sales_unit_id FROM sales_records
        WHERE id IN (${beforeSales.map(() => '?').join(',')})
      `).all(...beforeSales.map((r) => r.id))
      assertSalesUnitsUntouched(beforeById, afterSales)
    }

    db.exec('COMMIT')
    const after = dumpPerson(db, job.keepId)
    console.log('完成后归属:')
    for (const a of after?.assigns || []) {
      console.log(
        ' ',
        unitName(db, a.sales_unit_id),
        a.start_date,
        '~',
        a.end_date || '至今',
        a.remark || '',
      )
    }
    console.log('')
  } catch (e) {
    db.exec('ROLLBACK')
    console.error('失败已回滚:', e.message || e)
    process.exitCode = 1
    break
  }
}

if (!apply) {
  console.log('预览结束。确认无误后在正式服执行：')
  console.log('  node --experimental-sqlite server/scripts/reconcileZhangLiuTransfer.mjs --apply')
}
