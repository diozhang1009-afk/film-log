# 安装/更新 film-log 每周自动同步计划任务（周日 22:00）
# 用法: powershell -ExecutionPolicy Bypass -File tools\install_schedule.ps1
# 注意: 任务指向本仓库当前路径；仓库移动后需重新运行本脚本。
$repo = Split-Path -Parent $PSScriptRoot
$tr = "powershell.exe -ExecutionPolicy Bypass -File `"$PSScriptRoot\auto_sync_run.ps1`""
schtasks /create /tn 'FilmLogAutoSyncWeekly' /tr $tr /sc weekly /d SUN /st 22:00 /f
Write-Output '已安装: 每周日 22:00 运行 auto_sync_run.ps1（失败自动顺延 18h 重试，直到成功）。'
Write-Output "仓库路径: $repo（如移动仓库，请重跑本脚本）"
Write-Output '卸载: schtasks /delete /tn FilmLogAutoSyncWeekly /f ; schtasks /delete /tn FilmLogAutoSyncRetry /f'
