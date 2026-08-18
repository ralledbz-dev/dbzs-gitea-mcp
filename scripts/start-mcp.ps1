param(
  [switch]$Http,
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SkipBuild -and -not (Test-Path "dist\index.js")) {
  Write-Host "==> dist\index.js fehlt, baue das Projekt" -ForegroundColor Cyan
  npm run build
}

if ($Http) {
  $env:MCP_TRANSPORT = "http"
  Write-Host "Starte im HTTP-Loopback-Modus (Standardport 3939, ueberschreibbar via MCP_HTTP_PORT)." -ForegroundColor Cyan
} else {
  Write-Host "Starte im stdio-Modus (Standard, fuer lokale MCP-Clients)." -ForegroundColor Cyan
}

node dist\index.js
