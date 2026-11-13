# Create a portable ZIP with forward-slash entry names (Windows PowerShell 5.1 compatible).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path (Split-Path -Parent $root) 'dbzs-developer-private.zip'
$entries = @(
  'plugin.json',
  'skills/dbzs-developer/SKILL.md',
  'README.md',
  'SECURITY.md',
  'INSTALL_PRIVATE.md',
  'test-connection.ps1'
)
$null = Get-Content -Raw (Join-Path $root 'plugin.json') | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($entry in $entries) {
  if ($entry -match '\\.\\.' -or $entry.StartsWith('/') -or $entry.Contains('\\')) {
    throw "Unsafe ZIP path: $entry"
  }
  $file = Join-Path $root ($entry.Replace('/', [IO.Path]::DirectorySeparatorChar))
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing file: $entry" }
}
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
$zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($entry in $entries) {
    $file = Join-Path $root ($entry.Replace('/', [IO.Path]::DirectorySeparatorChar))
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $file, $entry, [IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally { $zip.Dispose() }
$verify = [IO.Compression.ZipFile]::OpenRead($out)
try {
  $names = @($verify.Entries | ForEach-Object { $_.FullName })
  if (@($names | Where-Object { $_.Contains('\\') -or $_.StartsWith('/') -or $_ -match '(^|/)\\.\\.(/|$)' }).Count -gt 0) {
    throw 'ZIP contains unsafe entry names.'
  }
  if (@($names).Count -ne $entries.Count) { throw 'Unexpected ZIP entry count.' }
} finally { $verify.Dispose() }
Write-Host "Created and verified: $out"
