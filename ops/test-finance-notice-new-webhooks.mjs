/**
 * 仅向本次新增/更新的财务通知钉钉群发送测试消息
 * 用法: node ops/test-finance-notice-new-webhooks.mjs
 */
const TARGETS = [
  {
    unitName: '南阳分仓',
    webhook:
      'https://oapi.dingtalk.com/robot/send?access_token=764c20bcc073e03479c95a7fdce6724c4fa1438a877d07e3c8aad2d5833646ef',
  },
  {
    unitName: '毕节分仓',
    webhook:
      'https://oapi.dingtalk.com/robot/send?access_token=13dbfd0b7f7fdddb49bdeaa64fafcd7e5e58fa7a4e82f2a1e401765855dc99e5',
  },
  {
    unitName: '宜春分仓',
    webhook:
      'https://oapi.dingtalk.com/robot/send?access_token=66f66512954434ec5267663c621b20bbe89bdece131554335d4437a6bc80d945',
  },
  {
    unitName: '南宁总仓',
    webhook:
      'https://oapi.dingtalk.com/robot/send?access_token=229c3a6078ea4ff3a27b6046318802293576702c7a5635adc79460dd934902a5',
  },
  {
    unitName: '大同分仓',
    webhook:
      'https://oapi.dingtalk.com/robot/send?access_token=fad810a3867037e9ea53c08c90f41cf6302bb06ac1205a455f4110bf6bf9bae9',
  },
]

async function sendTest(target) {
  const title = '财务通知连通性测试'
  const text = [
    `### 财务通知连通性测试`,
    ``,
    `单位：**${target.unitName}**`,
    ``,
    `这是一条测试消息，用于确认该群机器人已接入业绩系统财务通知。`,
    ``,
    `收到后可忽略。`,
  ].join('\n')

  const res = await fetch(target.webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { title, text },
    }),
  })
  const raw = await res.text()
  let data = {}
  try {
    data = JSON.parse(raw)
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(raw.slice(0, 200) || `HTTP ${res.status}`)
  }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg || JSON.stringify(data))
  }
  return data
}

async function main() {
  console.log(`将向 ${TARGETS.length} 个群发送财务通知测试消息…`)
  const failures = []
  for (const target of TARGETS) {
    try {
      const data = await sendTest(target)
      console.log(`OK  ${target.unitName}`, data.errmsg || 'ok')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`FAIL ${target.unitName}: ${msg}`)
      failures.push({ unitName: target.unitName, error: msg })
    }
  }
  console.log('')
  if (failures.length) {
    console.error(`失败 ${failures.length}/${TARGETS.length}`)
    process.exit(1)
  }
  console.log(`全部成功 ${TARGETS.length}/${TARGETS.length}，请到对应钉钉群确认是否收到。`)
}

main()
