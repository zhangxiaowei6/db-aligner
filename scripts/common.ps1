function Get-DBAlignerHash([string]$LiteralPath,[ValidateSet('SHA256','SHA512')][string]$Algorithm='SHA256') {
 $taskHasher=if ($Algorithm -eq 'SHA256') { [Security.Cryptography.SHA256]::Create() } else { [Security.Cryptography.SHA512]::Create() }
 $taskStream=[IO.File]::OpenRead($LiteralPath)
 try { return [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-','').ToLowerInvariant() } finally { $taskStream.Dispose();$taskHasher.Dispose() }
}
function Assert-DBAlignerToolPath([string]$Path,[string]$Root) {
 $taskResolved=[IO.Path]::GetFullPath($Path)
 $taskBoundary=[IO.Path]::GetFullPath($Root).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 if (!$taskResolved.StartsWith($taskBoundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Tool path leaves the intended project tools directory' }
}
