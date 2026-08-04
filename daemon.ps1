# 业绩管理系统 - 进程守护脚本
# 功能：启动 Node 后端 + 崩溃自动重启 + 日志记录

$ErrorActionPreference = "Continue"
$projectDir = "C:\Users\王平蕾\WorkBuddy\2026-08-01-21-54-43\app"
$logDir = "$projectDir\logs"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log {
    param([string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $Msg" | Out-File -Append -FilePath "$logDir\daemon.log" -Encoding UTF8
}

Write-Log "=============================="
Write-Log "守护进程启动"

$restartCount = 0
$maxRestarts = 999  # 无限制重启

while ($true) {
    # 杀掉占端口的旧进程
    $pids = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($pids) {
        foreach ($p in $pids) {
            try {
                $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
                if ($proc -and $proc.ProcessName -eq "node") {
                    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                    Write-Log "终止旧 Node 进程 PID=$p"
                }
            } catch {}
        }
        Start-Sleep -Seconds 3
    }

    Write-Log "启动 Node 服务器... (第 $($restartCount+1) 次)"

    $nodeProc = Start-Process -FilePath "node" `
        -ArgumentList "--experimental-sqlite server/dist/index.js" `
        -WorkingDirectory $projectDir `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput "$logDir\node-stdout.log" `
        -RedirectStandardError "$logDir\node-stderr.log"

    Write-Log "Node 进程已启动 PID=$($nodeProc.Id)"

    # 等待进程退出
    Wait-Process -Id $nodeProc.Id -ErrorAction SilentlyContinue
    $exitCode = $nodeProc.ExitCode

    $restartCount++
    Write-Log "Node 进程退出 (ExitCode=$exitCode)，5秒后重启..."

    Start-Sleep -Seconds 5
}
