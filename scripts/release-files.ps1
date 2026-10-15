param([switch]$Unsigned)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$taskVersion = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $taskRoot 'desktop/package.json') | ConvertFrom-Json).version
Push-Location $taskRoot
try {
  node "$PSScriptRoot/check-release.mjs"
  if ($LASTEXITCODE -ne 0) { throw '发布版本检查失败' }
  $taskRelease = Join-Path $taskRoot 'release'
  $taskBundle = Join-Path $taskRoot 'desktop/src-tauri/target/release/bundle/nsis'
  $taskInstallerSource = Join-Path $taskBundle "DBAligner_$($taskVersion)_x64-setup.exe"
  $taskExeSource = Join-Path $taskRoot 'desktop/src-tauri/target/release/dbaligner.exe'
  foreach ($taskFile in @($taskInstallerSource, $taskExeSource)) {
    if (!(Test-Path -LiteralPath $taskFile)) { throw "缺少本次 Tauri 构建产物：$taskFile" }
  }
  $taskName = "DBAligner-Setup-$taskVersion-win-x64.exe"
  $taskInstallerDestination = Join-Path $taskRelease $taskName
  if (!(Test-Path -LiteralPath $taskInstallerDestination) -or
      (Get-DBAlignerHash $taskInstallerSource SHA256) -ne (Get-DBAlignerHash $taskInstallerDestination SHA256)) {
    Copy-Item -LiteralPath $taskInstallerSource -Destination $taskInstallerDestination -Force
  }
  $taskAttachments = @($taskName)
  if (!$Unsigned) {
    $taskSignatureSource = "$taskInstallerSource.sig"
    if (!(Test-Path -LiteralPath $taskSignatureSource)) { throw '缺少 Tauri 更新签名' }
    $taskSignatureDestination = Join-Path $taskRelease "$taskName.sig"
    if (!(Test-Path -LiteralPath $taskSignatureDestination) -or
        (Get-DBAlignerHash $taskSignatureSource SHA256) -ne (Get-DBAlignerHash $taskSignatureDestination SHA256)) {
      Copy-Item -LiteralPath $taskSignatureSource -Destination $taskSignatureDestination -Force
    }
    $taskSignature = (Get-Content -Raw -Encoding UTF8 -LiteralPath $taskSignatureSource).Trim()
    $taskUrl = "https://github.com/zhangxiaowei6/db-aligner/releases/latest/download/$taskName"
    $taskLatest = [ordered]@{
      version = $taskVersion
      notes = "DBAligner $taskVersion"
      pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
      platforms = @{ 'windows-x86_64' = @{ signature = $taskSignature; url = $taskUrl } }
    }
    [IO.File]::WriteAllText((Join-Path $taskRelease 'latest.json'), ($taskLatest | ConvertTo-Json -Depth 5) + "`n", [Text.UTF8Encoding]::new($false))
    node "$PSScriptRoot/verify-update-artifacts.mjs"
    if ($LASTEXITCODE -ne 0) { throw 'Tauri 更新资料验证失败' }
    $taskAttachments += @("$taskName.sig", 'latest.json')
  }

  $taskPortable = Join-Path $taskRelease 'portable'
  if (Test-Path -LiteralPath $taskPortable) {
    $taskPortableItem = Get-Item -LiteralPath $taskPortable
    $taskExpectedPortable = [IO.Path]::GetFullPath((Join-Path $taskRelease 'portable'))
    if ($taskPortableItem.LinkType -or
        ![string]::Equals([IO.Path]::GetFullPath($taskPortableItem.FullName), $taskExpectedPortable, [StringComparison]::OrdinalIgnoreCase)) {
      throw '便携目录不在预期发布位置，拒绝清理'
    }
    Remove-Item -LiteralPath $taskPortable -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $taskPortable | Out-Null
  Copy-Item -LiteralPath $taskExeSource -Destination (Join-Path $taskPortable 'DBAligner.exe') -Force
  foreach ($taskNameInBundle in @('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $taskRoot $taskNameInBundle) -Destination (Join-Path $taskPortable $taskNameInBundle) -Force
  }
  foreach ($taskDirectory in @('runtime', 'licenses')) {
    Copy-Item -LiteralPath (Join-Path $taskRoot $(if ($taskDirectory -eq 'runtime') { '.tools/runtime' } else { 'licenses' })) -Destination (Join-Path $taskPortable $taskDirectory) -Recurse -Force
  }
  New-Item -ItemType Directory -Path (Join-Path $taskPortable 'engine') | Out-Null
  Copy-Item -LiteralPath (Join-Path $taskRoot 'engine/target/engine.jar') -Destination (Join-Path $taskPortable 'engine/engine.jar') -Force
  Copy-Item -LiteralPath (Join-Path $taskRoot 'engine/target/lib') -Destination (Join-Path $taskPortable 'engine/lib') -Recurse -Force
  foreach ($taskResource in @('DBAligner.exe','engine/engine.jar','engine/lib/mariadb-java-client-3.5.10.jar','runtime/bin/java.exe','runtime/legal','licenses/mariadb/mariadb-java-client-3.5.10-sources.jar','licenses/postgresql/LICENSE','licenses/postgresql/driver-catalogue.json')) {
    if (!(Test-Path -LiteralPath (Join-Path $taskPortable $taskResource))) { throw "便携包缺少资源：$taskResource" }
  }
  $taskCatalogueHash = Get-DBAlignerHash (Join-Path $taskRoot 'engine/src/main/resources/drivers.json') SHA256
  if ((Get-DBAlignerHash (Join-Path $taskPortable 'licenses/postgresql/driver-catalogue.json') SHA256) -ne $taskCatalogueHash) { throw 'JDBC 驱动目录与源码不一致' }
  $taskOptional = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $taskRoot 'engine/src/main/resources/drivers.json') | ConvertFrom-Json | Where-Object { !$_.builtin }
  foreach ($taskDriver in $taskOptional) {
    foreach ($taskDriverFile in $taskDriver.files) {
      if (Test-Path -LiteralPath (Join-Path $taskPortable "engine/lib/$($taskDriverFile.name)")) { throw '按需驱动不能预置到引擎依赖' }
    }
  }
  $taskZipName = "DBAligner-$taskVersion-win-x64.zip"
  Compress-Archive -Path (Join-Path $taskPortable '*') -DestinationPath (Join-Path $taskRelease $taskZipName) -Force
  $taskAttachments += $taskZipName
  node "$PSScriptRoot/check-release.mjs" --notes-file (Join-Path $taskRelease 'RELEASE_NOTES.md')
  if ($LASTEXITCODE -ne 0) { throw '发布说明生成失败' }
  $taskAttachments += 'RELEASE_NOTES.md'
  $taskChecksums = foreach ($taskFile in $taskAttachments) {
    "$(Get-DBAlignerHash (Join-Path $taskRelease $taskFile) SHA256)  $taskFile"
  }
  [IO.File]::WriteAllText((Join-Path $taskRelease 'SHA256SUMS.txt'), ($taskChecksums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  Write-Output "已核对 $taskVersion 的 Tauri 安装包、完整便携 ZIP 与发布资料。"
} finally {
  Pop-Location
}
