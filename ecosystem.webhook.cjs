// 业绩管理系统 - Webhook 接收器 pm2 配置（独立于应用主进程 ecosystem.config.cjs）
//
// 启动：  pm2 startOrReload ecosystem.webhook.cjs
// 说明：  仅常驻 yejiguanli-webhook（Python 接收 GitHub X-Hub-Signature-256），
//         不触碰 / 、/crm/ 、/gg-task-collaboration 以及 pm2 中其它进程。
//         应用本身仍由现有 ecosystem.config.cjs（PORT=8100）管理，本文件不动它。
module.exports = {
  apps: [
    {
      name: "yejiguanli-webhook",
      script: "deploy_webhook.py",
      interpreter: "python3",
      cwd: "/root/yejiguanli",
      autorestart: true,
      watch: false,
      env: {
        WEBHOOK_PORT: 9010,
        WEBHOOK_SECRET_FILE: "/root/yejiguanli/.webhook_secret",
        WEBHOOK_LOG: "/var/log/yejiguanli-deploy.log",
        DEPLOY_SCRIPT: "/root/yejiguanli/deploy.sh",
      },
    },
  ],
};
