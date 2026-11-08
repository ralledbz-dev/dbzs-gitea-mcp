# DBZS Gitea MCP Server – Anbindung an ChatGPT/OpenAI über den Secure MCP Tunnel

Dieses Dokument beschreibt, wie der bestehende lokale DBZS Gitea MCP Server (ausschließlich gebunden an
`127.0.0.1`) über OpenAIs **Secure MCP Tunnel** für ChatGPT erreichbar gemacht werden kann, ohne die
Local-First-Sicherheitsgrenzen dieses Servers zu verändern.

> **Aktueller Stand:** Dieser Server ist "tunnel-bereit" (Health-/Ready-/Version-Endpunkte, MCP-Tool-Annotationen).
> Die eigentliche Tunnel-Verbindung erfordert einen von OpenAI bereitgestellten `tunnel-client`-Prozess und
> Zugangsdaten aus dem OpenAI-Dashboard, die nicht Teil dieses Repositories sind und manuell eingerichtet werden
> müssen. `scripts\start-openai-tunnel.ps1` ist bewusst nur ein Vorbereitungs-Check, kein fertiger Tunnel-Starter.

## Zielarchitektur

```text
ChatGPT / OpenAI
        │
        │ MCP / HTTPS
        ▼
OpenAI Secure MCP Tunnel Endpoint
        ▲
        │ ausschliesslich ausgehende HTTPS-Verbindung (Port 443)
        │
DBZS tunnel-client (Windows, von OpenAI bereitgestellt)
        │
        │ localhost
        ▼
http://127.0.0.1:3939/mcp
DBZS Gitea MCP Server
```

Der DBZS-Server selbst öffnet **keinen** öffentlichen Port und ändert seine Bindung nicht. Der Tunnel-Client baut
ausschließlich eine ausgehende Verbindung zu OpenAI auf; es ist keine Portfreigabe am Router und kein öffentlich
erreichbarer MCP-Port nötig.

## Voraussetzungen

| ChatGPT-Tarif (Stand siehe OpenAI-Dokumentation) | MCP-Unterstützung |
| --- | --- |
| Business | Vollständiger MCP-Support |
| Enterprise / Edu | Vollständiger MCP-Support |
| Pro | MCP mit Read/Fetch im Developer Mode |
| Plus | Aktuell kein vollständiger Custom-MCP-Zugriff |

Der Server kann unabhängig vom eigenen ChatGPT-Tarif bereits jetzt vollständig MCP-kompatibel und tunnel-fähig
betrieben werden. Ohne einen unterstützten Tarif lässt sich derselbe Server bereits heute anderweitig nutzen
(Codex lokal, OpenAI Responses API, Agents SDK) — es entsteht keine Übergangslösung.

## Manuelle Einrichtung

1. Lokalen Server im HTTP-Modus starten: `scripts\start-mcp.ps1 -Http` (Standardport `3939`).
2. Bereitschaft prüfen: `scripts\start-openai-tunnel.ps1` — meldet `/health` und `/ready`, bevor irgendein
   Tunnel-Schritt sinnvoll ist.
3. In der OpenAI Platform: **Secure MCP Tunnel** anlegen, `tunnel_id` notieren, Runtime-API-Key erzeugen.
4. Secrets ausschließlich über Environment Variables bereitstellen, niemals in Dateien, JSON-Konfiguration oder
   Logs:
   ```powershell
   $env:OPENAI_API_KEY = "..."
   $env:DBZS_MCP_TUNNEL_ID = "..."
   $env:DBZS_MCP_LOCAL_URL = "http://127.0.0.1:3939/mcp"
   ```
5. Den von OpenAI bereitgestellten `tunnel-client`-Prozess gemäß dessen eigener Dokumentation mit
   `DBZS_MCP_LOCAL_URL` als lokalem Ziel starten.
6. In ChatGPT: Settings → Apps → Advanced Settings / Developer Mode → Create App / MCP → Secure MCP Tunnel
   auswählen → Tools scannen → App erstellen. OpenAI ruft dabei `tools/list` auf und sollte alle unten
   dokumentierten Tools samt Annotationen erkennen.

## Sicherheitsgrenzen (unverändert)

- Listener ausschließlich auf `127.0.0.1`, Host- und Origin-Guards bleiben für `/mcp`, `/health`, `/ready` und
  `/version` gleichermaßen aktiv.
- Owner-Allowlist (`GITEA_ALLOWED_OWNER`), Repository-Policy und Path-Sandbox bleiben unverändert im
  Gitea-Client verankert.
- Keine beliebigen Shell-Kommandos, keine beliebigen Dateisystempfade.
- Write-Tools bleiben durch `confirm: true` von Read-Tools getrennt; jedes Tool trägt dazu passende
  `readOnlyHint`/`destructiveHint`/`idempotentHint`-Annotationen (siehe `src/tools/shared.ts#buildAnnotations`).
- `DBZS_HOME_API_TOKEN` wird nie in Dateien, Logs oder Tool-Antworten ausgegeben.

## Abnahmetests vor der Verbindung zu OpenAI

```text
[ ] Bind nur auf 127.0.0.1
[ ] initialize
[ ] tools/list liefert 26 Basis-Tools (plus optionale Phase-3-Tools je nach Konfiguration)
[ ] Jedes Tool traegt readOnlyHint/destructiveHint/idempotentHint passend zu seiner confirm-Konvention
[ ] tools/call read (z. B. gitea_list_repositories)
[ ] tools/call write (z. B. gitea_dispatch_workflow mit confirm: true)
[ ] GET /health liefert 200 { status: "healthy" }
[ ] GET /ready liefert 200 { status: "ready", version, tools }
[ ] GET /version liefert dieselbe Version wie package.json
[ ] Host Guard
[ ] Origin Guard
[ ] Owner Allowlist
[ ] Repository Allowlist
[ ] Path Sandbox
[ ] Unbekannte Route = 404 (weiterhin inklusive /health, /ready, /version bei falscher Methode = 405)
[ ] Tunnel kann localhost erreichen
[ ] OpenAI Tool Scan erkennt alle erwarteten Tools
```

Die vollständige, praktische Tool-für-Tool-Testanleitung befindet sich in
`DBZS_Gitea_MCP_Live_Smoke_Test.md`.

## Warum kein Cloudflare/ngrok/öffentliches Forwarding

Für DBZS bleibt die lokale Architektur `DBZS MCP 127.0.0.1:3939` + `OpenAI Secure MCP Tunnel` die empfohlene Kombination: sie erhält die Local-First-Architektur und ermöglicht
OpenAI-Zugriff, ohne den MCP-Server selbst öffentlich freizugeben.

## Quellen

- OpenAI Help Center: Developer mode and MCP apps in ChatGPT
- OpenAI Developers: Secure MCP Tunnel
- OpenAI Developers: Building MCP servers for plugins and API integrations


## Lokale Workspace-Tools

Die optionalen Workspace-Tools erscheinen nur bei gesetztem `DBZS_WORKSPACE_ROOT`. Der Root sollte genau den benötigten Projektordner umfassen, niemals eine gesamte Laufwerkswurzel. Prozessstarts benötigen zusätzlich `confirm: true` und eine Executable aus `DBZS_PROCESS_ALLOWLIST`; der HTTP-Listener bleibt ausschließlich auf Loopback.
