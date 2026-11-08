# DBZS Gitea MCP – Live Smoke Test

## Ziel

Jetzt prüfen wir nicht mehr den Code theoretisch, sondern den laufenden Server praktisch.

## 1. Transport prüfen

Bei HTTP-Betrieb sollte der Endpoint sein:

```text
http://127.0.0.1:3939/mcp
```

Falls ein anderer Port gesetzt wurde, entsprechend anpassen.

Erwartung:
- Prozess läuft stabil
- kein Crashloop
- Port ist gebunden
- `/mcp` antwortet nur über den MCP-Transport
- Host-/Origin-Guards bleiben aktiv

## 2. MCP Tool-Liste abrufen

Im MCP-Client sollten mindestens diese Tools erscheinen:

```text
gitea_list_repositories
gitea_get_repository
gitea_get_contents
gitea_list_workflows
gitea_list_workflow_runs
gitea_dispatch_workflow
gitea_rerun_workflow
gitea_list_branches
gitea_get_branch
gitea_list_commits
gitea_get_commit
gitea_list_pull_requests
gitea_get_pull_request
gitea_list_issues
gitea_get_issue
gitea_list_workflow_jobs
gitea_get_workflow_job_log
gitea_list_runners
gitea_get_runner
gitea_list_artifacts
gitea_get_artifact
gitea_list_releases
gitea_list_release_assets
gitea_list_packages
gitea_list_package_versions
gitea_list_webhooks
```

Das sind die 26 immer registrierten Tools. Optionale Phase-3-Tools (lokale Webhook-Erstellung/-Löschung und Fleet Commander) erscheinen zusätzlich, sobald die jeweilige Integration per Environment Variable konfiguriert ist — siehe `DBZS Gitea MCP Server.md`.

## 2a. Betriebsendpunkte prüfen (nur HTTP-Modus)

Nur relevant, wenn `MCP_TRANSPORT=http` gesetzt ist.

```text
GET http://127.0.0.1:3939/health   -> 200 { "service": "dbzs-gitea-mcp", "status": "healthy" }
GET http://127.0.0.1:3939/ready    -> 200 { "service": "dbzs-gitea-mcp", "status": "ready", "version": "...", "tools": 26 }
GET http://127.0.0.1:3939/version  -> 200 { "service": "dbzs-gitea-mcp", "version": "..." }
```

Erwartung:
- `version` in `/ready` und `/version` stimmt mit der Version in `package.json` überein
- `tools` in `/ready` stimmt mit der tatsächlich sichtbaren Toolanzahl im MCP-Client überein
- Ein POST auf `/health`, `/ready` oder `/version` liefert 405
- Ein fremder `Origin`-Header liefert weiterhin 403, exakt wie bei `/mcp`

## 3. Gitea-Verbindung prüfen

Erster Read-only Test:

```text
gitea_list_repositories
```

Erwartung:
- nur Repositories aus `GITEA_ALLOWED_OWNER`
- keine 401/403
- keine fremden Owner
- keine Token-Ausgabe im Log

## 4. Einzelnes Repository prüfen

Beispiel:

```text
owner: devdbzemusic
repo: dbzs-gitea-mcp
```

Tool:

```text
gitea_get_repository
```

## 5. Datei lesen

Zum Beispiel:

```text
README.md
```

mit:

```text
gitea_get_contents
```

Damit prüfen wir:
- Repository-Zugriff
- Branch-/Ref-Auflösung
- Content API
- MCP-Rückgabeformat

## 6. Actions prüfen

```text
gitea_list_workflows
```

Danach:

```text
gitea_list_workflow_runs
```

Wenn bereits Runner registriert sind:

```text
gitea_list_runners
```

## 7. Ersten echten Workflow starten

Nur einen bewusst ungefährlichen Testworkflow verwenden.

Beispiel:

```yaml
name: MCP Smoke Test

on:
  workflow_dispatch:

jobs:
  smoke:
    runs-on: [self-hosted, windows]

    steps:
      - uses: actions/checkout@v4
      - run: node --version
      - run: npm --version
      - run: echo "DBZS Gitea MCP smoke test OK"
```

Dann über:

```text
gitea_dispatch_workflow
```

mit:

```text
confirm: true
```

starten.

Danach:

```text
gitea_list_workflow_runs
gitea_list_workflow_jobs
gitea_get_workflow_job_log
```

## 8. Artifact-Test

Später erweitern:

```yaml
- name: Create test artifact
  shell: powershell
  run: |
    "DBZS MCP OK" | Out-File smoke.txt

- uses: actions/upload-artifact@v4
  with:
    name: dbzs-mcp-smoke
    path: smoke.txt
```

Dann:

```text
gitea_list_artifacts
gitea_get_artifact
```

## Freigabekriterium

Der Server ist für V1 praktisch einsatzfähig, wenn:

```text
MCP connect            PASS
Tool discovery         PASS
Repository list        PASS
Repository read        PASS
Workflow list          PASS
Runner visible         PASS
Workflow dispatch      PASS
Run status             PASS
Job log                PASS
Artifact metadata      PASS
```

Danach kann der DBZS Gitea MCP Server als operative lokale Git-/CI-Bridge verwendet werden.


## Lokale Workspace-Brücke (optional)

Mit `DBZS_WORKSPACE_ROOT` auf einen Testordner zeigen lassen und Server neu starten. `workspace_list`, `workspace_read_file` und `workspace_git_status` prüfen. Schreibtest nur in einer entbehrlichen Testdatei mit `confirm: true`. Ein nicht freigegebenes Programm und ein Pfad außerhalb des Roots müssen abgewiesen werden.
