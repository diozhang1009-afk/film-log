# 安装/更新 film-log 每月自动同步计划任务（每月 15 日、30 日 22:00）
# 用法: powershell -ExecutionPolicy Bypass -File tools\install_schedule.ps1
# 注意: 任务指向本仓库当前路径；仓库移动后需重新运行本脚本。
$repo = Split-Path -Parent $PSScriptRoot
$tr = "powershell.exe -ExecutionPolicy Bypass -File `"$PSScriptRoot\auto_sync_run.ps1`""
$a1 = @('/create','/tn','FilmLogAutoSync_15','/tr',$tr,'/sc','monthly','/d','15','/st','22:00','/f')
$a2 = @('/create','/tn','FilmLogAutoSync_30','/tr',$tr,'/sc','monthly','/d','30','/st','22:00','/f')
& schtasks.exe @a1
& schtasks.exe @a2
Write-Output '已安装: 每月 15 日、30 日 22:00 运行 auto_sync_run.ps1（失败自动顺延 18h 重试，直到成功）。'
Write-Output '同步并 push 成功后会调用 deploy_trae.ps1 重新部署 Trae「我的站点」（失败仅记日志，不影响 GitHub Pages）。'
Write-Output "仓库路径: $repo（如移动仓库，请重跑本脚本）"
Write-Output '卸载: schtasks /delete /tn FilmLogAutoSync_15 /f ; schtasks /delete /tn FilmLogAutoSync_30 /f ; schtasks /delete /tn FilmLogAutoSyncRetry /f'
