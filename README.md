# DBZS Gitea MCP Server

Der **DBZS Gitea MCP Server** ist ein lokaler, policy-geschützter Adapter zwischen MCP-Clients, der Gitea-REST-API und vorhandenen DBZS-Diensten. Die MCP-Schicht orchestriert ausschließlich Eingabe, Bestätigung und Ausgabe. Gitea-Requests, Webhook-Verifikation, Fleet-Commander-Zugriff, Feature-Starter-Health und Update-/Installer-Hooks sind jeweils in getrennten Services gekapselt.

> **Namespace-Grenze:** Jede repository- oder packagebezogene Anfrage akzeptiert ausschließlich den exakt in `GITEA_ALLOWED_OWNER` konfigurierten Namespace. Weitergehende Tokenrechte erweitern den MCP-Zugriff nicht.

| Bereich | Phase-3-Stand |
| --- | --- |
| Laufzeit | Node.js 24 oder höher, TypeScript im NodeNext-Modus |
| MCP | Offizielles MCP TypeScript SDK v2 mit Zod-v4-Schemas |
| Transporte | `stdio` als Standard sowie optionaler Streamable-HTTP-Endpunkt `/mcp` |
| HTTP-Bindung | Fest `127.0.0.1`; kein LAN- oder Internet-Listener |
| Gitea | Repository, Collaboration, Actions, Releases, Release Assets, Package Registry und Hook-Metadaten |
| Lokale Webhooks | Optionaler HMAC-SHA256-verifizierter Receiver unter `/webhooks/gitea` |
| DBZS-Integration | Read-only Fleet Commander v1, Feature-Starter-Plattformstatus sowie explizit freigegebene bestehende CLI-Hooks |
| Observability | Strukturierte DBZS-Ereignisse nach `stderr`; `stdout` bleibt für MCP reserviert |

## Voraussetzungen

Erforderlich sind eine aktuelle Node.js-Laufzeit, eine erreichbare Gitea-Instanz mit minimal notwendigen Tokenrechten sowie bei Nutzung der optionalen Integrationen ein lokaler DBZS Fleet Commander beziehungsweise DBZS Feature Starter. Der Token wird ausschließlich aus dem Prozesskontext gelesen; `.env` wird nicht eingelesen. `DBZS_HOME_API_TOKEN` wird stets gegenüber `GITEA_TOKEN` bevorzugt.

```powershell
Set-Location E:\GitHub\dbzs-gitea-mcp
npm ci
npm run typecheck
npm test
```

| Prüfung | Befehl | Erwartetes Ergebnis |
| --- | --- | --- |
| Strenge Typprüfung | `npm run typecheck` | Kompatible Node-, MCP-v2- und Zod-v4-Typen |
| Build | `npm run build` | Artefakte unter `dist/` |
| Tests | `npm test` | Gitea-, HTTP-, Webhook- und Integrationsverträge bestanden |
| Sichere Fehlkonfiguration | `node dist/index.js` ohne Token | Exit-Code `1`, stderr-Fehler, keine stdout-Ausgabe |
| Route | `GET /unbekannt` | `404` |
| Browser-Origin | Fremder Origin an `/mcp` | `403` vor MCP-Verarbeitung |
| Webhook-Methode | `GET /webhooks/gitea` bei Aktivierung | `405` |

## Basiskonfiguration

Die `.env.example` ist ausschließlich eine secretsfreie Referenz. Variablen gehören in die Umgebung des lokalen MCP-Clients oder eines kontrollierten Windows-Dienstprozesses.

| Variable | Erforderlich | Standard | Zweck |
| --- | --- | --- | --- |
| `DBZS_HOME_API_TOKEN` | Ja | – | Gitea Personal Access Token; nur im Arbeitsspeicher |
| `GITEA_BASE_URL` | Ja | – | Gitea-Basisadresse ohne `/api/v1`, etwa `http://127.0.0.1:3000` |
| `GITEA_ALLOWED_OWNER` | Ja | – | Ein erlaubter Gitea-User oder Organisationsnamespace |
| `MCP_TRANSPORT` | Nein | `stdio` | `stdio` oder `http` |
| `MCP_HTTP_PORT` | Bei HTTP nein | `3939` | Lokaler TCP-Port zwischen `1` und `65535` |
| `GITEA_TOKEN` | Nein | – | Kompatibilitätsfallback; `DBZS_HOME_API_TOKEN` gewinnt immer |

```powershell
$env:GITEA_BASE_URL = "http://127.0.0.1:3000"
$env:GITEA_ALLOWED_OWNER = "devdbzemusic"
$env:DBZS_HOME_API_TOKEN = "<LOKAL_SETZEN_NICHT_PERSISTIEREN>"
```

## stdio und lokaler Streamable HTTP

`stdio` bleibt der Standard und eignet sich für lokale MCP-Clients, die den Server als Kindprozess starten. Dabei ist `stdout` ausschließlich MCP-Protokoll; Logs und Fehler werden als JSON-Zeilen nach `stderr` geschrieben.

```powershell
$env:MCP_TRANSPORT = "stdio"
npm start
```

Für lokalen Streamable HTTP setzen Sie den Transport ausdrücklich auf `http`. Der Dienst bindet ausschließlich an `127.0.0.1` und stellt `/mcp` bereit.

```powershell
$env:MCP_TRANSPORT = "http"
$env:MCP_HTTP_PORT = "3939"
npm start
```

```text
http://127.0.0.1:3939/mcp
```

Host- und Origin-Guards des MCP-SDK werden vor dem MCP-Handler ausgeführt. Eine Remote-Freigabe ist nicht enthalten. Vor jeder LAN- oder Internetbindung sind TLS, Resource-Server-Authentifizierung, Host- und Origin-Allowlisten, Rate Limits und eine separate Bedrohungsanalyse erforderlich.[1] [2]

## Signierte lokale Gitea-Webhooks

Der Webhook-Receiver ist **opt-in**. Er wird nur aktiviert, wenn `GITEA_WEBHOOK_SECRET` und `GITEA_WEBHOOK_TARGET_URL` gemeinsam gesetzt sind. Das Secret muss mindestens 32 Zeichen umfassen; die Zieladresse muss exakt eine lokale HTTP-URL mit dem Pfad `/webhooks/gitea` sein. `MCP_TRANSPORT=http` ist verpflichtend.

| Variable | Erforderlich bei Webhooks | Sicherheitsregel |
| --- | --- | --- |
| `GITEA_WEBHOOK_SECRET` | Ja | Mindestens 32 Zeichen; nie geloggt oder als Toolantwort ausgegeben |
| `GITEA_WEBHOOK_TARGET_URL` | Ja | Nur `http://127.0.0.1:<port>/webhooks/gitea`, `localhost` oder `::1` |

```powershell
$env:MCP_TRANSPORT = "http"
$env:MCP_HTTP_PORT = "3939"
$env:GITEA_WEBHOOK_SECRET = "<MINDESTENS_32_ZEICHEN_LOKAL_SETZEN>"
$env:GITEA_WEBHOOK_TARGET_URL = "http://127.0.0.1:3939/webhooks/gitea"
npm start
```

Der Receiver akzeptiert ausschließlich `POST` mit `application/json`. Vor JSON-Parsing prüft er die unveränderte Payload mittels HMAC-SHA256, setzt eine Payloadgrenze von 1 MiB durch, verlangt eine Gitea-Delivery-ID, dedupliziert die letzten 500 Zustellungen pro Prozess und prüft den Payload-Owner erneut gegen `GITEA_ALLOWED_OWNER`. Nur begrenzte, secretsfreie Zustellungsmetadaten werden über den EventBus publiziert. Rohpayloads werden nicht persistiert.[3]

Mit aktivierter Webhook-Konfiguration erscheint zusätzlich das mutierende Tool `gitea_create_local_webhook`. Es akzeptiert keine Zieladresse und kein Secret; beide Werte stammen ausschließlich aus der Runtime-Konfiguration. Das Tool `gitea_delete_local_webhook` löscht nach `confirm: true` nur einen Hook, dessen sichtbare Zieladresse mit dem konfigurierten lokalen Receiver übereinstimmt.

## DBZS Fleet Commander und Feature Starter

Die Integrationen verwenden vorhandene DBZS-Verträge und bauen keine zweite Lifecycle- oder Update-Steuerung auf.

| Variable | Zweck | Sicherheitsgrenze |
| --- | --- | --- |
| `DBZS_FLEET_API_URL` | Lokale Fleet Commander v1 API, typischerweise `http://127.0.0.1:8110` | Ausschließlich HTTP-Loopback; der Adapter führt nur GET-Aufrufe mit `X-DBZS-Fleet-API: v1` aus |
| `DBZS_FEATURE_STARTER_HEALTH_PATH` | Absoluter Pfad zu `platform-health.json` | Ausschließlich read-only JSON; Dateigröße maximal 1 MiB |
| `DBZS_FEATURE_STARTER_EXECUTABLE` | Absoluter Pfad zur kanonischen `DBZS.FeatureStarter.exe` | Keine frei formbaren Kommandos; exakt fest kodierte CLI-Argumente |
| `DBZS_FEATURE_STARTER_ALLOW_HOOKS` | Freigabe mutierender Update- und Installer-Hooks | Nur der exakte Wert `true`; zusätzlich verlangt jedes MCP-Write-Tool `confirm: true` |

Die Feature-Starter-Health-Integration liest die vorhandene atomare Plattformstatusdatei. Sie erhält keine Lifecycle-Authority. Die Update- und Installer-Hooks delegieren nur an bestehende Feature-Starter-CLI-Verträge: `--check-updates --non-interactive`, `--apply-updates --non-interactive` und `--install-all --installer`. Das verhindert parallele Update-, Rollback-, Dirty-Worktree- oder Installerlogik.

> **Betriebsgrenze:** `DBZS_FEATURE_STARTER_ALLOW_HOOKS=true` ist eine lokale Berechtigung für tatsächliche Änderungen. Diese sollte nur im bewusst konfigurierten Windows-Dienstprozess gesetzt werden. Die MCP-Bestätigung ersetzt diese Berechtigung nicht, sondern ergänzt sie.

## Verfügbare MCP-Tools

Alle Tools prüfen Eingaben über Zod. Repository- und packagebezogene Tools erzwingen die Owner-Policy, bevor ein Gitea-Request entsteht. Read-Tools laden keine Assets oder Packages herunter. Write-Tools erfordern `confirm: true` und werden nur registriert, wenn die korrespondierende Runtime-Konfiguration vollständig und sicher ist.

| Toolgruppe | Tools | Kategorie |
| --- | --- | --- |
| Repository und Inhalte | `gitea_list_repositories`, `gitea_get_repository`, `gitea_get_contents`, `gitea_list_branches`, `gitea_get_branch`, `gitea_list_commits`, `gitea_get_commit` | Read |
| Zusammenarbeit | `gitea_list_pull_requests`, `gitea_get_pull_request`, `gitea_list_issues`, `gitea_get_issue` | Read |
| Actions | `gitea_list_workflows`, `gitea_list_workflow_runs`, `gitea_list_workflow_jobs`, `gitea_get_workflow_job_log`, `gitea_list_runners`, `gitea_get_runner`, `gitea_list_artifacts`, `gitea_get_artifact` | Read |
| Actions-Mutationen | `gitea_dispatch_workflow`, `gitea_rerun_workflow` | Write, `confirm: true` |
| Releases und Registry | `gitea_list_releases`, `gitea_list_release_assets`, `gitea_list_packages`, `gitea_list_package_versions` | Read |
| Hook-Metadaten | `gitea_list_webhooks` | Read, Secrets und Authorization-Werte bereinigt |
| Lokale Hooks | `gitea_create_local_webhook`, `gitea_delete_local_webhook` | Opt-in Write, `confirm: true` |
| Fleet Commander | `dbzs_get_fleet_health`, `dbzs_get_fleet_dashboard`, `dbzs_get_fleet_operating_status`, `dbzs_list_fleet_services`, `dbzs_list_fleet_events` | Optionaler local-only Read |
| Feature Starter | `dbzs_get_feature_starter_health` | Optionaler Read |
| Feature Starter Hooks | `dbzs_check_feature_starter_updates`, `dbzs_apply_feature_starter_updates`, `dbzs_run_feature_starter_install_all` | Optional; letzte zwei Write mit `confirm: true` und lokaler Hookfreigabe |

Die Release- und Asset-Endpunkte werden ausschließlich für Metadaten genutzt. Gitea stellt Asset-URLs bereit, aber der MCP-Prozess lädt weder Archive noch Binärassets herunter. Die ownerbasierte Package Registry bleibt ebenfalls read-only.[4] [5]

## Ereignisse, Fehler und Grenzen

Jeder relevante Vorgang publiziert strukturierte DBZS-Ereignisse. Dazu gehören Runtime-Konfiguration ohne Secrets, MCP-Toolstart und -abschluss, Gitea-Requests, Webhook-Ablehnungen und Zustellungen, Fleet-Requests, Feature-Starter-Health sowie Hook-Prozessstarts und -fehler. Fehler werden als kontrollierte MCP-Fehler zurückgegeben und nach `stderr` protokolliert. Token, HMAC-Secrets, Authorization-Werte und bereinigte Hook-Konfiguration werden niemals geloggt oder in Toolantworten ausgegeben.

Phase 3 enthält bewusst keine Artifact-Binärdownloads, keine Package-Uploads oder -Löschungen, keine beliebigen Webhook-URLs, keine Fleet-Commander-Mutationen und keinen frei formbaren lokalen Prozessstarter. Ein dauerhafter oder remote erreichbarer Webhook-Betrieb ist nicht enthalten; hierfür wäre ein separater, authentifizierter Dienst mit TLS, Signaturrotation, Rate Limiting, Firewall- und Deployment-Konzept erforderlich.

## Referenzen

[1]: https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html "MCP TypeScript SDK v2: Serve over HTTP"
[2]: https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html "MCP TypeScript SDK v2: Require authorization"
[3]: https://docs.gitea.com/usage/repository/webhooks/ "Gitea: Repository Webhooks"
[4]: https://docs.gitea.com/api/operations/repo-list-releases/ "Gitea API: List Releases"
[5]: https://docs.gitea.com/api/1.24/operations/list-packages/ "Gitea API: List Packages"
