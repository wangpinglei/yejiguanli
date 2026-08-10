/**
 * 单位战报表 SVG（对齐 SalesBattleReport 粉表头 / 黄汇总条）
 */

const COLS = [
  { key: 'name', title: '姓名', width: 160 },
  { key: 'target', title: '业绩目标', width: 140 },
  { key: 'sales', title: '个人业绩合计', width: 160 },
  { key: 'diff', title: '业绩差额', width: 140 },
  { key: 'rate', title: '个人完成率', width: 140 },
]

const TABLE_W = COLS.reduce((s, c) => s + c.width, 0)
const PAD = 24
const HEADER_H = 40
const ROW_H = 48
const FOOTER_H = 56
const TIP_H = 36
const TITLE_H = 52
const SVG_FONT =
  "PingFang SC, Microsoft YaHei, Noto Sans CJK SC, Source Han Sans SC, sans-serif"

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtMoney(n) {
  const num = Number(n) || 0
  return '¥' + num.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function fmtPercent(n) {
  return `${(Number(n) || 0).toFixed(1)}%`
}

/**
 * @param {object} report UnitBattleReport
 * @returns {string} SVG markup
 */
function buildYejiBattleSvg(report) {
  const rows = report.rows || []
  const tip =
    '展示所选月份在职期间的销售相关岗位，以及当月有业绩的其他岗位（如服务中心）。个人业绩按本单位销售记录归集。'
  const title = `${report.salesUnitName || ''} ${report.yearMonth || ''} 单位战报`

  const bodyH = Math.max(rows.length, 1) * ROW_H
  const svgW = TABLE_W + PAD * 2
  const svgH =
    PAD + TITLE_H + TIP_H + HEADER_H + bodyH + ROW_H + FOOTER_H + PAD

  let x = PAD
  const colXs = COLS.map((c) => {
    const left = x
    x += c.width
    return left
  })

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">`,
  )
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`)

  // title
  parts.push(
    `<text x="${svgW / 2}" y="${PAD + 28}" text-anchor="middle" font-size="20" font-weight="700" fill="#1f2937" font-family="${SVG_FONT}">${escapeXml(title)}</text>`,
  )

  // tip bar
  const tipY = PAD + TITLE_H
  parts.push(
    `<rect x="${PAD}" y="${tipY}" width="${TABLE_W}" height="${TIP_H}" fill="#f3f4f6"/>`,
  )
  parts.push(
    `<text x="${PAD + 12}" y="${tipY + 22}" font-size="11" fill="#6b7280" font-family="${SVG_FONT}">${escapeXml(tip)}</text>`,
  )

  // header
  const headY = tipY + TIP_H
  parts.push(
    `<rect x="${PAD}" y="${headY}" width="${TABLE_W}" height="${HEADER_H}" fill="#fce7f3"/>`,
  )
  COLS.forEach((c, i) => {
    const cx = colXs[i] + c.width / 2
    parts.push(
      `<text x="${cx}" y="${headY + 26}" text-anchor="middle" font-size="13" font-weight="700" fill="#831843" font-family="${SVG_FONT}">${escapeXml(c.title)}</text>`,
    )
    if (i < COLS.length - 1) {
      parts.push(
        `<line x1="${colXs[i] + c.width}" y1="${headY}" x2="${colXs[i] + c.width}" y2="${headY + HEADER_H}" stroke="#fbcfe8" stroke-width="1"/>`,
      )
    }
  })

  // rows
  let y = headY + HEADER_H
  if (rows.length === 0) {
    parts.push(
      `<rect x="${PAD}" y="${y}" width="${TABLE_W}" height="${ROW_H}" fill="#fff" stroke="#e5e7eb"/>`,
    )
    parts.push(
      `<text x="${svgW / 2}" y="${y + 30}" text-anchor="middle" font-size="13" fill="#9ca3af" font-family="${SVG_FONT}">该单位该月暂无在职销售人员</text>`,
    )
    y += ROW_H
  } else {
    rows.forEach((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#fafafa'
      parts.push(
        `<rect x="${PAD}" y="${y}" width="${TABLE_W}" height="${ROW_H}" fill="${bg}" stroke="#e5e7eb"/>`,
      )

      const nameLines = [
        escapeXml(row.name),
        row.position ? escapeXml(row.position) : '',
      ]
      parts.push(
        `<text x="${colXs[0] + COLS[0].width / 2}" y="${y + 20}" text-anchor="middle" font-size="13" font-weight="600" fill="#111827" font-family="${SVG_FONT}">${nameLines[0]}</text>`,
      )
      if (nameLines[1]) {
        parts.push(
          `<text x="${colXs[0] + COLS[0].width / 2}" y="${y + 36}" text-anchor="middle" font-size="10" fill="#9ca3af" font-family="${SVG_FONT}">${nameLines[1]}</text>`,
        )
      }

      const targetText =
        row.targetAmount != null && row.targetAmount > 0
          ? fmtMoney(row.targetAmount)
          : '—'
      parts.push(
        `<text x="${colXs[1] + COLS[1].width / 2}" y="${y + 28}" text-anchor="middle" font-size="13" fill="#4b5563" font-family="${SVG_FONT}">${targetText}</text>`,
      )

      parts.push(
        `<text x="${colXs[2] + COLS[2].width / 2}" y="${y + 28}" text-anchor="middle" font-size="13" font-weight="600" fill="#111827" font-family="${SVG_FONT}">${fmtMoney(row.personalSales)}</text>`,
      )

      let diffText = '—'
      let diffColor = '#9ca3af'
      if (row.targetAmount != null) {
        if (row.diff < 0) {
          diffText = '-' + fmtMoney(Math.abs(row.diff))
          diffColor = '#dc2626'
        } else {
          diffText = fmtMoney(row.diff)
          diffColor = row.diff > 0 ? '#059669' : '#9ca3af'
        }
      }
      parts.push(
        `<text x="${colXs[3] + COLS[3].width / 2}" y="${y + 28}" text-anchor="middle" font-size="13" font-weight="600" fill="${diffColor}" font-family="${SVG_FONT}">${diffText}</text>`,
      )

      let rateText = '—'
      let rateColor = '#9ca3af'
      if (row.targetAmount != null && row.targetAmount > 0) {
        rateText = fmtPercent(row.completionRate)
        rateColor = row.completionRate >= 100 ? '#047857' : '#c2410c'
      }
      parts.push(
        `<text x="${colXs[4] + COLS[4].width / 2}" y="${y + 28}" text-anchor="middle" font-size="13" font-weight="600" fill="${rateColor}" font-family="${SVG_FONT}">${rateText}</text>`,
      )

      COLS.forEach((c, i) => {
        if (i < COLS.length - 1) {
          parts.push(
            `<line x1="${colXs[i] + c.width}" y1="${y}" x2="${colXs[i] + c.width}" y2="${y + ROW_H}" stroke="#e5e7eb" stroke-width="1"/>`,
          )
        }
      })
      y += ROW_H
    })
  }

  // 合计行
  parts.push(
    `<rect x="${PAD}" y="${y}" width="${TABLE_W}" height="${ROW_H}" fill="#fdf2f8" stroke="#f9a8d4"/>`,
  )
  const sumCells = [
    '合计',
    fmtMoney(report.totalTarget),
    fmtMoney(report.battlePersonalSalesTotal),
    report.effectiveTeamTarget > 0
      ? (report.teamDiff < 0
          ? '-' + fmtMoney(Math.abs(report.teamDiff))
          : fmtMoney(report.teamDiff))
      : '—',
    report.totalTarget > 0
      ? fmtPercent(
          (report.teamTotal / report.totalTarget) * 100,
        )
      : '0.0%',
  ]
  sumCells.forEach((text, i) => {
    parts.push(
      `<text x="${colXs[i] + COLS[i].width / 2}" y="${y + 28}" text-anchor="middle" font-size="13" font-weight="700" fill="#831843" font-family="${SVG_FONT}">${escapeXml(text)}</text>`,
    )
  })
  y += ROW_H

  // 团队汇总黄条
  parts.push(
    `<rect x="${PAD}" y="${y}" width="${TABLE_W}" height="${FOOTER_H}" fill="#fefce8" stroke="#fde68a"/>`,
  )
  const teamRate =
    report.effectiveTeamTarget > 0
      ? fmtPercent(report.effectiveTeamCompletionRate)
      : '—'
  const teamDiffText =
    (report.teamDiff < 0 ? '-' : '+') + fmtMoney(Math.abs(report.teamDiff))
  const footerItems = [
    { label: '团队总业绩', value: fmtMoney(report.teamTotal), color: '#1d4ed8' },
    { label: '团队目标', value: fmtMoney(report.effectiveTeamTarget), color: '#047857' },
    {
      label: '团队差额',
      value: teamDiffText,
      color: report.teamDiff < 0 ? '#dc2626' : '#6d28d9',
    },
    { label: '团队总完成率', value: teamRate, color: '#b91c1c' },
  ]
  const slotW = TABLE_W / footerItems.length
  footerItems.forEach((item, i) => {
    const cx = PAD + slotW * i + slotW / 2
    parts.push(
      `<text x="${cx}" y="${y + 22}" text-anchor="middle" font-size="12" fill="#6b7280" font-family="${SVG_FONT}">${escapeXml(item.label)}</text>`,
    )
    parts.push(
      `<text x="${cx}" y="${y + 42}" text-anchor="middle" font-size="16" font-weight="700" fill="${item.color}" font-family="${SVG_FONT}">${escapeXml(item.value)}</text>`,
    )
  })

  parts.push('</svg>')
  return parts.join('\n')
}

module.exports = { buildYejiBattleSvg }
