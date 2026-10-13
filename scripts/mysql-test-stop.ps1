$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskServers=Join-Path $taskRoot '.tools/mysql-test'
if (!(Test-Path $taskServers)) { exit 0 }
foreach ($taskVersion in @('5.7.44','8.0.45','8.4.8')) {
 $taskFile=Join-Path $taskServers "$taskVersion/process.json"
 if (!(Test-Path $taskFile)) { continue }
 $taskSaved=Get-Content -Raw -LiteralPath $taskFile | ConvertFrom-Json
 $taskExpected=[IO.Path]::GetFullPath($taskSaved.binary)
 $taskBoundary=[IO.Path]::GetFullPath($taskServers).TrimEnd('\')+'\'
 $taskConfig=[IO.Path]::GetFullPath($taskSaved.config)
 if (!$taskExpected.StartsWith($taskBoundary,[StringComparison]::OrdinalIgnoreCase) -or !$taskConfig.StartsWith($taskBoundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to stop a process outside the owned MySQL test directory' }
 # Older MySQL 8 launches may leave a child server after its monitoring parent exits.
 # Match the exact owned binary AND config, never a process name or port alone.
 $taskConfigArgument = '--defaults-file=(?:"' + [regex]::Escape($taskConfig) + '"|' + [regex]::Escape($taskConfig) + ')(?:\s|$)'
 $taskOwned = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $taskExpected -and $_.CommandLine -match $taskConfigArgument }
 foreach ($taskProcess in $taskOwned) {
  $taskCurrent = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskProcess.ProcessId)" -ErrorAction SilentlyContinue
  if (!$taskCurrent) { continue }
  if ($taskCurrent.ExecutablePath -ne $taskExpected -or $taskCurrent.CommandLine -notmatch $taskConfigArgument -or $taskCurrent.CreationDate -ne $taskProcess.CreationDate) { throw 'Owned process identity changed; refusing to stop it' }
  Stop-Process -Id $taskProcess.ProcessId
  Wait-Process -Id $taskProcess.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
  Write-Output "Stopped owned MySQL $taskVersion (PID $($taskProcess.ProcessId))"
 }
}
