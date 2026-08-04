# 业绩管理系统 - 后台启动脚本（供任务计划程序调用）
# 开机自启 + 崩溃自动重启

$ErrorActionPreference = "Stop"

# 日志文件
$logDir = "$PSScriptRoot\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = "$logDir\server-$(Get-Date -Format 'yyyyMMdd').log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $Message" | Out-File -Append -FilePath $logFile -Encoding UTF8
}

Write-Log "========================================"
Write-Log "业绩管理系统服务启动中..."

# 先杀掉占用 3001 端口的旧进程
$existingProcess = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($existingProcess) {
    foreach ($pid in $existingProcess) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq "node") {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Log "已终止旧 Node 进程 PID=$pid"
            }
        } catch {}
    }
    Start-Sleep -Seconds 2
}

# 切换到项目目录
Set-Location "$PSScriptRoot"

# 启动 Node 服务器
Write-Log "启动 Node 服务器..."
$process = Start-Process -FilePath "node" `
    -ArgumentList "--experimental-sqlite server/dist/index.js" `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput "$logDir\node-stdout.log" `
    -RedirectStandardError "$logDir\node-stderr.log"

Write-Log "服务器已启动，PID=$($process.Id)"

# 等待进程退出（崩溃时会被任务计划程序自动重启）
Wait-Process -Id $process.Id
Write-Log "服务器进程已退出，PID=$($process.Id)"
