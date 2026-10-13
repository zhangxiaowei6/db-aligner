param([Parameter(Mandatory=$true)][ValidateSet('5.7.44','8.0.45','8.4.8')][string]$Version,[Parameter(Mandatory=$true)][int]$Port,[string]$OpenSsl=$env:DB_ALIGNER_OPENSSL)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/common.ps1"
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskTools=Join-Path $taskRoot '.tools/mysql-test'
$taskBase=Join-Path $taskTools $Version
New-Item -ItemType Directory -Force -Path $taskBase | Out-Null
$taskBinary=Join-Path $taskBase "mysql-$Version-winx64"
if (!(Test-Path "$taskBinary/bin/mysqld.exe")) {
 $taskZip=Join-Path $taskBase 'server.zip'
 $taskUrl="https://cdn.mysql.com/archives/mysql-$($Version.Substring(0,3))/mysql-$Version-winx64.zip"
 if (!(Test-Path $taskZip)) { Invoke-WebRequest $taskUrl -OutFile $taskZip }
 Expand-Archive -LiteralPath $taskZip -DestinationPath $taskBase -Force
 $taskHash=Get-DBAlignerHash $taskZip SHA256
 [IO.File]::WriteAllText((Join-Path $taskBase 'download.json'),(@{url=$taskUrl;sha256=$taskHash}|ConvertTo-Json))
}
$taskData=Join-Path $taskBase 'data'
if (!(Test-Path "$taskData/mysql")) {
 New-Item -ItemType Directory -Force -Path $taskData | Out-Null
 & "$taskBinary/bin/mysqld.exe" '--no-defaults' '--initialize-insecure' "--basedir=$taskBinary" "--datadir=$taskData" "--log-error=$taskBase/initialize.log"
 if ($LASTEXITCODE -ne 0) { throw "MySQL initialization failed; see $taskBase/initialize.log" }
}
$taskCredentialFile=Join-Path $taskBase 'credentials.json'
if (Test-Path $taskCredentialFile) { $taskCredentials=Get-Content -Raw -LiteralPath $taskCredentialFile | ConvertFrom-Json }
else { $taskCredentials=@{host='127.0.0.1';port=$Port;user='root';password=([Guid]::NewGuid().ToString('N'));version=$Version}; [IO.File]::WriteAllText($taskCredentialFile,($taskCredentials|ConvertTo-Json),[Text.UTF8Encoding]::new($false)) }
$taskInit=Join-Path $taskBase 'init.sql'
[IO.File]::WriteAllText($taskInit,"ALTER USER 'root'@'localhost' IDENTIFIED BY '$($taskCredentials.password)';",[Text.UTF8Encoding]::new($false))
$taskOpenSsl = $OpenSsl
if ($taskOpenSsl) {
 if (!(Test-Path -LiteralPath $taskOpenSsl -PathType Leaf)) { throw 'Configured OpenSSL executable does not exist' }
} else {
 $taskOpenSslCommand = Get-Command openssl -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
 if ($taskOpenSslCommand) { $taskOpenSsl = $taskOpenSslCommand.Source }
 else {
  $taskGitCommand = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $taskCandidates = @()
  if ($taskGitCommand) {
   $taskGitRoot = Split-Path -Parent (Split-Path -Parent $taskGitCommand.Source)
   $taskCandidates += Join-Path $taskGitRoot 'mingw64/bin/openssl.exe'
   $taskCandidates += Join-Path $taskGitRoot 'usr/bin/openssl.exe'
  }
  if ($env:ProgramFiles) {
   $taskCandidates += Join-Path $env:ProgramFiles 'Git/mingw64/bin/openssl.exe'
   $taskCandidates += Join-Path $env:ProgramFiles 'Git/usr/bin/openssl.exe'
  }
  $taskOpenSsl = $taskCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
 }
}
if (!$taskOpenSsl) { throw 'SSL regression requires OpenSSL; use -OpenSsl or DB_ALIGNER_OPENSSL to specify its executable' }
& $taskOpenSsl version
if ($LASTEXITCODE -ne 0) { throw 'OpenSSL is not usable' }
$taskGenerateCertificate = !(Test-Path "$taskBase/server-cert.pem") -or !(Test-Path "$taskBase/server-key.pem")
if (!$taskGenerateCertificate) {
 & $taskOpenSsl x509 -checkend 86400 -noout -in "$taskBase/server-cert.pem" | Out-Null
 $taskGenerateCertificate = $LASTEXITCODE -ne 0
}
if ($taskGenerateCertificate) {
 $taskPreviousPreference = $ErrorActionPreference
 try {
  $ErrorActionPreference = 'Continue'
  & $taskOpenSsl req -x509 -nodes -newkey rsa:2048 -days 30 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout "$taskBase/server-key.pem" -out "$taskBase/server-cert.pem" 2>&1 | Out-Null
  $taskCertificateExit = $LASTEXITCODE
 } finally { $ErrorActionPreference = $taskPreviousPreference }
 if ($taskCertificateExit -ne 0) { throw 'Test certificate generation failed' }
}
$taskConfig=Join-Path $taskBase 'my.ini'
$taskConfigText="[mysqld]`nbasedir=$($taskBinary.Replace('\','/'))`ndatadir=$($taskData.Replace('\','/'))`nport=$Port`nbind-address=127.0.0.1`nlog-error=$($taskBase.Replace('\','/'))/server.log`ninit-file=$($taskInit.Replace('\','/'))`ncharacter-set-server=utf8mb4`ncollation-server=utf8mb4_general_ci`nmax-connections=40`n"
if ($Version -ne '5.7.44') { $taskConfigText+="mysqlx=OFF`n" }
if (Test-Path "$taskBase/server-cert.pem") { $taskConfigText+="ssl-cert=$($taskBase.Replace('\','/'))/server-cert.pem`nssl-key=$($taskBase.Replace('\','/'))/server-key.pem`n" }
[IO.File]::WriteAllText($taskConfig,$taskConfigText,[Text.UTF8Encoding]::new($false))
$taskPidFile=Join-Path $taskBase 'process.json'
if (Test-Path $taskPidFile) { $taskPrevious=Get-Content -Raw -LiteralPath $taskPidFile | ConvertFrom-Json; $taskProcess=Get-Process -Id $taskPrevious.id -ErrorAction SilentlyContinue; if ($taskProcess -and $taskProcess.Path -eq "$taskBinary/bin/mysqld.exe".Replace('/','\')) { Write-Output "MySQL $Version already running on localhost:$Port"; exit 0 } }
$taskClient=[Net.Sockets.TcpClient]::new();try{$taskClient.Connect('127.0.0.1',$Port);throw "Test port $Port is in use by another process"}catch [Net.Sockets.SocketException]{}finally{$taskClient.Dispose()}
$taskArguments = @("--defaults-file=$taskConfig")
if ($Version -ne '5.7.44') { $taskArguments += '--no-monitor' }
$taskProcess=Start-Process -FilePath "$taskBinary/bin/mysqld.exe" -ArgumentList $taskArguments -WindowStyle Hidden -PassThru
[IO.File]::WriteAllText($taskPidFile,(@{id=$taskProcess.Id;binary="$taskBinary/bin/mysqld.exe";config=$taskConfig}|ConvertTo-Json))
Write-Output "Started isolated MySQL $Version on localhost:$Port (PID $($taskProcess.Id)); data stays inside project .tools."
