#!/usr/bin/env python3
# ==============================================================================
# 业绩管理系统 - GitHub Webhook 接收器（gg-task 同款思路，改用 GitHub 签名）
# 监听 0.0.0.0:9010，校验 X-Hub-Signature-256（HMAC-SHA256），触发 deploy.sh
# 依赖：仅 Python 标准库（无需 pip 安装任何第三方包）
#
# 与 GitLab 方案的区别：GitLab 用 X-Gitlab-Token（明文比对），
# GitHub 用 X-Hub-Signature-256（HMAC-SHA256，secret 不落网），本脚本按 GitHub 方式校验。
# ==============================================================================
import os
import json
import hmac
import hashlib
import subprocess
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("WEBHOOK_PORT", "9010"))
SECRET = os.environ.get("WEBHOOK_SECRET", "").strip()
SECRET_FILE = os.environ.get("WEBHOOK_SECRET_FILE", "/root/yejiguanli/.webhook_secret")
LOG_FILE = os.environ.get("WEBHOOK_LOG", "/var/log/yejiguanli-deploy.log")
DEPLOY_SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/root/yejiguanli/deploy.sh")


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write("[webhook][%s] %s\n" % (now(), msg))
    except Exception:
        pass


def load_secret():
    if SECRET:
        return SECRET.encode("utf-8")
    if SECRET_FILE and os.path.exists(SECRET_FILE):
        try:
            with open(SECRET_FILE, "r", encoding="utf-8") as f:
                return f.read().strip().encode("utf-8")
        except Exception as e:
            log("读取 secret 文件失败: %s" % e)
    return b""


def verify_signature(secret, body, signature_header):
    """校验 GitHub X-Hub-Signature-256：sha256=HMAC_SHA256(secret, raw_body)"""
    if not secret:
        log("警告：未配置 Webhook Secret，跳过签名校验（不安全，请尽快配置 .webhook_secret）")
        return True
    if not signature_header:
        log("缺少 X-Hub-Signature-256 头")
        return False
    if not signature_header.startswith("sha256="):
        log("签名格式错误（应为 sha256=...）")
        return False
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    provided = signature_header[len("sha256="):]
    return hmac.compare_digest(expected, provided)


def trigger_deploy():
    try:
        # 非阻塞：立即返回 200，部署在后台独立会话运行（日志由 deploy.sh 自己写）
        subprocess.Popen(
            ["/bin/bash", DEPLOY_SCRIPT],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        log("已触发部署脚本: %s" % DEPLOY_SCRIPT)
        return True
    except Exception as e:
        log("触发部署失败: %s" % e)
        return False


class WebhookHandler(BaseHTTPRequestHandler):
    # 关闭默认访问日志（自行写日志到部署日志文件）
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, text):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # 健康检查 / 探活
        self._send(200, "yejiguanli webhook ok")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        body = self.rfile.read(length) if length > 0 else b""

        event = self.headers.get("X-GitHub-Event", "")
        delivery = self.headers.get("X-GitHub-Delivery", "")
        sig = self.headers.get("X-Hub-Signature-256", "")

        log("收到事件: %s delivery=%s" % (event, delivery))

        if event == "ping":
            self._send(200, "pong")
            return

        if event != "push":
            self._send(200, "ignored event: %s" % event)
            return

        # 校验 GitHub 签名
        secret = load_secret()
        if not verify_signature(secret, body, sig):
            self._send(403, "invalid signature")
            return

        # 解析 push 的 ref，仅处理 main 分支
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            self._send(400, "invalid json")
            return

        ref = payload.get("ref", "")
        if ref != "refs/heads/main":
            self._send(200, "ignored ref: %s" % ref)
            return

        if trigger_deploy():
            self._send(200, "deploy triggered")
        else:
            self._send(500, "deploy trigger failed")


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), WebhookHandler)
    log("Webhook 接收器已启动，监听 0.0.0.0:%d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Webhook 接收器已停止")
        server.shutdown()


if __name__ == "__main__":
    main()
