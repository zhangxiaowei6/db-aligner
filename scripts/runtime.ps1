param()
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskJdk=Join-Path $taskRoot '.tools/jdk'
$taskRuntime=Join-Path $taskRoot '.tools/runtime'
if (!(Test-Path "$taskJdk/bin/jlink.exe")) { throw 'Run npm run bootstrap first' }
if (!(Test-Path "$taskRuntime/bin/java.exe")) {
 & "$taskJdk/bin/jlink.exe" --add-modules java.base,java.sql,java.logging,java.naming,java.management,java.security.jgss,java.xml,java.desktop,java.instrument,jdk.crypto.ec,jdk.unsupported --strip-debug --no-header-files --no-man-pages --compress=zip-6 --output $taskRuntime
 if ($LASTEXITCODE -ne 0) { throw 'Bundled Java runtime build failed' }
}
Copy-Item -LiteralPath "$taskJdk/NOTICE" -Destination "$taskRuntime/NOTICE" -ErrorAction SilentlyContinue
Write-Output 'Bundled Java 21 runtime ready in .tools/runtime'
