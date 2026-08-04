' 业绩管理系统 - 开机自启脚本
' 静默启动进程守护，无命令行窗口
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\王平蕾\WorkBuddy\2026-08-01-21-54-43\app\daemon.ps1""", 0, False
