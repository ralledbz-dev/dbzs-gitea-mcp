# Install generated PNG into repository and commit it on the feature branch.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$IconPath)
$ErrorActionPreference='Stop'
$repo = (git rev-parse --show-toplevel 2>$null)
if (!$repo) { throw 'Run inside the dbzs-gitea-mcp Git checkout.' }
$branch=(git branch --show-current).Trim()
if ($branch -ne 'feature/private-openai-plugin-2026-11-13') { throw "Wrong branch: $branch" }
if (!(Test-Path -LiteralPath $IconPath -PathType Leaf)) { throw "Icon missing: $IconPath" }
$target=Join-Path $repo 'openai-plugin\assets\dbzs-developer-plugin-icon.png'
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
Copy-Item -LiteralPath $IconPath -Destination $target -Force
$bytes=[IO.File]::ReadAllBytes($target)
if ($bytes.Length -lt 24 -or [BitConverter]::ToString($bytes,0,8) -ne '89-50-4E-47-0D-0A-1A-0A') { throw 'Invalid PNG signature' }
git add -- openai-plugin/assets/dbzs-developer-plugin-icon.png
git commit -m 'assets(plugin): add DBZS Developer MCP app icon'
if ($LASTEXITCODE -ne 0) { throw 'Git commit failed' }
git push -u origin $branch
if ($LASTEXITCODE -ne 0) { throw 'Git push failed' }
Write-Host 'Icon committed and pushed.'
