$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskBase=[IO.Path]::GetFullPath((Join-Path $taskRoot '.tools/postgresql-test/17.11'))
$taskData=[IO.Path]::GetFullPath((Join-Path $taskBase 'data'))
if (!$taskData.StartsWith([IO.Path]::GetFullPath((Join-Path $taskRoot '.tools/postgresql-test'))+[IO.Path]::DirectorySeparatorChar)) { throw '实例路径越界' }
if (!(Test-Path -LiteralPath "$taskData/postmaster.pid")) { return }
$taskPid=[int](Get-Content -LiteralPath "$taskData/postmaster.pid" -TotalCount 1)
$taskProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
$taskExpected=[IO.Path]::GetFullPath((Join-Path $taskBase 'pgsql/bin/postgres.exe'))
if (!$taskProcess -or ![string]::Equals($taskProcess.ExecutablePath,$taskExpected,[StringComparison]::OrdinalIgnoreCase) -or !$taskProcess.CommandLine.Replace('/','\').Contains($taskData)) { throw '拒绝停止非项目 PostgreSQL 实例' }
& "$taskBase/pgsql/bin/pg_ctl.exe" 'stop' '-D' $taskData '-m' 'fast' '-w' '-t' '60'
if ($LASTEXITCODE -ne 0) { throw '隔离 PostgreSQL 停止失败' }
