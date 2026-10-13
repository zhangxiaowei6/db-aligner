param()
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content -Raw -LiteralPath "$taskRoot/desktop/package.json" | ConvertFrom-Json).version
node "$PSScriptRoot/check-release.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Release version validation failed' }
$taskRelease = Join-Path $taskRoot 'release'
$taskApp = Join-Path $taskRelease 'win-unpacked'
foreach ($taskResource in @('DBAligner.exe','resources/engine/engine.jar','resources/engine/lib/mariadb-java-client-3.5.10.jar','resources/runtime/bin/java.exe','resources/runtime/legal','resources/licenses/mariadb/mariadb-java-client-3.5.10-sources.jar','resources/app-update.yml','resources/app.asar')) {
  if (!(Test-Path -LiteralPath (Join-Path $taskApp $taskResource))) { throw "Missing bundled resource: $taskResource" }
}
$taskInstaller = "DBAligner Setup $taskVersion.exe"
foreach ($taskFile in @($taskInstaller, "$taskInstaller.blockmap", 'latest.yml')) {
  if (!(Test-Path -LiteralPath (Join-Path $taskRelease $taskFile))) { throw "Missing release file: $taskFile" }
}
$taskRemoteInstaller = "DBAligner-Setup-$taskVersion.exe"
Copy-Item -LiteralPath (Join-Path $taskRelease $taskInstaller) -Destination (Join-Path $taskRelease $taskRemoteInstaller) -Force
Copy-Item -LiteralPath (Join-Path $taskRelease "$taskInstaller.blockmap") -Destination (Join-Path $taskRelease "$taskRemoteInstaller.blockmap") -Force
node "$PSScriptRoot/verify-update-artifacts.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Update artifacts validation failed' }
$taskZip = "DBAligner-$taskVersion-win-x64.zip"
Compress-Archive -Path "$taskApp/*" -DestinationPath (Join-Path $taskRelease $taskZip) -Force
$taskFiles = @($taskRemoteInstaller, "$taskRemoteInstaller.blockmap", 'latest.yml', $taskZip)
$taskChecksums = foreach ($taskFile in $taskFiles) {
  $taskHash = Get-DBAlignerHash (Join-Path $taskRelease $taskFile) SHA256
  "$taskHash  $taskFile"
}
[IO.File]::WriteAllText((Join-Path $taskRelease 'SHA256SUMS.txt'), ($taskChecksums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Verified release files for $taskVersion; portable ZIP includes the complete win-unpacked directory contents."
