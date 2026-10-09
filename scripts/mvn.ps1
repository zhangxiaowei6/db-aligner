$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskJava = Join-Path $taskRoot '.tools/jdk'
$taskMaven = Join-Path $taskRoot '.tools/maven/bin/mvn.cmd'
if (!(Test-Path $taskMaven) -or !(Test-Path "$taskJava/bin/java.exe")) { & "$PSScriptRoot/bootstrap.ps1" }
$env:JAVA_HOME = $taskJava
$env:PATH = "$taskJava/bin;" + $env:PATH
& $taskMaven -f "$taskRoot/engine/pom.xml" "-Dmaven.repo.local=$taskRoot/.tools/m2" @args
exit $LASTEXITCODE
