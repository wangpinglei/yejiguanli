/**
 * 本地样例出图 + 推钉钉（看效果）
 * 用法: node ops/dingtalk-push-yeji/local-preview-push.js
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

async function main() {
  let sharp
  let axios
  try {
    sharp = require('sharp')
  } catch {
    sharp = require(path.join(__dirname, 'node_modules', 'sharp'))
  }
  try {
    axios = require('axios')
  } catch {
    axios = require(path.join(__dirname, 'node_modules', 'axios'))
  }

  const { buildYejiBattleSvg } = require('./yejiBattleReportSvg')

  const sample = {
    salesUnitId: 'demo_unit',
    salesUnitName: '示例销售单位',
    yearMonth: '2026-08',
    rows: [
      {
        personId: '1',
        name: '吴延东',
        position: '销售顾问',
        targetAmount: null,
        personalSales: 1000,
        diff: 0,
        completionRate: 0,
        positionMatch: null,
        isExternalPerson: false,
      },
      {
        personId: '2',
        name: '曾洁英',
        position: '销售顾问',
        targetAmount: null,
        personalSales: 10980,
        diff: 0,
        completionRate: 0,
        positionMatch: null,
        isExternalPerson: false,
      },
      {
        personId: '3',
        name: '朱志华',
        position: '销售经理',
        targetAmount: null,
        personalSales: 0,
        diff: 0,
        completionRate: 0,
        positionMatch: null,
        isExternalPerson: false,
      },
      {
        personId: '4',
        name: '仲家杰',
        position: '销售顾问',
        targetAmount: null,
        personalSales: 10600,
        diff: 0,
        completionRate: 0,
        positionMatch: null,
        isExternalPerson: false,
      },
    ],
    totalTarget: 0,
    battlePersonalSalesTotal: 22580,
    teamTotal: 22580,
    unitTargetAmount: 0,
    effectiveTeamTarget: 0,
    teamDiff: 0,
    effectiveTeamCompletionRate: 0,
    targetGap: 0,
  }

  const outDir = path.join(__dirname, 'preview-out')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const pngPath = path.join(outDir, `yeji-battle-preview-${Date.now()}.png`)

  const svg = buildYejiBattleSvg(sample)
  await sharp(Buffer.from(svg)).png().toFile(pngPath)
  console.log('[本地] 已生成图片:', pngPath)

  const webhook =
    process.env.YEJI_BATTLE_WEBHOOK_URL ||
    'https://oapi.dingtalk.com/robot/send?access_token=d64d7d63b39a6c65988de2deec51885d6680aa0df0afbf8f13e463528148587c'

  // 钉钉 markdown 图必须公网 URL：依次尝试临时图床
  console.log('[上传] 正在上传图片到临时图床...')
  let imageUrl
  try {
    imageUrl = await uploadToLitterbox(pngPath)
  } catch (e1) {
    console.log('[上传] litterbox 失败:', e1.message)
    try {
      imageUrl = await uploadTo0x0(pngPath)
    } catch (e2) {
      console.log('[上传] 0x0 失败:', e2.message)
      imageUrl = await uploadToTmpfiles(pngPath)
    }
  }
  console.log('[上传] 图片地址:', imageUrl)

  const title = `${sample.salesUnitName} ${sample.yearMonth} 单位战报`
  const markdown =
    `### ${title}\n\n` +
    `团队总业绩 **¥22,580**　团队目标 **¥0**\n\n` +
    `![战报](${imageUrl})\n\n` +
    `> 本地预览推送 · ${new Date().toLocaleString('zh-CN')}`

  console.log('[钉钉] 正在推送...')
  const res = await axios.post(
    webhook,
    {
      msgtype: 'markdown',
      markdown: { title, text: markdown },
    },
    { timeout: 15000 },
  )
  console.log('[钉钉] 响应:', JSON.stringify(res.data))
  if (res.data && res.data.errcode === 0) {
    console.log('[完成] 请到钉钉群查看效果；本地文件也可直接打开预览。')
  } else {
    console.error('[失败] 钉钉返回异常，请检查 webhook / 安全设置（关键词、IP）')
  }
}

function multipartBody(fields, fileField, filePath) {
  const boundary = '----YejiBoundary' + Date.now()
  const fileBuf = fs.readFileSync(filePath)
  const fileName = path.basename(filePath)
  const chunks = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`,
      'utf8',
    ),
  )
  chunks.push(fileBuf)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function httpsPostBuffer(hostname, urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': body.length,
          'User-Agent': 'yeji-preview/1.0',
        },
        timeout: 60000,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, data }))
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function uploadToLitterbox(filePath) {
  const { body, contentType } = multipartBody(
    { reqtype: 'fileupload', time: '1h' },
    'fileToUpload',
    filePath,
  )
  const res = await httpsPostBuffer('litterbox.catbox.moe', '/resources/internals/api.php', body, contentType)
  const url = (res.data || '').trim()
  if (res.status >= 200 && res.status < 300 && /^https?:\/\//.test(url)) return url
  throw new Error(`${res.status} ${res.data}`)
}

async function uploadTo0x0(filePath) {
  const { body, contentType } = multipartBody({}, 'file', filePath)
  const res = await httpsPostBuffer('0x0.st', '/', body, contentType)
  const url = (res.data || '').trim()
  if (res.status >= 200 && res.status < 300 && /^https?:\/\//.test(url)) return url
  throw new Error(`${res.status} ${res.data}`)
}

async function uploadToTmpfiles(filePath) {
  const { body, contentType } = multipartBody({}, 'file', filePath)
  const res = await httpsPostBuffer('tmpfiles.org', '/api/v1/upload', body, contentType)
  let json
  try {
    json = JSON.parse(res.data)
  } catch {
    throw new Error(res.data)
  }
  const raw = json?.data?.url
  if (!raw) throw new Error(JSON.stringify(json))
  // tmpfiles 页面链接改成直链
  return String(raw).replace('tmpfiles.org/', 'tmpfiles.org/dl/')
}

main().catch((err) => {
  console.error('[错误]', err.message || err)
  process.exit(1)
})
