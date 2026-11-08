# DBZS Gitea MCP Server

Der **DBZS Gitea MCP Server** stellt einen lokalen, policy-geschützten Adapter zwischen einem MCP-Client und der Gitea-REST-API unter `/api/v1` bereit. Phase 1 verwendet ausschließlich den stdio-Transport und ist deshalb für lokale MCP-Clients bestimmt. Der Server enthält keine HTTP-Listener und macht weder Gitea noch den MCP-Dienst im LAN oder Internet erreichbar.

> **Sicherheitsprinzip:** Der Server akzeptiert ausschließlich Repositories innerhalb von `GITEA_ALLOWED_OWNER`. Ein gültiger Token mit weitergehenden Rechten erweitert den über MCP erreichbaren Namespace nicht.

| Bereich | Umsetzung in Phase 1 |
| --- | --- |
| Laufzeit | Node.js 24 oder höher, TypeScript mit NodeNext-Modulen |
| MCP | Offizielles `@modelcontextprotocol/server` SDK v2 über stdio |
| Gitea | REST API `/api/v1` für Repositories, Inhalte und Actions |
| Authentifizierung | Ausschließlich Environment Variable `DBZS_HOME_API_TOKEN` |
| Namespace-Schutz | Verpflichtende Owner-Allowlist durch `GITEA_ALLOWED_OWNER` |
| Observability | Strukturierte JSON-Ereignisse nach `stderr`; `stdout` bleibt MCP vorbehalten |

## Voraussetzungen

Es werden **Node.js 24 oder höher**, eine erreichbare Gitea-Instanz mit aktivierten benötigten Actions-Funktionen sowie ein Gitea Personal Access Token mit minimal erforderlichen Berechtigungen benötigt. Der Dienst verlangt keinen Gitea-Admin- oder `sudo`-Token. Die Implementierung verwendet das offizielle MCP TypeScript SDK v2 mit Zod-v4-Schemas, wie von dessen Dokumentation vorgesehen.[1]

Für das manuelle Starten aus PowerShell muss der Token im **Prozesskontext** verfügbar sein. Der Token wird weder aus `.env` gelesen noch in Dateien, Logs, Tool-Antworten oder dieser Dokumentation ausgegeben. Wenn `DBZS_HOME_API_TOKEN` im Benutzer- oder Maschinenkontext gesetzt wurde, muss die aufrufende Anwendung gegebenenfalls nach dem Setzen der Variable neu gestartet werden, damit sie die Variable an den Node-Prozess weitergibt.

## Konfiguration

Kopieren Sie zunächst `.env.example` als Konfigurationsreferenz. Die Datei enthält absichtlich **kein** Secret und wird nicht vom Server eingelesen. Setzen Sie die erforderlichen Variablen stattdessen im Prozesskontext Ihres MCP-Clients oder in einer dafür vorgesehenen Windows-Dienstkonfiguration.

| Variable | Erforderlich | Zweck |
| --- | --- | --- |
| `DBZS_HOME_API_TOKEN` | Ja | Gitea Personal Access Token; wird ausschließlich im Arbeitsspeicher verwendet |
| `GITEA_BASE_URL` | Ja | Basis-URL der Gitea-Instanz, beispielsweise `http://127.0.0.1:3000`; ohne `/api/v1` |
| `GITEA_ALLOWED_OWNER` | Ja | Exakt ein erlaubter Benutzer- oder Organisationsnamespace, beispielsweise `devdbzemusic` |
| `GITEA_TOKEN` | Nein | Ausschließlich kompatibler Legacy-Fallback; `DBZS_HOME_API_TOKEN` hat immer Vorrang |

Das folgende Beispiel setzt die Konfiguration **nur für die aktuelle PowerShell-Sitzung**. Den Platzhalter für den Token ersetzen Sie lokal; er darf nicht in Skripten oder in Versionsverwaltung landen.

```powershell
$env:GITEA_BASE_URL = "http://127.0.0.1:3000"
$env:GITEA_ALLOWED_OWNER = "devdbzemusic"
$env:DBZS_HOME_API_TOKEN = "<GITEA_PERSONAL_ACCESS_TOKEN>"
```

## Installation und lokaler Start

Die folgenden Befehle sind Windows-first formuliert und werden im Projektordner ausgeführt. `npm run typecheck` prüft die gesamte TypeScript-Implementierung ohne Ausgabe zu erzeugen. `npm test` baut das Projekt und führt die deterministischen Unit-Tests aus.

```powershell
Set-Location E:\GitHub\dbzs-gitea-mcp
npm install
npm run typecheck
npm test
npm start
```

Bei fehlender Pflichtkonfiguration beendet sich der Prozess kontrolliert mit Exit-Code `1`, schreibt die sichere Fehlerbeschreibung nach `stderr` und lässt `stdout` frei. Bei erfolgreichem Start bleibt der Prozess aktiv und wartet auf MCP-Nachrichten über stdio. Dies ist für lokale Prozesse vorgesehen; ein Netzwerklistener wird in Phase 1 bewusst nicht gestartet.[1]

## MCP-Client-Konfiguration

Ein lokaler MCP-Client kann den gebauten Server beispielsweise mit der folgenden Prozessdefinition starten. Passen Sie den absolut angegebenen Pfad an den tatsächlichen Projektstand an. Übergeben Sie **nie** den Token in Klartext in eine geteilte Client-Konfigurationsdatei; bevorzugen Sie die bereits im aufrufenden Prozess gesetzte `DBZS_HOME_API_TOKEN`-Variable.

```json
{
  "mcpServers": {
    "dbzs-gitea": {
      "command": "node",
      "args": ["E:\\GitHub\\dbzs-gitea-mcp\\dist\\index.js"],
      "env": {
        "GITEA_BASE_URL": "http://127.0.0.1:3000",
        "GITEA_ALLOWED_OWNER": "devdbzemusic"
      }
    }
  }
}
```

## Verfügbare MCP-Tools

Die Read-Tools führen keine Gitea-Mutation aus und tragen die Annotation `readOnlyHint: true`. Alle Write-Tools verlangen zwingend den Booleschen Parameter `confirm: true`; ohne diesen Parameter verwirft die Eingabevalidierung den Aufruf vor dem Gitea-Request, und sie tragen `destructiveHint: true`. Jede repositorybezogene Operation prüft den übergebenen `owner` gegen `GITEA_ALLOWED_OWNER`, bevor eine Netzwerkverbindung aufgebaut wird. Die Toolregistrierung ist nach Kategorie in `src/tools/*.ts` aufgeteilt (`src/tools/shared.ts` leitet die Annotationen mechanisch aus der `confirm`-Konvention ab).

Insgesamt sind **26 Kern-Tools immer registriert**. Optional kommen 2 lokale Webhook-Tools, 5 Fleet-Commander-Tools und 9 lokale Workspace-Tools hinzu. Damit sind je nach Environment-Variablen maximal **42 Tools** registriert.

### Repositories und Inhalte (`src/tools/repositories.ts`)

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `gitea_list_repositories` | Read | Listet für den Token sichtbare Repositories und filtert sie auf den erlaubten Owner |
| `gitea_get_repository` | Read | Liest Metadaten eines Repositorys |
| `gitea_get_contents` | Read | Liest eine Datei oder einen Verzeichnisinhalt; unterstützt optional `ref` |

### Branches und Commits (`src/tools/branches-commits.ts`)

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `gitea_list_branches` | Read | Listet Branches inklusive Schutz- und Head-Commit-Metadaten |
| `gitea_get_branch` | Read | Liest einen einzelnen Branch |
| `gitea_list_commits` | Read | Listet Commits, optional gefiltert nach `ref`/`path` |
| `gitea_get_commit` | Read | Liest Metadaten eines einzelnen Commits |

### Pull Requests und Issues (`src/tools/pull-requests-issues.ts`)

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `gitea_list_pull_requests` | Read | Listet Pull Requests mit Status- und Zielbranchfilter |
| `gitea_get_pull_request` | Read | Liest Details eines Pull Requests |
| `gitea_list_issues` | Read | Listet Issues (ohne Pull Requests) mit Status- und Volltextfilter |
| `gitea_get_issue` | Read | Liest Details eines Issues |

### Actions: Workflows, Runs, Jobs, Runner (`src/tools/actions.ts`)

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `gitea_list_workflows` | Read | Listet Gitea-Actions-Workflows mit Paginierung |
| `gitea_list_workflow_runs` | Read | Listet Workflow-Runs; optional auf `workflowId` eingeschränkt |
| `gitea_dispatch_workflow` | Write, `confirm: true` | Löst einen Workflow mit `ref` und String-Inputs aus |
| `gitea_rerun_workflow` | Write, `confirm: true` | Startet einen vollständigen erneuten Lauf eines Workflow-Runs |
| `gitea_list_workflow_jobs` | Read | Listet die Jobs eines Workflow-Runs |
| `gitea_get_workflow_job_log` | Read | Liest ein Job-Log als lokal begrenzten Text |
| `gitea_list_runners` | Read | Listet für ein Repository sichtbare Actions-Runner |
| `gitea_get_runner` | Read | Liest Details eines einzelnen Runners |

Für Dispatch wird Giteas Endpoint `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` mit `return_run_details=true` verwendet. Bei Unterstützung durch die Gitea-Instanz enthält die Antwort damit die Run-ID sowie API- und HTML-URLs.[2] Ein Rerun verwendet `/repos/{owner}/{repo}/actions/runs/{run}/rerun`; Gitea dokumentiert dafür eine neue Workflow-Run-Antwort mit HTTP `201`.[3]

### Artifacts, Releases und Packages (`src/tools/artifacts-releases.ts`, `src/tools/packages.ts`)

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `gitea_list_artifacts` | Read | Listet Artifact-Metadaten eines Repositorys oder Runs, ohne Download |
| `gitea_get_artifact` | Read | Liest Metadaten eines einzelnen Artifacts |
| `gitea_list_releases` | Read | Listet Release-Metadaten inklusive sicherer Asset-Metadaten |
| `gitea_list_release_assets` | Read | Listet Asset-Metadaten und Download-URLs eines Releases |
| `gitea_list_packages` | Read | Listet ownerbasierte Package-Registry-Metadaten |
| `gitea_list_package_versions` | Read | Listet Versionen eines Packages |

### Webhooks (`src/tools/webhooks.ts`)

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `gitea_list_webhooks` | Read | Listet gesäuberte Hook-Metadaten (Secrets nie enthalten) |
| `gitea_create_local_webhook` *(optional)* | Write, `confirm: true` | Erstellt einen Hook ausschließlich für den konfigurierten lokalen Receiver |
| `gitea_delete_local_webhook` *(optional)* | Write, `confirm: true` | Entfernt ausschließlich einen Hook mit lokaler Zieladresse |

Die beiden optionalen Webhook-Tools erscheinen nur, wenn `GITEA_WEBHOOK_SECRET` und `GITEA_WEBHOOK_TARGET_URL` gemeinsam gesetzt sind.

### DBZS Fleet Commander Integration (`src/tools/fleet-commander.ts`, optional)

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `dbzs_get_fleet_health` | Read | Healthstatus der lokalen Fleet Commander Control Plane |
| `dbzs_get_fleet_dashboard` | Read | Dashboard-Projektion von Fleet Commander |
| `dbzs_get_fleet_operating_status` | Read | Commissioning-/Production-/Maintenance-Status |
| `dbzs_list_fleet_services` | Read | Ready-Service-Projektionen |
| `dbzs_list_fleet_events` | Read | Jüngste Fleet-Commander-Ereignisse |

Erscheint nur, wenn `DBZS_FLEET_API_URL` gesetzt ist.


## Betrieb, Fehlerbehandlung und Logs

Im HTTP-Modus (`MCP_TRANSPORT=http`) stellt der Server zusätzlich zu `/mcp` drei Betriebsendpunkte bereit, die denselben Host- und Origin-Guards unterliegen:

| Endpunkt | Methode | Antwort |
| --- | --- | --- |
| `/health` | GET | `{ "service": "dbzs-gitea-mcp", "status": "healthy" }`, sobald der Listener aktiv ist. Kein Fremdsystem-Aufruf. |
| `/ready` | GET | `{ "service": "dbzs-gitea-mcp", "status": "ready", "version": "...", "tools": <Anzahl> }`, ebenfalls ohne Fremdsystem-Aufruf — geeignet für häufiges lokales Prozessmonitoring. |
| `/version` | GET | `{ "service": "dbzs-gitea-mcp", "version": "..." }`, identisch mit der in `tools/list` gemeldeten MCP-Protokollversion und `package.json`. |

Der EventBus veröffentlicht relevante Runtime-, Policy-, MCP- und Gitea-Request-Ereignisse. Ein `StderrLogger` schreibt diese als einzelne JSON-Zeilen nach `stderr`. Dies gewährleistet, dass `stdout` ausschließlich dem MCP-stdio-Protokoll vorbehalten bleibt. Logs enthalten keine Tokenwerte. API-Fehler enthalten HTTP-Status, relativen API-Pfad und eine auf maximal 500 Zeichen begrenzte Gitea-Fehlermeldung.

Fehler werden nicht verschluckt. Eine abgelehnte Owner-Policy, fehlende Konfiguration, Netzwerkfehler, ungültige JSON-Antworten und nicht erfolgreiche Gitea-HTTP-Status werden als strukturierte DBZS-Fehler sowohl protokolliert als auch als MCP-Toolfehler zurückgegeben.

## Qualitätsprüfung

| Prüfung | Befehl | Erwartetes Ergebnis |
| --- | --- | --- |
| Statische Typprüfung | `npm run typecheck` | Erfolgreiche Prüfung gegen MCP SDK v2 und Zod v4 |
| Build | `npm run build` | JavaScript, Deklarationen und Source Maps unter `dist/` |
| Unit-Tests | `npm test` | Tests für Tokenpriorität, Konfigurationsfehler, Owner-Policy, Dispatch und Rerun |
| Start ohne Secrets | `node dist/index.js` | Exit-Code `1`, sichere Fehlermeldung nach `stderr`, keine Ausgabe nach `stdout` |

## Geplanter Ausbau

Phase 2 ergänzt einen auf `127.0.0.1` beschränkten Streamable-HTTP-Transport unter `/mcp` sowie Branches, Commits, Pull Requests, Issues, Workflow-Jobs und Logs, Runner-Status und Artifacts. Ein späterer LAN- oder Remote-Betrieb erfordert zusätzlich Authentifizierung, TLS, Origin-Prüfung und eine explizite Allowlist. Phase 3 umfasst Releases, Package Registry, Webhooks, die optionale Fleet-Commander-Integration.

Zur Anbindung an ChatGPT/OpenAI über den OpenAI Secure MCP Tunnel siehe `docs/OPENAI_MCP_CONNECTION.md` — der Server ist dafür bereits vorbereitet (`/health`, `/ready`, `/version`, Tool-Annotationen); die eigentliche Tunnel-Einrichtung erfordert manuelle Schritte im OpenAI-Dashboard.

## Referenzen

[1]: https://github.com/modelcontextprotocol/typescript-sdk "Offizielles MCP TypeScript SDK v2"
[2]: https://docs.gitea.com/api/operations/actions-dispatch-workflow/ "Gitea API: Create a workflow dispatch event"
[3]: https://docs.gitea.com/api/operations/rerun-workflow-run/ "Gitea API: Reruns an entire workflow run"


## Lokale Coding-Workspace-Brücke (optional)

Aktivierung ausschließlich über `DBZS_WORKSPACE_ROOT`, das auf einen existierenden Projektordner zeigen muss. Absolute Pfade und Traversal außerhalb des Roots werden abgewiesen; Listing überspringt Symlinks, `.git` und `node_modules`. Dateioperationen sind auf UTF-8 und 1 MB begrenzt.

| Tool | Zweck | Policy |
| --- | --- | --- |
| `workspace_list`, `workspace_read_file` | Workspace-Inhalte lesen | Read-only |
| `workspace_write_file` | Datei schreiben | `confirm: true` |
| `workspace_git_status`, `workspace_git_diff`, `workspace_git_log` | Git-Status, Diff und Historie | Read-only |
| `workspace_run_process` | Prozess ohne Shell starten | `confirm: true`, Executable-Allowlist |
| `workspace_poll_process` | Prozessstatus und begrenzte Ausgabe lesen | Read-only |
| `workspace_stop_process` | Gestarteten Prozess beenden | `confirm: true` |

Prozesse sind auf acht gleichzeitige Instanzen und 100.000 Zeichen Output begrenzt. Beendete Prozessdatensätze werden begrenzt aufbewahrt; beim Runtime-Shutdown werden laufende Kindprozesse beendet. Die erlaubten Executables werden über `DBZS_PROCESS_ALLOWLIST` gesetzt (Standard: git,node,npm,python,py,pwsh). **Wichtig:** `shell: false` verhindert Shell-String-Ausführung, ist aber keine Betriebssystem-Sandbox. Ein freigegebenes Programm kann weiterhin mit den Rechten des MCP-Benutzerkontos auf Dateien, Netzwerk und andere Ressourcen zugreifen. Für sensible Projekte sollte die Allowlist deshalb auf tatsächlich benötigte Programme reduziert werden. Der MCP-Prozess sollte unter einem normalen Windows-Benutzerkonto laufen.

Die Dateioperationen lehnen symbolische Links und Sonderdateien ab und prüfen die Dateiidentität beim Öffnen erneut. Das reduziert Pfad-Austauschrisiken; gegen einen gleichzeitig unter demselben Windows-Benutzer laufenden, aktiv manipulierenden Prozess bietet Node.js jedoch keine vollständig race-freie Verzeichnis-FD-Sandbox. Der Workspace ist eine Anwendungsgrenze für den normalen lokalen Entwicklungsbetrieb, keine Sicherheitsgrenze gegenüber gleichberechtigten lokalen Prozessen.
