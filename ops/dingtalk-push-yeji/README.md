# 单位战报钉钉推送模块（复制到 /opt/dingtalk-push）

## 存图方式（对齐现有战报）

- 磁盘：`/opt/dingtalk-push/public/yeji-battle/*.png`
- 公网：`http://101.132.42.171/yeji-battle/xxx.png`
- 基址环境变量：复用 `WAR_REPORT_PUBLIC_BASE_URL=http://101.132.42.171`

## 一键部署（服务器整段复制）

```bash
cd /opt/dingtalk-push

# 若代码已在 /root/yejiguanli
SRC=/root/yejiguanli/ops/dingtalk-push-yeji
# 若还没有，先从本机 scp 再执行下面

cp -f "$SRC"/yejiBattleReport.js "$SRC"/yejiBattleReportSvg.js "$SRC"/yejiBattleReportScheduler.js ./src/
mkdir -p public/yeji-battle data

# .env 追加（webhook 换成你的）
grep -q 'YEJI_BATTLE_ENABLED' .env || cat >> .env <<'EOF'

# === 业绩系统单位战报 ===
YEJI_BATTLE_ENABLED=1
YEJI_API_BASE=http://127.0.0.1:3001
YEJI_API_KEY=eco-sync-2026-secret
YEJI_BATTLE_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=d64d7d63b39a6c65988de2deec51885d6680aa0df0afbf8f13e463528148587c
YEJI_BATTLE_CRON=0 8 * * *,0 17 * * *
YEJI_BATTLE_CRON_SLOTS=morning,evening
EOF

# 确保 index.js 已挂载路由与调度（若未改过，见 index.patch.snippet.js）
pm2 restart dingtalk-push
sleep 2
# 强制推送一次看效果
curl -s -X POST 'http://127.0.0.1:8014/api/yeji-battle/push?force=1' || \
curl -s -X POST 'http://127.0.0.1:3000/api/yeji-battle/push?force=1'

ls -la public/yeji-battle/ | tail
```

端口以 `pm2 show dingtalk-push` / `grep listen src/index.js` 为准。
