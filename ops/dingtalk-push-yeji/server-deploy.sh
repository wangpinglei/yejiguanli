#!/bin/bash
# 在服务器整段复制执行：对齐战报存图方式，部署单位战报模块
set -e
cd /opt/dingtalk-push

echo "=== 现有战报存图方式 ==="
echo "目录: /opt/dingtalk-push/public/war-reports/"
echo "基址: WAR_REPORT_PUBLIC_BASE_URL=http://101.132.42.171"
ls -la public/war-reports/ | tail -5

echo "=== 准备单位战报目录 ==="
mkdir -p public/yeji-battle data src

# 模块源：优先 /root/yejiguanli，否则提示先 scp
SRC=""
if [ -f /root/yejiguanli/ops/dingtalk-push-yeji/yejiBattleReport.js ]; then
  SRC=/root/yejiguanli/ops/dingtalk-push-yeji
elif [ -f /tmp/dingtalk-push-yeji/yejiBattleReport.js ]; then
  SRC=/tmp/dingtalk-push-yeji
fi

if [ -z "$SRC" ]; then
  echo "未找到 yeji 模块源码。"
  echo "请先在本机执行："
  echo "  scp -r ops/dingtalk-push-yeji root@101.132.42.171:/tmp/"
  echo "然后再跑本脚本。"
  exit 1
fi

cp -f "$SRC"/yejiBattleReport.js "$SRC"/yejiBattleReportSvg.js "$SRC"/yejiBattleReportScheduler.js ./src/
echo "已复制模块自: $SRC"

# 写入 env（不重复追加）
if ! grep -q 'YEJI_BATTLE_ENABLED' .env 2>/dev/null; then
  cat >> .env <<'EOF'

# === 业绩系统单位战报（存图同战报：public + http://101.132.42.171）===
YEJI_BATTLE_ENABLED=1
YEJI_API_BASE=http://127.0.0.1:3001
YEJI_API_KEY=eco-sync-2026-secret
YEJI_BATTLE_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=d64d7d63b39a6c65988de2deec51885d6680aa0df0afbf8f13e463528148587c
YEJI_BATTLE_CRON=0 8 * * *,0 17 * * *
YEJI_BATTLE_CRON_SLOTS=morning,evening
EOF
  echo "已追加 YEJI_BATTLE_* 到 .env"
else
  echo ".env 已有 YEJI_BATTLE_*，跳过追加"
fi

# 检查 index.js 是否已接入
if ! grep -q 'yejiBattleReport' src/index.js; then
  echo ""
  echo "!!! src/index.js 尚未接入 yeji 模块，请手动合并下面几段后执行: pm2 restart dingtalk-push"
  echo "--- require ---"
  echo "const yejiBattleReport = require('./yejiBattleReport');"
  echo "const yejiBattleReportScheduler = require('./yejiBattleReportScheduler');"
  echo "--- routes ---"
  cat <<'ROUTES'
app.get('/api/yeji-battle/preview', async (req, res) => {
  try {
    const data = await yejiBattleReport.generatePreview(req.query.month);
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/yeji-battle/push', async (req, res) => {
  try {
    const result = await yejiBattleReport.pushAll({
      month: req.query.month || (req.body && req.body.month),
      force: String(req.query.force) === '1' || !!(req.body && req.body.force),
      slot: req.query.slot || 'manual',
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
ROUTES
  echo "--- startup ---"
  echo "yejiBattleReportScheduler.start();"
else
  echo "index.js 已包含 yejiBattleReport，准备重启"
  pm2 restart dingtalk-push
  sleep 2
fi

echo "=== 查看监听端口 ==="
grep -nE 'listen|PORT' src/index.js | head -20
pm2 show dingtalk-push | grep -E 'script|cwd|status' | head -10

echo "=== 完成后图片应在 ==="
echo "  磁盘: /opt/dingtalk-push/public/yeji-battle/"
echo "  访问: http://101.132.42.171/yeji-battle/<文件名>.png"
echo "=== 手动推送示例（端口按实际改）==="
echo "  curl -s -X POST 'http://127.0.0.1:PORT/api/yeji-battle/push?force=1'"
ls -la public/yeji-battle/ 2>/dev/null || true
echo "=== 脚本结束 ==="
