param([ValidateRange(1024,65535)][int]$Port=33917)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskBase=Join-Path $taskRoot '.tools/postgresql-test/17.11'
New-Item -ItemType Directory -Force -Path $taskBase | Out-Null
$taskDriver=(Get-Content -Raw -Encoding UTF8 -LiteralPath "$taskRoot/engine/src/main/resources/drivers.json" | ConvertFrom-Json | Where-Object { $_.id -eq 'postgresql' })
$taskDriverDirectory=Join-Path $taskRoot '.tools/multi-db'
New-Item -ItemType Directory -Force -Path $taskDriverDirectory | Out-Null
foreach ($taskDriverFile in $taskDriver.files) {
  $taskDriverPath=Join-Path $taskDriverDirectory $taskDriverFile.name
  if (!(Test-Path -LiteralPath $taskDriverPath)) {
    Invoke-WebRequest $taskDriverFile.url -OutFile "$taskDriverPath.part"
    if ((Get-FileHash -LiteralPath "$taskDriverPath.part" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskDriverFile.sha256) { throw 'JDBC 测试制品摘要不符' }
    Move-Item -LiteralPath "$taskDriverPath.part" -Destination $taskDriverPath
  }
  if ((Get-FileHash -LiteralPath $taskDriverPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskDriverFile.sha256) { throw '已有 JDBC 测试制品摘要不符' }
}
$taskBin=Join-Path $taskBase 'pgsql/bin'
if (!(Test-Path -LiteralPath "$taskBin/pg_ctl.exe")) {
  $taskZip=Join-Path $taskBase 'server.zip'
  if (!(Test-Path -LiteralPath $taskZip)) {
    Invoke-WebRequest 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616' -OutFile "$taskZip.part"
    Move-Item -LiteralPath "$taskZip.part" -Destination $taskZip
  }
  Expand-Archive -LiteralPath $taskZip -DestinationPath $taskBase -Force
  $taskDownload = Get-FileHash -LiteralPath $taskZip -Algorithm SHA256 | Select-Object Algorithm,Hash | ConvertTo-Json
  [IO.File]::WriteAllText("$taskBase/download.json", $taskDownload, [Text.UTF8Encoding]::new($false))
}
$taskData=Join-Path $taskBase 'data'
$taskCredential=Join-Path $taskBase 'credentials.json'
if (!(Test-Path -LiteralPath $taskCredential)) {
  $taskInitialCredential = @{host='127.0.0.1';port=$Port;user='postgres';password=[Guid]::NewGuid().ToString('N');version='17.11'} | ConvertTo-Json
  [IO.File]::WriteAllText($taskCredential, $taskInitialCredential, [Text.UTF8Encoding]::new($false))
}
$taskConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath $taskCredential | ConvertFrom-Json
if ($taskConfig.port -ne $Port) { throw '隔离实例端口与已有资料不一致' }
if (!(Test-Path -LiteralPath "$taskData/PG_VERSION")) {
  $taskPasswordFile=Join-Path $taskBase 'init-password.txt'
  [IO.File]::WriteAllText($taskPasswordFile,$taskConfig.password,[Text.UTF8Encoding]::new($false))
  try {
    & "$taskBin/initdb.exe" '-D' $taskData '-U' 'postgres' '-E' 'UTF8' '--locale=C' '--auth=scram-sha-256' "--pwfile=$taskPasswordFile"
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 初始化失败' }
  } finally { Remove-Item -LiteralPath $taskPasswordFile -Force }
  Add-Content -LiteralPath "$taskData/postgresql.conf" -Value "`nlisten_addresses='127.0.0.1'`nport=$Port`nmax_connections=30`n"
}
if (Test-Path -LiteralPath "$taskData/postmaster.pid") {
  & "$taskBin/pg_ctl.exe" 'status' '-D' $taskData
  if ($LASTEXITCODE -eq 0) { return }
  throw '存在未确认的 PostgreSQL PID 文件，请核对隔离实例'
}
$taskGit=(Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
$taskOpenSsl=if ($env:DB_ALIGNER_OPENSSL) { $env:DB_ALIGNER_OPENSSL } else { Join-Path (Split-Path -Parent (Split-Path -Parent $taskGit)) 'usr/bin/openssl.exe' }
if (!(Test-Path -LiteralPath $taskOpenSsl)) { throw 'SSL 回归需要 OpenSSL，请设置 DB_ALIGNER_OPENSSL' }
if (!(Test-Path -LiteralPath "$taskBase/client.p12")) {
  function Invoke-TestOpenSsl([string[]]$Arguments) {
    & $taskOpenSsl @Arguments 2>> "$taskBase/openssl.log"
    if ($LASTEXITCODE -ne 0) { throw '隔离 SSL 测试证书生成失败' }
  }
  Invoke-TestOpenSsl @('req','-x509','-newkey','rsa:2048','-nodes','-keyout',"$taskBase/ca-key.pem",'-out',"$taskBase/ca.pem",'-days','30','-subj','/CN=DBAligner isolated test CA')
  Invoke-TestOpenSsl @('req','-newkey','rsa:2048','-nodes','-keyout',"$taskBase/server-key.pem",'-out',"$taskBase/server.csr",'-subj','/CN=localhost')
  [IO.File]::WriteAllText("$taskBase/server.ext","subjectAltName=DNS:localhost,IP:127.0.0.1`nextendedKeyUsage=serverAuth`n")
  Invoke-TestOpenSsl @('x509','-req','-in',"$taskBase/server.csr",'-CA',"$taskBase/ca.pem",'-CAkey',"$taskBase/ca-key.pem",'-CAcreateserial','-out',"$taskBase/server-cert.pem",'-days','30','-extfile',"$taskBase/server.ext")
  Invoke-TestOpenSsl @('req','-newkey','rsa:2048','-nodes','-keyout',"$taskBase/client-key.pem",'-out',"$taskBase/client.csr",'-subj','/CN=postgres')
  Invoke-TestOpenSsl @('x509','-req','-in',"$taskBase/client.csr",'-CA',"$taskBase/ca.pem",'-CAkey',"$taskBase/ca-key.pem",'-CAcreateserial','-out',"$taskBase/client-cert.pem",'-days','30')
  $taskCertificatePassword=[Guid]::NewGuid().ToString('N')
  $taskPasswordFile=Join-Path $taskBase 'certificate-password.txt'
  [IO.File]::WriteAllText($taskPasswordFile,$taskCertificatePassword)
  try { Invoke-TestOpenSsl @('pkcs12','-export','-name','user','-in',"$taskBase/client-cert.pem",'-inkey',"$taskBase/client-key.pem",'-certfile',"$taskBase/ca.pem",'-out',"$taskBase/client.p12",'-passout',"file:$taskPasswordFile") } finally { Remove-Item -LiteralPath $taskPasswordFile -Force }
  $taskConfig | Add-Member -NotePropertyName certificatePassword -NotePropertyValue $taskCertificatePassword -Force
  [IO.File]::WriteAllText($taskCredential, ($taskConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
$taskSslBase=$taskBase.Replace('\','/').Replace("'","''")
Add-Content -LiteralPath "$taskData/postgresql.conf" -Value "`nssl=on`nssl_cert_file='$taskSslBase/server-cert.pem'`nssl_key_file='$taskSslBase/server-key.pem'`nssl_ca_file='$taskSslBase/ca.pem'`n"
# pg_ctl 使用隐藏窗口启动，避免在用户桌面留下后台控制台。
$taskProcess=Start-Process -FilePath "$taskBin/pg_ctl.exe" -ArgumentList @('start','-D',('"'+$taskData+'"'),'-l',('"'+$taskBase+'/server.log"'),'-w','-t','60') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$taskBase/start.log" -RedirectStandardError "$taskBase/start-error.log"
if (!$taskProcess.WaitForExit(60000)) { throw 'PostgreSQL 启动超时，请查看隔离实例日志' }
if ($taskProcess.ExitCode -ne 0) { throw 'PostgreSQL 启动失败，请查看隔离实例日志' }
Write-Output "Started isolated PostgreSQL 17.11 on 127.0.0.1:$Port"
