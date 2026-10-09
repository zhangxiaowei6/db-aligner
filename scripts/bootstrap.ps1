$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskTools = Join-Path $taskRoot '.tools'
New-Item -ItemType Directory -Force -Path $taskTools | Out-Null
if (!(Test-Path (Join-Path $taskTools 'jdk/bin/java.exe'))) {
  $taskAsset = (Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows')[0]
  $taskZip = Join-Path $taskTools 'jdk.zip'
  Invoke-WebRequest $taskAsset.binary.package.link -OutFile $taskZip
  if ((Get-DataSyncHash $taskZip SHA256) -ne $taskAsset.binary.package.checksum) { throw 'Java download checksum mismatch' }
  $taskExtract = Join-Path $taskTools 'jdk-extract'
  Expand-Archive -LiteralPath $taskZip -DestinationPath $taskExtract -Force
  $taskJdk = Get-ChildItem -LiteralPath $taskExtract -Directory | Select-Object -First 1
  Assert-DataSyncToolPath $taskJdk.FullName $taskTools
  Assert-DataSyncToolPath (Join-Path $taskTools 'jdk') $taskTools
  Move-Item -LiteralPath $taskJdk.FullName -Destination (Join-Path $taskTools 'jdk')
}
if (!(Test-Path (Join-Path $taskTools 'maven/bin/mvn.cmd'))) {
  $taskUrl = 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip'
  $taskZip = Join-Path $taskTools 'maven.zip'
  Invoke-WebRequest $taskUrl -OutFile $taskZip
  $taskHash = (Invoke-RestMethod ($taskUrl + '.sha512')).Trim().Split(' ')[0]
  if ((Get-DataSyncHash $taskZip SHA512) -ne $taskHash.ToLowerInvariant()) { throw 'Maven download checksum mismatch' }
  Expand-Archive -LiteralPath $taskZip -DestinationPath $taskTools -Force
  Assert-DataSyncToolPath (Join-Path $taskTools 'apache-maven-3.9.11') $taskTools
  Assert-DataSyncToolPath (Join-Path $taskTools 'maven') $taskTools
  Move-Item -LiteralPath (Join-Path $taskTools 'apache-maven-3.9.11') -Destination (Join-Path $taskTools 'maven')
}
Write-Output 'Project-local Java 21 and Maven are ready.'
