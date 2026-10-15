param()
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$taskVersion = (Get-Content -Raw -Encoding UTF8 -LiteralPath 'desktop/package.json' | ConvertFrom-Json).version
if ($env:RELEASE_TAG -ne "v$taskVersion" -or $taskVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release tag' }
$taskNotes = 'release/RELEASE_NOTES.md'
$taskAttachmentNames = @("DBAligner-Setup-$taskVersion-win-x64.exe", "DBAligner-Setup-$taskVersion-win-x64.exe.sig", 'latest.json', "DBAligner-$taskVersion-win-x64.zip", 'RELEASE_NOTES.md')
$taskFiles = @($taskAttachmentNames | ForEach-Object { "release/$_" }) + @('release/SHA256SUMS.txt')
foreach ($taskFile in $taskFiles) { if (!(Test-Path -LiteralPath $taskFile)) { throw "Missing release attachment: $taskFile" } }
$taskVerifiedNames = @()
foreach ($taskLine in Get-Content -Encoding UTF8 -LiteralPath 'release/SHA256SUMS.txt') {
  if ($taskLine -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid checksum manifest' }
  $taskName = $Matches[2]
  $taskExpectedHash = $Matches[1]
  if ($taskName -notin $taskAttachmentNames -or $taskName -in $taskVerifiedNames) { throw 'Unexpected or duplicate release attachment' }
  if ((Get-DBAlignerHash "release/$taskName" SHA256) -ne $taskExpectedHash) { throw "Checksum mismatch: $taskName" }
  $taskVerifiedNames += $taskName
}
if ($taskVerifiedNames.Count -ne $taskAttachmentNames.Count) { throw 'Incomplete release checksum manifest' }
$taskExisting = gh release view $env:RELEASE_TAG --repo $env:GH_REPO --json isDraft 2>$null
if ($LASTEXITCODE -eq 0) {
  $taskRelease = $taskExisting | ConvertFrom-Json
  if (!$taskRelease.isDraft) { throw 'Refusing to overwrite a published release; increment the version' }
  gh release upload $env:RELEASE_TAG @taskFiles --clobber
  if ($LASTEXITCODE -ne 0) { throw 'GitHub draft release upload failed' }
  gh release edit $env:RELEASE_TAG --repo $env:GH_REPO --draft --title "DBAligner $taskVersion" --notes-file $taskNotes
} else {
  # --verify-tag also prevents accidental creation of a tag from the workflow checkout.
  gh release create $env:RELEASE_TAG @taskFiles --repo $env:GH_REPO --draft --verify-tag --title "DBAligner $taskVersion" --notes-file $taskNotes
}
if ($LASTEXITCODE -ne 0) { throw 'GitHub draft release upload failed' }
