$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> Typecheck" -ForegroundColor Cyan
npm run typecheck

Write-Host "==> Build + Tests" -ForegroundColor Cyan
npm test
