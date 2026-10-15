$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$taskTarget = [IO.Path]::GetFullPath((Join-Path $taskRoot 'release'))
if (!$taskTarget.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw '发布目录不在项目内'
}
if (Test-Path -LiteralPath $taskTarget) {
  $taskItem = Get-Item -LiteralPath $taskTarget -Force
  if (($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '发布目录不能是链接' }
  if (!$taskItem.PSIsContainer) { throw '发布路径不是文件夹' }
  Remove-Item -LiteralPath $taskTarget -Recurse -Force
}
New-Item -ItemType Directory -Path $taskTarget | Out-Null
