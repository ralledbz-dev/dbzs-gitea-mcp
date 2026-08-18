param(
  [string]$LocalMcpUrl = "http://127.0.0.1:3939",
  [int]$TimeoutSeconds = 10
)
$ErrorActionPreference = "Stop"

# PLATZHALTER — startet KEINEN echten OpenAI Secure MCP Tunnel-Client.
#
# Warum: Der eigentliche tunnel-client-Prozess wird von OpenAI ueber das OpenAI-Dashboard
# bereitgestellt (Tunnel anlegen, tunnel_id + Runtime-API-Key erzeugen, Client herunterladen).
# Ohne verifizierte Zugangsdaten und ohne zu wissen, in welcher Form OpenAI den Client aktuell
# ausliefert (Binary oder npm-Paket), wuerde ein hier hart kodierter Aufruf entweder nicht
# funktionieren oder unbemerkt veralten. Siehe docs\OPENAI_MCP_CONNECTION.md fuer die manuellen
# Schritte im OpenAI-Dashboard.
#
# Was dieses Skript stattdessen tut: pruefen, dass der lokale MCP-Server ueberhaupt bereit ist
# (die Voraussetzung fuer jeden Tunnel-Client), und die naechsten manuellen Schritte ausgeben.

Write-Host "==> Pruefe lokalen DBZS Gitea MCP Server unter $LocalMcpUrl" -ForegroundColor Cyan

try {
  $health = Invoke-RestMethod -Uri "$LocalMcpUrl/health" -TimeoutSec $TimeoutSeconds
  $ready = Invoke-RestMethod -Uri "$LocalMcpUrl/ready" -TimeoutSec $TimeoutSeconds
} catch {
  Write-Error "Lokaler MCP-Server unter $LocalMcpUrl nicht erreichbar. Starten Sie ihn zuerst mit MCP_TRANSPORT=http (z. B. scripts\start-mcp.ps1 -Http)."
  exit 1
}

Write-Host "Health: $($health.status)" -ForegroundColor Green
Write-Host "Ready:  $($ready.status), Version $($ready.version), $($ready.tools) Tools" -ForegroundColor Green

Write-Host ""
Write-Host "Naechste Schritte (manuell, ausserhalb dieses Skripts):" -ForegroundColor Yellow
Write-Host "  1. OpenAI Platform -> Secure MCP Tunnel -> neuen Tunnel anlegen, tunnel_id notieren."
Write-Host "  2. Runtime-API-Key erzeugen und ausschliesslich als Environment Variable setzen (z. B. `$env:OPENAI_API_KEY)."
Write-Host "  3. Den von OpenAI bereitgestellten tunnel-client so konfigurieren, dass er auf $LocalMcpUrl/mcp zeigt."
Write-Host "  4. Details und Sicherheitsgrenzen: docs\OPENAI_MCP_CONNECTION.md"
