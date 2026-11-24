# film-log → Trae「我的站点」重新部署（由 auto_sync_run.ps1 在同步并 push 成功后调用）
# 独立运行: powershell -ExecutionPolicy Bypass -File tools\deploy_trae.ps1
# 说明: 把仓库运行时文件复制到临时目录后上传部署；只改部署副本，不动仓库任何文件。
#       excludePosters 中列出的海报会被移除，并清空 app.js 中对应 poster 字段（平台内容审核拒绝）。
# 退出码: 0 部署成功；1 失败（GitHub Pages 已更新，数据不受影响）。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $PSScriptRoot 'auto_sync.config.json'

function Say($m) { Write-Output ('[trae-deploy] ' + $m) }

# cmd.exe 的输出可能夹带提示行，且 stderr 会触发 ErrorActionPreference=Stop
function Invoke-Cli([string]$exePath, [string]$argLine) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = (& cmd.exe /d /s /c ('"' + $exePath + '" ' + $argLine)) 2>&1 | Out-String
    } finally {
        $ErrorActionPreference = $prev
    }
    return $out
}

function Extract-Json([string]$text) {
    $i = $text.IndexOf('{"')
    $j = $text.LastIndexOf('}')
    if ($i -lt 0 -or $j -le $i) { return $null }
    return $text.Substring($i, $j - $i + 1)
}

if (-not (Test-Path $cfgPath)) { Say '缺少 auto_sync.config.json'; exit 1 }
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$trae = $cfg.trae
if (-not $trae -or -not $trae.siteId) { Say '配置缺少 trae.siteId'; exit 1 }

# 定位 trae-deploy CLI（插件版本目录会随升级变化，取最近修改的可用版本）
$pluginRoot = Join-Path $env:USERPROFILE '.trae-cn\plugins\trae-remote-official\deployment'
$exe = $null
if (Test-Path $pluginRoot) {
    foreach ($d in (Get-ChildItem $pluginRoot -Directory | Sort-Object LastWriteTime -Descending)) {
        $p = Join-Path $d.FullName 'skills\deployment\bin\win32-x64\trae-deploy.exe'
        if (Test-Path $p) { $exe = $p; break }
    }
}
if (-not $exe) { Say '未找到 trae-deploy.exe（Trae 部署插件未安装）'; exit 1 }
Say ('CLI: ' + $exe)

$source = $null
try {
    $source = Join-Path ([IO.Path]::GetTempPath()) ('trae-deploy-' + [guid]::NewGuid().ToString('N'))
    $pub = Join-Path $source 'public'
    New-Item -ItemType Directory -Path $pub -Force | Out-Null

    foreach ($f in @('index.html', 'app.js', 'styles.css', 'enhance.css', 'enhance.js', 'build.json')) {
        $src = Join-Path $repo $f
        if (Test-Path $src) { Copy-Item $src $pub -Force }
    }
    foreach ($d in @('assets', 'posters')) {
        $src = Join-Path $repo $d
        if (Test-Path $src) { Copy-Item $src (Join-Path $pub $d) -Recurse -Force }
    }

    # 排除被平台内容审核拒绝的海报（只影响部署副本）
    $excluded = @($trae.excludePosters | Where-Object { $_ })
    if ($excluded.Count -gt 0) {
        $appPath = Join-Path $pub 'app.js'
        $text = [IO.File]::ReadAllText($appPath, [Text.Encoding]::UTF8)
        foreach ($name in $excluded) {
            $img = Join-Path $pub ('posters\' + $name)
            if (Test-Path $img) { Remove-Item $img -Force }
            $text = $text.Replace('"poster": "posters/' + $name + '"', '"poster": ""')
        }
        [IO.File]::WriteAllText($appPath, $text, (New-Object Text.UTF8Encoding $false))
        Say ('已排除海报: ' + ($excluded -join '、'))
    }

    $files = @(Get-ChildItem $pub -Recurse -File)
    Say ('准备 ' + $files.Count + ' 个文件')

    $execCfg = Join-Path $source 'exec.json'
    Set-Content -Path $execCfg -Value '{}' -Encoding utf8

    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $title = 'film-log 自动同步部署 ' + $stamp
    $desc = '自动同步后重新部署 film-log 静态站点（来源 ' + $repo + '）'
    $tags = if ($trae.appTags) { $trae.appTags } else { '167' }

    $argLine = 'deployments create --site-id ' + $trae.siteId +
        ' --title "' + $title + '" --description "' + $desc + '"' +
        ' --type static-web --source-dir "' + $source + '"' +
        ' --execution-config "' + $execCfg + '" --app-tags ' + $tags
    $raw = Invoke-Cli $exe $argLine
    $json = Extract-Json $raw
    if (-not $json) { Say '创建部署无有效返回'; Write-Output $raw; exit 1 }
    try { $res = $json | ConvertFrom-Json } catch { Say '创建部署返回无法解析'; Write-Output $raw; exit 1 }
    if (-not $res.ok -or -not $res.data.deployment_id) {
        Say ('创建部署失败' + $(if ($res.error) { ': ' + $res.error.code } else { '' }))
        Write-Output $raw
        exit 1
    }
    $depId = $res.data.deployment_id
    Say ('已创建部署 ' + $depId)

    $wraw = Invoke-Cli $exe ('deployments wait --deployment-id ' + $depId)
    $wjson = Extract-Json $wraw
    if (-not $wjson) { Say '等待部署无有效返回'; Write-Output $wraw; exit 1 }
    try { $w = $wjson | ConvertFrom-Json } catch { Say '等待部署返回无法解析'; Write-Output $wraw; exit 1 }
    $dep = $w.data.deployment
    if ($dep -and $dep.status -eq 9) {
        Say ('部署成功 ' + $depId + '（版本 ' + $dep.deploy_target_release.route_revision + '）')
        exit 0
    }
    Say ('部署未成功: ' + $depId + ' status=' + $(if ($dep) { $dep.status } else { 'unknown' }))
    if ($dep -and $dep.failure) { Say ('原因: ' + $dep.failure) }
    exit 1
} finally {
    if ($source -and (Test-Path $source)) { Remove-Item $source -Recurse -Force -ErrorAction SilentlyContinue }
}
