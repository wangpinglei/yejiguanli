Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  业绩管理系统 - 启动中..." -ForegroundColor Yellow
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "后端服务启动后，访问地址：" -ForegroundColor Green
Write-Host "  http://localhost:3001" -ForegroundColor White
Write-Host ""
Write-Host "默认管理员账号: 18115335268" -ForegroundColor Gray
Write-Host "默认管理员密码: 0720" -ForegroundColor Gray
Write-Host ""
Write-Host "按 Ctrl+C 可停止服务" -ForegroundColor DarkYellow
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot
node --experimental-sqlite server/dist/index.js

Read-Host "按任意键退出..."
