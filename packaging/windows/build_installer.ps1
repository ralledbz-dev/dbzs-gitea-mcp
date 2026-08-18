param(
  [switch]$Clean,
  [switch]$Installer,
  [string]$ISCC = ""
)
$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$root = Split-Path -Parent (Split-Path -Parent $scriptDir)
Set-Location $root

if ($Clean) {
  Remove-Item -Recurse -Force dist, dist-package -ErrorAction SilentlyContinue
}

Write-Host "==> Installiere Abhaengigkeiten und baue das Projekt" -ForegroundColor Cyan
npm ci
npm run build

Write-Host "==> Staging: production-only Paket unter dist-package\" -ForegroundColor Cyan
Remove-Item -Recurse -Force dist-package -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force dist-package | Out-Null
Copy-Item package.json dist-package\
if (Test-Path package-lock.json) { Copy-Item package-lock.json dist-package\ }
Copy-Item -Recurse dist dist-package\dist

Push-Location dist-package
npm install --omit=dev --no-audit --no-fund
Pop-Location

Write-Host "==> Service-Helper (node-windows) kopieren" -ForegroundColor Cyan
Copy-Item -Recurse "$scriptDir\service" dist-package\service

Write-Host "Staging abgeschlossen:" -ForegroundColor Green
Get-ChildItem dist-package | Format-Table Name, LastWriteTime

if ($Installer) {
  if (-not $ISCC) {
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { $ISCC = $command.Source }
  }
  if (-not $ISCC) {
    $candidates = @(
      "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
      "$env:ChocolateyInstall\bin\ISCC.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }
    $ISCC = $candidates | Select-Object -First 1
  }
  if (-not $ISCC -or -not (Test-Path $ISCC)) {
    throw "Inno Setup 6 (ISCC.exe) nicht gefunden. Installieren Sie es oder uebergeben Sie -ISCC <Pfad>."
  }

  New-Item -ItemType Directory -Force dist\installer | Out-Null
  Write-Host "==> Kompiliere Installer mit $ISCC" -ForegroundColor Cyan
  & $ISCC "$scriptDir\dbzs-gitea-mcp.iss"
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup fehlgeschlagen mit Exit-Code $LASTEXITCODE" }

  Write-Host "Installer gebaut:" -ForegroundColor Green
  Get-ChildItem dist\installer -Filter *.exe | Format-Table Name, Length, LastWriteTime
}

Write-Host "Code-Signing ist bewusst extern: signieren Sie die erzeugte Setup-.exe vor der Weitergabe mit Ihrem Zertifikat." -ForegroundColor Yellow
