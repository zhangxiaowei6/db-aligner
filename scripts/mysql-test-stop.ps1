$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskServers=Join-Path $taskRoot '.tools/mysql-test'
if (!(Test-Path $taskServers)) { exit 0 }
foreach ($taskVersion in @('5.7.44','8.0.45','8.4.8')) {
 $taskFile=Join-Path $taskServers "$taskVersion/process.json"
 if (!(Test-Path $taskFile)) { continue }
 $taskSaved=Get-Content -Raw -LiteralPath $taskFile | ConvertFrom-Json
 $taskProcess=Get-Process -Id $taskSaved.id -ErrorAction SilentlyContinue
 if (!$taskProcess) { continue }
 $taskExpected=[IO.Path]::GetFullPath($taskSaved.binary)
 $taskBoundary=[IO.Path]::GetFullPath($taskServers).TrimEnd('\')+'\'
 if (!$taskExpected.StartsWith($taskBoundary,[StringComparison]::OrdinalIgnoreCase) -or $taskProcess.Path -ne $taskExpected) { throw 'Refusing to stop a process outside the owned MySQL test directory' }
 Stop-Process -Id $taskProcess.Id
 Write-Output "Stopped owned MySQL $taskVersion (PID $($taskProcess.Id))"
}
