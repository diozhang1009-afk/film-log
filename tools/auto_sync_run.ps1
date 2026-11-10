# film-log 自动同步包装器（供计划任务调用）
# 行为: 运行 auto_sync.js；成功 → 清除重试任务；失败 → 安排 retryHours 小时后再次运行本脚本（链式重试直到成功）。
# 安装每周任务: powershell -ExecutionPolicy Bypass -File tools\install_schedule.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot   # tools/ 的上级 = 仓库根
$cfg  = Get-Content (Join-Path $PSScriptRoot 'auto_sync.config.json') -Raw | ConvertFrom-Json
$taskRetry = 'FilmLogAutoSyncRetry'

& node (Join-Path $PSScriptRoot 'auto_sync.js') $repo
$code = $LASTEXITCODE

if ($code -eq 0) {
    schtasks /delete /tn $taskRetry /f 2>$null | Out-Null
    exit 0
}

# 失败 → 18 小时后重试（以此类推直到成功）
$rh = 18; if ($cfg.retryHours) { $rh = [int]$cfg.retryHours }
$next = (Get-Date).AddHours($rh)
$sd = $next.ToString('yyyy/MM/dd'); $st = $next.ToString('HH:mm')
$tr = "powershell.exe -ExecutionPolicy Bypass -File `"$PSScriptRoot\auto_sync_run.ps1`""
schtasks /create /tn $taskRetry /tr $tr /sc once /sd $sd /st $st /f | Out-Null
Write-Output ("[auto_sync_run] 运行失败(exit=$code)，已安排 $sd $st 重试。")
exit $code
