#!/usr/bin/env bash
# ==============================================================================
# 业绩管理系统 - 自动部署脚本（由 deploy_webhook.py 触发）
# 流程：git fetch/reset main → Node22 构建 → 确保数据目录 → pm2 重启
# 注意：本脚本通过 pm2 restart yejiguanli 使用现有 ecosystem.config.cjs（PORT=8100），
#       不会触碰 / 、/crm/ 、/gg-task-collaboration 以及 pm2 中其它进程。
# ==============================================================================
set -uo pipefail

REPO_DIR="/root/yejiguanli"
LOG_FILE="/var/log/yejiguanli-deploy.log"
LOCK_FILE="/var/run/yejiguanli-deploy.lock"

# 所有输出追加到部署日志
exec >> "$LOG_FILE" 2>&1

echo "==================== [$(date '+%Y-%m-%d %H:%M:%S')] 开始部署 ===================="

# 串行锁：避免并发推送触发多次部署互相踩踏
exec 9>"$LOCK_FILE" || { echo "无法创建锁文件，退出"; exit 1; }
if ! flock -n 9; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 已有部署进行中，本次跳过"
  exit 0
fi

cd "$REPO_DIR" || { echo "仓库目录不存在: $REPO_DIR"; exit 1; }

# ---- 1. 拉取并硬重置到最新 main（保证与 GitHub 完全一致，且不丢失已提交内容）----
git fetch origin main
git reset --hard origin/main
echo "已重置到: $(git rev-parse --short HEAD)"

# ---- 2. 切换 Node 22（优先 nvm，其次系统 node）----
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || echo "nvm 切换 22 失败，回退系统 node"
fi
echo "Node 版本: $(node -v)  npm 版本: $(npm -v)"

# ---- 3. 安装依赖 + 构建（前端 app/dist + 后端 server/dist）----
npm run build:all

# ---- 4. 确保 SQLite 数据目录存在（数据库在此持久化，已被 .gitignore 忽略）----
mkdir -p server/data

# ---- 5. 重启应用（使用现有 ecosystem.config.cjs，PORT=8100）----
pm2 restart yejiguanli
pm2 save

echo "==================== [$(date '+%Y-%m-%d %H:%M:%S')] 部署完成 ===================="
