# film-log 自动同步包装器（供计划任务调用）
# 行为: 运行 auto_sync.js；成功 → 清除重试任务；失败 → 安排 retryHours 小时后再次运行本脚本（链式重试直到成功）。
# 安装每周任务: powershell -ExecutionPolicy Bypass -File tools\install_schedule.ps1
$repo = Split-Path -Parent $PSScriptRoot   # tools/ 的上级 = 仓库根
$cfgPath = Join-Path $PSScriptRoot 'auto_sync.config.json'
$logDir = Join-Path $repo 'data'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'auto_sync_last.log'

$rh = 18
try {
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    if ($cfg.retryHours) { $rh = [int]$cfg.retryHours }
} catch {
    "配置读取失败: $($_.Exception.Message)" | Out-File $log -Encoding utf8
}

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 开始运行 ===" | Out-File $log -Encoding utf8 -Append
# node 输出为 UTF-8，PS5 默认按 OEM(GBK) 解码管道 → 临时切换控制台编码避免日志乱码
$prevEnc = [Console]::OutputEncoding
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
& node (Join-Path $PSScriptRoot 'auto_sync.js') $repo 2>&1 | Out-File $log -Encoding utf8 -Append
[Console]::OutputEncoding = $prevEnc
$code = $LASTEXITCODE
"=== 结束 exit=$code ===" | Out-File $log -Encoding utf8 -Append

$taskRetry = 'FilmLogAutoSyncRetry'
if ($code -eq 0) {
    $null = & schtasks.exe /delete /tn $taskRetry /f 2>&1
    exit 0
}

# 失败 → retryHours 小时后重试（以此类推直到成功）
$next = (Get-Date).AddHours($rh)
$sd = $next.ToString('yyyy/MM/dd')
$st = $next.ToString('HH:mm')
$tr = "powershell.exe -ExecutionPolicy Bypass -File `"$PSScriptRoot\auto_sync_run.ps1`""
$out = & schtasks.exe /create /tn $taskRetry /tr $tr /sc once /sd $sd /st $st /f 2>&1
"失败(exit=$code)，安排 $sd $st 重试：$out" | Out-File $log -Encoding utf8 -Append
exit $code
