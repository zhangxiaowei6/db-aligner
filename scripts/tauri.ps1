param([ValidateSet('dev', 'build', 'build-unsigned', 'app')][string]$Mode = 'dev')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskDesktop = Join-Path $taskRoot 'desktop'
$taskLocalCargo = Join-Path $taskRoot '.tools/cargo/bin/cargo.exe'
if (Test-Path -LiteralPath $taskLocalCargo) {
  $env:CARGO_HOME = Join-Path $taskRoot '.tools/cargo'
  $env:RUSTUP_HOME = Join-Path $taskRoot '.tools/rustup'
  $env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
  $env:PATH = (Split-Path -Parent $taskLocalCargo) + ';' + $env:PATH
}
$taskCli = Join-Path $taskRoot 'node_modules/.bin/tauri.cmd'
if (!(Test-Path -LiteralPath $taskCli)) { throw 'Tauri CLI 未安装，请运行 npm ci' }
if ($Mode -ne 'dev' -and [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
  $taskLocalKey = Join-Path $taskRoot '.tools/tauri-signing/updater.key'
  $taskLocalPassword = Join-Path $taskRoot '.tools/tauri-signing/updater.password'
  if ((Test-Path -LiteralPath $taskLocalKey) -and (Test-Path -LiteralPath $taskLocalPassword)) {
    $env:TAURI_SIGNING_PRIVATE_KEY = $taskLocalKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [IO.File]::ReadAllText($taskLocalPassword)
  }
}
if ($Mode -eq 'build' -and [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
  throw '签名安装包缺少 TAURI_SIGNING_PRIVATE_KEY；仅需本地无签名构建时使用 npm run dist:unsigned'
}
Push-Location $taskDesktop
try {
  if ($Mode -eq 'dev') {
    $env:DB_ALIGNER_DEV = '1'
    & $taskCli dev
  } elseif ($Mode -eq 'app') {
    & $taskCli build --no-bundle --config src-tauri/tauri.unsigned.conf.json
  } elseif ($Mode -eq 'build-unsigned') {
    & $taskCli build --config src-tauri/tauri.unsigned.conf.json
  } else {
    & $taskCli build
  }
  if ($LASTEXITCODE -ne 0) { throw "Tauri $Mode 失败：$LASTEXITCODE" }
} finally {
  Pop-Location
}
