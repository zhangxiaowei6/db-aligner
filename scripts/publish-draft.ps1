param()
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$taskVersion = (Get-Content -Raw -LiteralPath 'desktop/package.json' | ConvertFrom-Json).version
if ($env:RELEASE_TAG -ne "v$taskVersion" -or $taskVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release tag' }
$taskFiles = @("release/DBAligner-Setup-$taskVersion.exe", "release/DBAligner-Setup-$taskVersion.exe.blockmap", 'release/latest.yml', "release/DBAligner-$taskVersion-win-x64.zip", 'release/SHA256SUMS.txt')
foreach ($taskFile in $taskFiles) { if (!(Test-Path -LiteralPath $taskFile)) { throw "Missing release attachment: $taskFile" } }
foreach ($taskLine in Get-Content -LiteralPath 'release/SHA256SUMS.txt') {
  if ($taskLine -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid checksum manifest' }
  $taskName = $Matches[2]
  $taskExpectedHash = $Matches[1]
  if ($taskName -notin @("DBAligner-Setup-$taskVersion.exe", "DBAligner-Setup-$taskVersion.exe.blockmap", 'latest.yml', "DBAligner-$taskVersion-win-x64.zip")) { throw 'Unexpected release attachment' }
  if ((Get-DBAlignerHash "release/$taskName" SHA256) -ne $taskExpectedHash) { throw "Checksum mismatch: $taskName" }
}
$taskExisting = gh api "repos/$env:GH_REPO/releases/tags/$env:RELEASE_TAG" 2>$null
if ($LASTEXITCODE -eq 0) {
  $taskRelease = $taskExisting | ConvertFrom-Json
  if (!$taskRelease.draft) { throw 'Refusing to overwrite a published release; increment the version' }
  gh release upload $env:RELEASE_TAG @taskFiles --clobber
} else {
  # --verify-tag also prevents accidental creation of a tag from the workflow checkout.
  $taskNotes = Join-Path $env:RUNNER_TEMP 'dbaligner-release-notes.md'
  [IO.File]::WriteAllText($taskNotes, "Windows x64；安装包未签名。`n`n发布前完成干净 Windows 安装、升级与两个版本的真实自动更新验收。`n`n请核对 SHA256SUMS.txt。ZIP 必须完整解压，不可只运行单独复制的 EXE。`n", [Text.UTF8Encoding]::new($false))
  gh release create $env:RELEASE_TAG @taskFiles --draft --verify-tag --title "DBAligner $taskVersion" --notes-file $taskNotes
}
if ($LASTEXITCODE -ne 0) { throw 'GitHub draft release upload failed' }
