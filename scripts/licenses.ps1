$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskLicense=Join-Path $taskRoot 'licenses'
New-Item -ItemType Directory -Force -Path $taskLicense | Out-Null
if (!(Test-Path "$taskRoot/LICENSE")) { Invoke-WebRequest 'https://www.apache.org/licenses/LICENSE-2.0.txt' -OutFile "$taskRoot/LICENSE" }
$taskTexts=Join-Path $taskLicense 'texts'
New-Item -ItemType Directory -Force -Path $taskTexts | Out-Null
if (!(Test-Path "$taskTexts/EPL-2.0.html")) { Invoke-WebRequest 'https://www.eclipse.org/legal/epl-v20.html' -OutFile "$taskTexts/EPL-2.0.html" }
if (!(Test-Path "$taskTexts/LGPL-2.1.txt")) { Invoke-WebRequest 'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt' -OutFile "$taskTexts/LGPL-2.1.txt" }
Copy-Item -LiteralPath "$taskRoot/LICENSE" -Destination "$taskTexts/Apache-2.0.txt" -Force
$taskMaria=Join-Path $taskLicense 'mariadb'
New-Item -ItemType Directory -Force -Path $taskMaria | Out-Null
if (!(Test-Path "$taskMaria/mariadb-java-client-3.5.10-sources.jar")) { Invoke-WebRequest 'https://repo.maven.apache.org/maven2/org/mariadb/jdbc/mariadb-java-client/3.5.10/mariadb-java-client-3.5.10-sources.jar' -OutFile "$taskMaria/mariadb-java-client-3.5.10-sources.jar" }
if (!(Test-Path "$taskMaria/LICENSE")) { Invoke-WebRequest 'https://raw.githubusercontent.com/mariadb-corporation/mariadb-connector-j/3.5.10/LICENSE' -OutFile "$taskMaria/LICENSE" }
$taskPgLicense=Join-Path $taskLicense 'postgresql'
New-Item -ItemType Directory -Force -Path $taskPgLicense | Out-Null
if (!(Test-Path "$taskPgLicense/LICENSE")) { Invoke-WebRequest 'https://raw.githubusercontent.com/pgjdbc/pgjdbc/REL42.7.8/LICENSE' -OutFile "$taskPgLicense/LICENSE" }
Copy-Item -LiteralPath "$taskRoot/engine/src/main/resources/drivers.json" -Destination "$taskPgLicense/driver-catalogue.json" -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskInventory=@()
foreach ($taskJar in Get-ChildItem -LiteralPath "$taskRoot/engine/target/lib" -Filter '*.jar') {
 $taskZip=[IO.Compression.ZipFile]::OpenRead($taskJar.FullName)
 try { foreach ($taskEntry in $taskZip.Entries) {
  if ($taskEntry.FullName -match '(?i)(^|/)(LICENSE[^/]*|NOTICE[^/]*|COPYING[^/]*|COPYRIGHT[^/]*)$') {
   $taskOutput=Join-Path "$taskLicense/java/$($taskJar.BaseName)" $taskEntry.FullName
   New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskOutput) | Out-Null
   [IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntry,$taskOutput,$true)
  }
 }
 $taskHasher=[Security.Cryptography.SHA256]::Create();$taskStream=[IO.File]::OpenRead($taskJar.FullName);try{$taskHash=[BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-','')}finally{$taskStream.Dispose();$taskHasher.Dispose()}
 $taskInventory+=@{file=$taskJar.Name;sha256=$taskHash}
 }finally{$taskZip.Dispose()}
}
[IO.File]::WriteAllText("$taskLicense/java-inventory.json",($taskInventory|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$taskRelease=Get-Content -Raw -LiteralPath "$taskRoot/.tools/jdk/release"
$taskVersion=[regex]::Match($taskRelease,'JAVA_RUNTIME_VERSION="([^"]+)"').Groups[1].Value.Replace('-LTS','')
$taskSource=@{version=$taskVersion;sourceUrl="https://api.adoptium.net/v3/binary/version/jdk-$taskVersion/windows/x64/sources/hotspot/normal/eclipse";repository='https://github.com/adoptium/jdk21u';sourceCommit=([regex]::Match($taskRelease,'SOURCE=".:git:([^"]+)"').Groups[1].Value)}
[IO.File]::WriteAllText("$taskLicense/runtime-source.json",($taskSource|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
node "$PSScriptRoot/npm-licenses.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Dependency notice generation failed' }
node "$PSScriptRoot/rust-licenses.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Rust dependency notice generation failed' }
Write-Output 'Third-party notices, source driver and inventory prepared'
