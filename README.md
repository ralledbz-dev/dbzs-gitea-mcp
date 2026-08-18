# DBZS Gitea MCP Server

Der **DBZS Gitea MCP Server** stellt einen lokalen, policy-geschützten Adapter zwischen MCP-Clients und der Gitea-REST-API unter `/api/v1` bereit. Er arbeitet nach dem DBZS-Prinzip: Die MCP-Schicht orchestriert Ein- und Ausgabe, während der Gitea-Adapter Token-Verwendung, Namespace-Policy, URL-Kodierung, Fehlersemantik und Observability zentral kapselt.

> **Sicherheitsprinzip:** Der Server akzeptiert repositorybezogene Anfragen ausschließlich für den exakt in `GITEA_ALLOWED_OWNER` freigegebenen Namespace. Ein Token mit weitergehenden Rechten erweitert den über MCP erreichbaren Namespace nicht.

| Bereich | Umsetzung in Phase 2 |
| --- | --- |
| Laufzeit | Node.js 24 oder höher, TypeScript im NodeNext-Modus |
| MCP | Offizielles MCP TypeScript SDK v2 mit Zod-v4-Schemas |
| Transport | Kompatibles stdio sowie optionaler Streamable-HTTP-Endpunkt unter `/mcp` |
| HTTP-Bindung | Ausschließlich `127.0.0.1`; kein LAN- oder Internet-Listener |
| HTTP-Schutz | Vor dem SDK-Handler ausgeführte localhost Host- und Origin-Validierung |
| Gitea | REST API `/api/v1` für Repository-, Collaboration- und Actions-Read-Operationen |
| Authentifizierung | Ausschließlich Prozessumgebungsvariable `DBZS_HOME_API_TOKEN` mit Legacy-Fallback |
| Namespace-Schutz | Verpflichtende Owner-Allowlist über `GITEA_ALLOWED_OWNER` |
| Observability | Strukturierte DBZS-Ereignisse nach `stderr`; stdio-`stdout` bleibt protokollrein |

## Voraussetzungen

Erforderlich sind **Node.js 24 oder höher**, eine erreichbare Gitea-Instanz mit aktivierten benötigten Actions-Funktionen sowie ein Personal Access Token mit den minimal für die gewünschten Read- und Write-Operationen notwendigen Rechten. Der Dienst verlangt weder einen Gitea-Admin- noch einen `sudo`-Token. Das verwendete SDK unterstützt sowohl lokal gestartete stdio-Server als auch Streamable HTTP.[1]

Der Token muss im **Prozesskontext** verfügbar sein. Er wird weder aus `.env` eingelesen noch in Dateien, Logs, Tool-Antworten oder dieser Dokumentation ausgegeben. Nach dem Setzen einer Benutzer- oder Maschinenvariablen muss die aufrufende Anwendung gegebenenfalls neu gestartet werden, damit sie den Wert an den Node-Prozess vererbt.

## Konfiguration

Kopieren Sie `.env.example` ausschließlich als Konfigurationsreferenz. Die Datei enthält absichtlich kein Secret und wird nicht durch den Server geladen. Setzen Sie die Variablen im Prozesskontext des MCP-Clients oder in einer dafür vorgesehenen Windows-Dienstkonfiguration.

| Variable | Erforderlich | Standard | Zweck |
| --- | --- | --- | --- |
| `DBZS_HOME_API_TOKEN` | Ja | – | Gitea Personal Access Token; ausschließlich im Arbeitsspeicher |
| `GITEA_BASE_URL` | Ja | – | Basis-URL der Gitea-Instanz, beispielsweise `http://127.0.0.1:3000`; ohne `/api/v1` |
| `GITEA_ALLOWED_OWNER` | Ja | – | Exakt ein erlaubter Benutzer- oder Organisationsnamespace, beispielsweise `devdbzemusic` |
| `MCP_TRANSPORT` | Nein | `stdio` | Lokaler Transportmodus: `stdio` oder `http` |
| `MCP_HTTP_PORT` | Bei HTTP nein | `3939` | TCP-Port des ausschließlich lokalen HTTP-Listeners; nur `1` bis `65535` |
| `GITEA_TOKEN` | Nein | – | Ausschließlich kompatibler Fallback; `DBZS_HOME_API_TOKEN` hat immer Vorrang |

Dieses PowerShell-Beispiel setzt die Konfiguration nur für die laufende Sitzung. Den Tokenwert setzen Sie lokal; er darf nicht in Skripten, Dokumenten oder Git landen.

```powershell
$env:GITEA_BASE_URL = "http://127.0.0.1:3000"
$env:GITEA_ALLOWED_OWNER = "devdbzemusic"
$env:DBZS_HOME_API_TOKEN = "<GITEA_PERSONAL_ACCESS_TOKEN>"
```

## Installation und Qualitätsprüfung

Die folgenden Befehle sind Windows-first formuliert und werden im Projektordner ausgeführt. `npm ci` installiert genau den in `package-lock.json` dokumentierten Paketstand. `npm test` baut das Projekt und führt alle Testdateien aus.

```powershell
Set-Location E:\GitHub\dbzs-gitea-mcp
npm ci
npm run typecheck
npm test
```

| Prüfung | Befehl | Erwartetes Ergebnis |
| --- | --- | --- |
| Statische Typprüfung | `npm run typecheck` | Erfolgreiche Prüfung gegen MCP SDK v2, Node-Adapter und Zod v4 |
| Build | `npm run build` | JavaScript, Deklarationen und Source Maps unter `dist/` |
| Tests | `npm test` | Konfiguration, Owner-Policy, Actions, Phase-2-Read-Adapter und Loopback-Grenze bestanden |
| Start ohne Secrets | `node dist/index.js` | Exit-Code `1`, sichere stderr-Meldung, keine stdout-Ausgabe |
| HTTP-Grenze | HTTP-Request an `http://127.0.0.1:<port>/unbekannt` | HTTP `404`; nur `/mcp` ist verfügbar |
| Origin-Schutz | Cross-Origin-POST an `/mcp` | HTTP `403` vor der MCP-Verarbeitung |

## Betrieb über stdio

`stdio` bleibt der Standard und eignet sich für MCP-Clients, die den Server als lokalen Kindprozess starten. In diesem Modus darf `stdout` ausschließlich MCP-Protokolldaten enthalten; DBZS-Ereignisse und Fehler gehen als JSON-Zeilen nach `stderr`.

```powershell
$env:MCP_TRANSPORT = "stdio"
npm start
```

Ein lokaler MCP-Client kann den gebauten Server beispielsweise wie folgt starten. Der Pfad ist an den tatsächlichen lokalen Projektstand anzupassen. Übergeben Sie den Token nicht in einer geteilten Client-Konfigurationsdatei; bevorzugen Sie die bereits im aufrufenden Prozess gesetzte `DBZS_HOME_API_TOKEN`-Variable.

```json
{
  "mcpServers": {
    "dbzs-gitea": {
      "command": "node",
      "args": ["E:\\GitHub\\dbzs-gitea-mcp\\dist\\index.js"],
      "env": {
        "GITEA_BASE_URL": "http://127.0.0.1:3000",
        "GITEA_ALLOWED_OWNER": "devdbzemusic",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

## Betrieb über lokalen Streamable HTTP

Phase 2 ergänzt einen zustandslosen Streamable-HTTP-Endpunkt unter `http://127.0.0.1:<MCP_HTTP_PORT>/mcp`. Der offizielle SDK-Handler baut pro Anfrage eine frische MCP-Serverinstanz auf; Gitea-Client und EventBus bleiben als zentrale, zustandsarme Abhängigkeiten erhalten.[1]

```powershell
$env:MCP_TRANSPORT = "http"
$env:MCP_HTTP_PORT = "3939"
npm start
```

Ein HTTP-fähiger MCP-Client verwendet als Zieladresse ausschließlich den lokalen Endpunkt:

```text
http://127.0.0.1:3939/mcp
```

Der Listener bindet fest an `127.0.0.1`. Zusätzlich prüfen die vom MCP-SDK vorgesehenen Loopback-Guards `Host` und `Origin`, bevor eine Anfrage den MCP-Handler erreicht. Diese Reihenfolge schützt den lokalen Dienst unter anderem gegen DNS-Rebinding- und fremde Browser-Origin-Anfragen.[1]

> **Keine Remote-Freigabe:** Ein LAN- oder Internet-Betrieb ist nicht Teil von Phase 2. Vor jeder späteren externen Bindung sind TLS, ein verifizierter Bearer- oder OAuth-Resource-Server-Gate, eine explizite Host-Allowlist, eine Origin-Allowlist, Rate Limits sowie eine Bedrohungsanalyse umzusetzen.[2]

## Verfügbare MCP-Tools

Die Read-Tools lösen keine Gitea-Mutation aus. Die bestehenden Write-Tools verlangen weiterhin zwingend `confirm: true`; ohne diesen booleschen Wert verwirft die Zod-Eingabevalidierung den Aufruf vor dem Gitea-Request. Jede repositorybezogene Operation prüft den übergebenen `owner` gegen `GITEA_ALLOWED_OWNER`, bevor eine Netzwerkverbindung aufgebaut wird.

| Tool | Kategorie | Zweck |
| --- | --- | --- |
| `gitea_list_repositories` | Read | Sichtbare Repositories listen und auf den erlaubten Owner filtern |
| `gitea_get_repository` | Read | Repository-Metadaten lesen |
| `gitea_get_contents` | Read | Datei oder Verzeichnis mit optionalem `ref` lesen |
| `gitea_list_workflows` | Read | Gitea-Actions-Workflows mit Paginierung listen |
| `gitea_list_workflow_runs` | Read | Workflow-Runs optional nach `workflowId` gefiltert listen |
| `gitea_dispatch_workflow` | Write, `confirm: true` | Workflow mit `ref` und String-Inputs auslösen |
| `gitea_rerun_workflow` | Write, `confirm: true` | Vollständigen Workflow-Run erneut starten |
| `gitea_list_branches` | Read | Branches mit Head-Commit- und Schutzmetadaten listen |
| `gitea_get_branch` | Read | Details eines einzelnen Branches lesen |
| `gitea_list_commits` | Read | Commits nach `ref` und `path` filtern; ohne große Diff- und Dateilisten |
| `gitea_get_commit` | Read | Metadaten eines Commits oder einer Git-Referenz lesen |
| `gitea_list_pull_requests` | Read | Pull Requests nach Status und Zielbranch filtern |
| `gitea_get_pull_request` | Read | Details eines Pull Requests lesen |
| `gitea_list_issues` | Read | Reguläre Issues, getrennt von Pull Requests, nach Status und Text filtern |
| `gitea_get_issue` | Read | Details eines Issues lesen |
| `gitea_list_workflow_jobs` | Read | Jobs eines Workflow-Runs mit Paginierung lesen |
| `gitea_get_workflow_job_log` | Read | Job-Log lesen; `maxCharacters` begrenzt die Antwort lokal auf maximal 100.000 Zeichen |
| `gitea_list_runners` | Read | Für das Repository sichtbare Actions-Runner lesen |
| `gitea_get_runner` | Read | Details eines Actions-Runners lesen |
| `gitea_list_artifacts` | Read | Artifact-Metadaten repository- oder runbezogen listen |
| `gitea_get_artifact` | Read | Metadaten eines Artifacts inklusive Gitea-Download-URL lesen, ohne Binärdownload |

Die Branch-, Commit-, Pull-Request- und Issue-Read-Tools nutzen die dafür vorgesehenen Gitea-Repository-Endpunkte und unterstützen deren zentrale Paginierungs- und Filterparameter.[3] [4] [5] [6] Die Actions-Tools lesen Jobs, Logs, Runner und Artifacts über die Gitea-Actions-API. Artifact-Dateien selbst werden nicht heruntergeladen; der MCP-Server gibt ausschließlich Metadaten und die von Gitea bereitgestellte Download-URL aus.[7]

## Betrieb, Fehlerbehandlung und Logs

Der EventBus veröffentlicht relevante Konfigurations-, Runtime-, HTTP-, Policy-, MCP- und Gitea-Request-Ereignisse. `StderrLogger` serialisiert diese als einzelne JSON-Zeilen nach `stderr`. Für HTTP entstehen unter anderem Ereignisse für Start und Stop des Listeners, empfangene Requests, abgewiesene Routen, abgewiesene Host- oder Origin-Prüfungen sowie Handlerfehler.

Fehler werden nicht verschluckt. Fehlende Konfiguration, abgelehnte Owner-Policy, Netzwerkfehler, ungültige JSON-Antworten und nicht erfolgreiche Gitea-HTTP-Status werden als strukturierte DBZS-Fehler protokolliert und als MCP-Toolfehler zurückgegeben. Gitea-Fehlermeldungen werden auf 500 Zeichen begrenzt. Tokenwerte werden weder geloggt noch in Fehlerdetails übernommen.

## Implementierungsgrenzen und nächste Phase

Phase 2 enthält bewusst keine mutierenden Branch-, Pull-Request-, Issue-, Runner- oder Artifact-Operationen. Die zwei vorhandenen Actions-Write-Tools bleiben durch `confirm: true` geschützt. Es wird weder ein Admin-Runner-Token erzeugt noch ein Runner entfernt; Artifact-Downloads werden nicht in den MCP-Prozess gezogen.

Phase 3 kann Releases, Package Registry, Webhooks, Integrationen in Fleet Commander beziehungsweise Feature Starter sowie DBZS-Update- und Installer-Hooks umfassen. Für jede später geplante externe HTTP-Exposition ist vorab ein getrenntes Sicherheitskonzept zu implementieren.

## Referenzen

[1]: https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html "MCP TypeScript SDK v2: Serve over HTTP"
[2]: https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html "MCP TypeScript SDK v2: Require authorization"
[3]: https://go-gitea-gitea.mintlify.app/api/branches "Gitea API: Branch Management"
[4]: https://go-gitea-gitea.mintlify.app/api/commits "Gitea API: Commit Endpoints"
[5]: https://go-gitea-gitea.mintlify.app/api/pull-requests "Gitea API: Pull Requests API"
[6]: https://go-gitea-gitea.mintlify.app/api/issues "Gitea API: Issues API"
[7]: https://go-gitea-gitea.mintlify.app/api/actions "Gitea Actions API"
