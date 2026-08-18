# DBZS Gitea MCP Server – Implementationsplan

Stand: 2026-08-18

## Entscheidung

- Node.js 24 + TypeScript
- offizielles MCP TypeScript SDK v2
- Gitea REST API `/api/v1`
- Secrets ausschließlich über Environment Variables
- Phase 1: MCP stdio für lokale Clients
- Phase 2: MCP Streamable HTTP `/mcp`

## Architektur

```text
MCP Client
   |
   +-- stdio (lokal)
   |
   +-- Streamable HTTP /mcp (Phase 2)
             |
             v
      DBZS Gitea MCP
             |
      Policy / Validation
             |
             v
      Gitea /api/v1
       |      |      |
     Repos  Actions Releases
```

## Sicherheitsmodell

1. `GITEA_TOKEN` nur als EnvVar.
2. `GITEA_ALLOWED_OWNER` begrenzt den erlaubten Namespace.
3. Read- und Write-Tools werden getrennt.
4. Mutierende Tools verlangen explizit `confirm: true`.
5. Kein Gitea-Admin-/sudo-Token für den MCP-Dienst.
6. HTTP-Transport zunächst nur auf `127.0.0.1`.
7. LAN/Remote nur mit Auth, TLS, Origin-Prüfung und Allowlist.

## Phase 1 – im Starter enthalten

- Repository-Liste
- Repository-Metadaten
- Datei-/Verzeichnisinhalt
- Workflow-Liste
- Workflow-Runs
- Workflow Dispatch
- Workflow Rerun

## Phase 2

- Streamable HTTP `/mcp`
- Branches / Commits
- Pull Requests / Issues
- Workflow Jobs / Logs
- Runner Status
- Artifacts

## Phase 3

- Releases / Release Assets
- Package Registry
- Webhooks
- Fleet Commander / Feature Starter Integration
- DBZS Update-/Installer-Hooks

## ChatGPT-Anbindung

Ein auf `127.0.0.1` gebundener MCP-Server ist nur für lokale MCP-Clients erreichbar. Für direkten Zugriff eines Cloud-Clients muss ausschließlich der abgesicherte MCP-Gateway-Endpunkt erreichbar gemacht werden; die Gitea-Instanz selbst kann vollständig im LAN bleiben.
