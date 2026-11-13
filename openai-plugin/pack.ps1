# Build a private portable plugin ZIP, excluding secrets and runtime sources.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path $root 'plugin.json'
$skill = Join-Path $root 'skills\dbzs-developer\SKILL.md'
if (!(Test-Path $manifest) -or !(Test-Path $skill)) { throw 'Plugin manifest or skill missing.' }
$null = Get-Content -Raw $manifest | ConvertFrom-Json
$out = Join-Path (Split-Path -Parent $root) 'dbzs-developer-private.zip'
if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
$staging = Join-Path $env:TEMP ('dbzs-plugin-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $staging 'skills\dbzs-developer') | Out-Null
  Copy-Item $manifest $staging
  Copy-Item $skill (Join-Path $staging 'skills\dbzs-developer')
  Copy-Item (Join-Path $root 'README.md') $staging
  Copy-Item (Join-Path $root 'SECURITY.md') $staging
  Copy-Item (Join-Path $root 'INSTALL_PRIVATE.md') $staging
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $out
  Write-Host "Created: $out"
} finally {
  if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
