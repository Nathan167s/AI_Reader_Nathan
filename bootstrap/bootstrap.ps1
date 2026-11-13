# PageNest first-run bootstrap. Windows PowerShell 5.1 compatible.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$NodeVersion = '24.22.2'
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $Root 'runtime'
$LogFile = Join-Path $RuntimeRoot 'bootstrap.log'
$Launcher = Join-Path $Root 'launcher.js'
$ChecksumsFile = Join-Path $PSScriptRoot 'checksums.json'
$PayloadRoot = Join-Path $PSScriptRoot 'payload'

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
function Write-Log([string]$message) {
  try {
    Add-Content -LiteralPath $LogFile -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message) -Encoding UTF8
  } catch {}
}

function Show-Error([string]$message) {
  Write-Log "ERROR: $message"
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "$message`n`n日志：$LogFile",
      '页间 PageNest 初始化失败',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
    Write-Host $message -ForegroundColor Red
    Read-Host '按回车退出'
  }
}

function Get-NodeArch {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
    return 'arm64'
  }
  if ([Environment]::Is64BitOperatingSystem) {
    return 'x64'
  }
  throw '当前系统不是 64 位 Windows，暂不支持。'
}

function Test-NodeExe([string]$exe) {
  if (-not (Test-Path -LiteralPath $exe)) { return $false }
  try {
    $version = & $exe -v 2>$null
    return ($version -match '^v24\.')
  } catch {
    return $false
  }
}

function Download-Node([string]$url, [string]$dest) {
  $part = "$dest.part"
  if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
  Write-Host "正在下载 Node.js：$url" -ForegroundColor Cyan
  Invoke-WebRequest -Uri $url -OutFile $part -UseBasicParsing -TimeoutSec 180
  if (-not (Test-Path -LiteralPath $part)) { throw '下载没有生成文件。' }
  Move-Item -LiteralPath $part -Destination $dest -Force
}

function Create-Shortcut([string]$nodeExe) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE 'Desktop' }
  $edgeCandidates = @()
  if (${env:ProgramFiles(x86)}) {
    $edgeCandidates += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
  }
  if ($env:ProgramFiles) {
    $edgeCandidates += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  }
  $edge = @($edgeCandidates) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  $icon = if ($edge) { "$edge,0" } else { "$nodeExe,0" }
  $shell = New-Object -ComObject WScript.Shell
  foreach ($path in @((Join-Path $Root '打开页间.lnk'), (Join-Path $desktop '页间 PageNest.lnk'))) {
    try {
      $shortcut = $shell.CreateShortcut($path)
      $shortcut.TargetPath = $nodeExe
      $shortcut.Arguments = '"' + $Launcher + '"'
      $shortcut.WorkingDirectory = $Root
      $shortcut.IconLocation = $icon
      $shortcut.Description = '启动页间本地阅读服务并用浏览器打开'
      $shortcut.Save()
      Write-Log "shortcut created: $path"
    } catch {
      Write-Log "shortcut failed: $path :: $($_.Exception.Message)"
    }
  }
}

function Start-PageNest([string]$nodeExe) {
  if (-not (Test-Path -LiteralPath $Launcher)) {
    throw "找不到 launcher.js：$Launcher"
  }
  $quotedLauncher = '"' + $Launcher + '"'
  Start-Process -FilePath $nodeExe -ArgumentList $quotedLauncher -WorkingDirectory $Root -WindowStyle Hidden
}

function Wait-PageNest {
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/health' -TimeoutSec 2
      if ($health.ok) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

function Clear-ApiKey {
  $settingsPath = Join-Path $Root 'data\settings.json'
  if (-not (Test-Path -LiteralPath $settingsPath)) {
    Write-Log 'api key clear skipped: settings.json not found'
    return
  }
  try {
    $raw = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return }
    $settings = $raw | ConvertFrom-Json
    if (-not ($settings.PSObject.Properties.Name -contains 'ai') -or $null -eq $settings.ai) {
      Write-Log 'api key clear skipped: no ai section'
      return
    }
    $hadValue = $false
    if ($settings.ai.PSObject.Properties.Name -contains 'apiKey') {
      $hadValue = -not [string]::IsNullOrEmpty([string]$settings.ai.apiKey)
      $settings.ai.apiKey = ''
    } else {
      $settings.ai | Add-Member -NotePropertyName apiKey -NotePropertyValue '' -Force
    }
    $json = $settings | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Log "api key cleared; hadValue=$hadValue"
    if ($hadValue) {
      Write-Host '  已清除上次保存的 AI API Key。' -ForegroundColor DarkYellow
    } else {
      Write-Host '  未发现已保存的 AI API Key。' -ForegroundColor Gray
    }
  } catch {
    Write-Log "api key clear failed: $($_.Exception.Message)"
    throw '无法清理 data\settings.json 中的 API Key。请检查 data 目录是否可写。'
  }
}

try {
  Write-Host ''
  Write-Host '  页间 PageNest · 首次初始化' -ForegroundColor Yellow
  Write-Host '  正在检查运行环境，请稍候…' -ForegroundColor Gray
  Write-Log 'bootstrap started'

  # 确保项目目录可写，避免用户把程序放在 Program Files 后初始化失败。
  $probe = Join-Path $Root '.pagenest-write-test'
  try {
    Set-Content -LiteralPath $probe -Value 'ok' -Encoding ASCII
    Remove-Item -LiteralPath $probe -Force
  } catch {
    throw '当前文件夹不可写。请把整个 PageNest 文件夹移动到桌面或 D 盘后再运行。'
  }

  Clear-ApiKey

  $arch = Get-NodeArch
  $zipName = "node-v$NodeVersion-win-$arch.zip"
  $nodeFolder = "node-v$NodeVersion-win-$arch"
  $nodeDir = Join-Path $RuntimeRoot $nodeFolder
  $nodeExe = Join-Path $nodeDir 'node.exe'

  if (Test-NodeExe $nodeExe) {
    Write-Host '  已检测到本地 Node 运行时，跳过安装。' -ForegroundColor Green
  } else {
    Write-Host "  未检测到本地 Node，将安装 Node v$NodeVersion ($arch)…" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    $checks = Get-Content -LiteralPath $ChecksumsFile -Raw | ConvertFrom-Json
    $entry = @($checks.files | Where-Object { $_.arch -eq $arch }) | Select-Object -First 1
    if (-not $entry) { throw "没有找到 $arch 架构的 Node 校验信息。" }

    $payload = Join-Path $PayloadRoot $zipName
    $downloadDir = Join-Path $RuntimeRoot 'downloads'
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    $zip = $payload

    if (-not (Test-Path -LiteralPath $payload)) {
      $zip = Join-Path $downloadDir $zipName
      if (-not (Test-Path -LiteralPath $zip)) {
        $urls = @(
          "https://nodejs.org/dist/v$NodeVersion/$zipName",
          "https://npmmirror.com/mirrors/node/v$NodeVersion/$zipName"
        )
        $downloaded = $false
        foreach ($url in $urls) {
          try {
            Download-Node $url $zip
            $downloaded = $true
            break
          } catch {
            Write-Log "download failed: $url :: $($_.Exception.Message)"
            Write-Host "  下载源不可用，尝试备用源…" -ForegroundColor DarkYellow
          }
        }
        if (-not $downloaded) {
          throw 'Node 下载失败。请检查网络后重试，或把离线 Node zip 放到 bootstrap\payload。'
        }
      }
    }

    Write-Host '  正在校验安装包…' -ForegroundColor Gray
    $actualHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    $expectedHash = [string]$entry.sha256
    if ($actualHash -ne $expectedHash.ToLower()) {
      Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
      throw 'Node 安装包校验失败，文件可能损坏。请重新下载或换一个网络环境。'
    }

    $staging = Join-Path $RuntimeRoot ('.staging-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
      Write-Host '  正在解压 Node…' -ForegroundColor Gray
      Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
      $inner = @(Get-ChildItem -LiteralPath $staging -Directory) | Select-Object -First 1
      if (-not $inner) { throw 'Node 压缩包结构异常。' }
      if (Test-Path -LiteralPath $nodeDir) {
        Remove-Item -LiteralPath $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
      }
      Move-Item -LiteralPath $inner.FullName -Destination $nodeDir -Force
    } finally {
      Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-NodeExe $nodeExe)) {
      throw 'Node 解压完成但无法运行。请查看日志，或重新解压。'
    }
    $installed = @{
      version = $NodeVersion
      arch = $arch
      installedAt = (Get-Date).ToString('o')
      source = $(if ($zip -eq $payload) { 'offline-payload' } else { 'download' })
    }
    $installed | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RuntimeRoot 'installed.json') -Encoding UTF8
    Write-Host '  Node 安装完成。' -ForegroundColor Green
  }

  Create-Shortcut $nodeExe
  Write-Host '  正在打开页间…' -ForegroundColor Green
  Start-PageNest $nodeExe
  if (-not (Wait-PageNest)) {
    throw '服务没有在 30 秒内启动。请确认 4173 端口未被其他程序占用，然后重试。'
  }
  Write-Log 'bootstrap completed'
  Write-Host ''
  Write-Host '  初始化完成，浏览器即将打开。' -ForegroundColor Green
  Write-Host '  以后双击桌面上的「页间 PageNest」即可使用。' -ForegroundColor Gray
  Write-Host '  如果浏览器没有自动打开，请访问 http://127.0.0.1:4173' -ForegroundColor Gray
  Start-Sleep -Seconds 3
  exit 0
} catch {
  Show-Error $_.Exception.Message
  exit 1
}
