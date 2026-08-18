/**
 * DBZS — Division By Zeros
 * Datei: gitea/client.ts
 * Zweck: Typisierten, policy-geschützten Adapter für die Gitea-REST-API /api/v1 bereitstellen.
 * Version: 0.2.0
 */

import { DbzsEventBus } from "../core/observability.js";
import { DbzsError, GiteaApiError } from "../core/errors.js";

/**
 * Beschreibt die für den Client benötigte Fetch-Signatur und ermöglicht isolierte Tests.
 */
export type FetchFunction = (input: URL | string, init?: RequestInit) => Promise<Response>;

/**
 * Repräsentiert ein minimales Gitea-Repository mit bewahrten Zusatzfeldern.
 */
export interface GiteaRepository {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly owner: { readonly login: string };
  readonly private?: boolean;
  readonly archived?: boolean;
  readonly default_branch?: string;
  readonly html_url?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert eine Datei oder ein Verzeichnis aus der Gitea-Contents-API.
 */
export interface GiteaContentEntry {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "dir" | "submodule" | string;
  readonly content?: string;
  readonly encoding?: string;
  readonly sha?: string;
  readonly size?: number;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert einen Gitea-Workflow aus der Actions-API.
 */
export interface GiteaWorkflow {
  readonly id: string | number;
  readonly name?: string;
  readonly path?: string;
  readonly state?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert einen Gitea-Workflow-Run aus der Actions-API.
 */
export interface GiteaWorkflowRun {
  readonly id: number;
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string;
  readonly event?: string;
  readonly head_branch?: string;
  readonly html_url?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly [key: string]: unknown;
}

/**
 * Beschreibt die paginierte Rückgabeform der Actions-Listenendpunkte.
 */
export interface GiteaListResponse<T> {
  readonly total_count?: number;
  readonly workflows?: T[];
  readonly workflow_runs?: T[];
  readonly [key: string]: unknown;
}

/**
 * Beschreibt die Antwort eines Dispatch-Aufrufs mit optionalen Run-Details.
 */
export interface GiteaWorkflowDispatchResult {
  readonly workflow_run_id?: number;
  readonly run_url?: string;
  readonly html_url?: string;
  readonly [key: string]: unknown;
}

/**
 * Kapselt alle Gitea-REST-Aufrufe für Phase 1 des DBZS Gitea MCP Servers.
 *
 * Was: Baut API-URLs, setzt Token-Header, erzwingt die Owner-Allowlist und ruft Gitea auf.
 * Warum: MCP-Tools sollen keine Transport- oder Sicherheitslogik enthalten.
 * Wofür: Repository-, Datei- und Actions-Operationen des lokalen MCP-Servers.
 * Woher: Aus der Gitea-REST-API /api/v1 und der DBZS-Architekturvorgabe.
 * Wo: Zwischen Runtime-Services und der Gitea-Instanz.
 * Soll-Ergebnis: Sichere, testbare und nachvollziehbare API-Operationen ohne Token-Leaks.
 */
export class GiteaClient {
  /**
   * Erstellt den Gitea-Adapter mit der bereits validierten Laufzeitkonfiguration.
   *
   * Was: Speichert Basis-URL, Token, Owner-Allowlist, EventBus und optionalen Fetch-Adapter.
   * Warum: Die Sicherheits- und Transportabhängigkeiten müssen zentral kontrolliert werden.
   * Wofür: Für alle späteren API-Aufrufe.
   * Woher: Aus dem Runtime-Container bei Programmstart.
   * Wo: An der Adapter-Grenze zu Gitea.
   * Soll-Ergebnis: Ein einsatzbereiter Client mit strikt begrenztem Namespace.
   *
   * @param baseUrl Normalisierte Basis-URL der Gitea-Instanz.
   * @param token Ausschließlich im Arbeitsspeicher gehaltenes Zugriffstoken.
   * @param allowedOwner Erlaubter Benutzer- oder Organisationsnamespace.
   * @param eventBus Zentraler DBZS-EventBus für Observability.
   * @param fetchFunction Optionaler Fetch-Adapter für isolierte Tests.
   */
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly allowedOwner: string,
    private readonly eventBus: DbzsEventBus,
    private readonly fetchFunction: FetchFunction = fetch,
  ) {}

  /**
   * Liefert alle für den Token sichtbaren Repositories innerhalb des erlaubten Namespace.
   *
   * Was: Fragt /user/repos ab und filtert das Ergebnis zusätzlich auf den Owner.
   * Warum: Die globale Repository-Liste darf niemals fremde Namespaces über MCP offenlegen.
   * Wofür: Für das schreibgeschützte Tool gitea_list_repositories.
   * Woher: Aus der Gitea-REST-API und GITEA_ALLOWED_OWNER.
   * Wo: Im Read-Service für Repositories.
   * Soll-Ergebnis: Ausschließlich Repositories des freigegebenen Owners.
   *
   * @param limit Maximale Anzahl der angeforderten Repositories.
   * @returns Gefilterte Repositoryliste.
   */
  public async listRepositories(limit: number): Promise<GiteaRepository[]> {
    const repositories = await this.request<GiteaRepository[]>("/user/repos", { query: { limit } });
    return repositories.filter((repository) => repository.owner?.login === this.allowedOwner);
  }

  /**
   * Liefert Metadaten eines freigegebenen Repositories.
   *
   * Was: Ruft den Repository-Endpunkt für Owner und Name ab.
   * Warum: Einzelne Repository-Anfragen müssen vor dem API-Aufruf policy-geprüft sein.
   * Wofür: Für das Tool gitea_get_repository.
   * Woher: Aus der Gitea-REST-API /repos/{owner}/{repo}.
   * Wo: Im Read-Service für Repositories.
   * Soll-Ergebnis: Metadaten nur für den freigegebenen Namespace.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @returns Repository-Metadaten.
   */
  public async getRepository(owner: string, repositoryName: string): Promise<GiteaRepository> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaRepository>(this.repositoryPath(owner, repositoryName));
  }

  /**
   * Liefert Datei- oder Verzeichnisinhalte eines freigegebenen Repositories.
   *
   * Was: Ruft die Contents-API mit optionaler Git-Referenz ab.
   * Warum: Inhalte dürfen nur innerhalb des festgelegten Namespaces zugänglich sein.
   * Wofür: Für das Tool gitea_get_contents.
   * Woher: Aus der Gitea-REST-API /contents/{filepath}.
   * Wo: Im Read-Service für Repositoryinhalte.
   * Soll-Ergebnis: Originale Gitea-Datei- oder Verzeichnisdaten für den MCP-Client.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param path Relativer Datei- oder Verzeichnispfad.
   * @param ref Optionale Branch-, Tag- oder Commit-Referenz.
   * @returns Gitea-Content-Objekt oder Verzeichnisliste.
   */
  public async getContents(
    owner: string,
    repositoryName: string,
    path: string,
    ref?: string,
  ): Promise<GiteaContentEntry | GiteaContentEntry[]> {
    this.assertAllowedOwner(owner);
    const encodedPath = path
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    const suffix = encodedPath ? `/${encodedPath}` : "";
    return this.request<GiteaContentEntry | GiteaContentEntry[]>(
      `${this.repositoryPath(owner, repositoryName)}/contents${suffix}`,
      { query: ref ? { ref } : {} },
    );
  }

  /**
   * Liefert die registrierten Actions-Workflows eines Repositories.
   *
   * Was: Ruft den Workflow-Listenendpunkt von Gitea ab.
   * Warum: Workflow-Auswahl soll vor einer manuellen Auslösung sichtbar und nachvollziehbar sein.
   * Wofür: Für das Tool gitea_list_workflows.
   * Woher: Aus der Gitea Actions API.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Workflowdaten und zugehörige Paginierungsmetadaten.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Workflows.
   * @returns Paginierte Workflow-Antwort von Gitea.
   */
  public async listWorkflows(
    owner: string,
    repositoryName: string,
    page: number,
    limit: number,
  ): Promise<GiteaListResponse<GiteaWorkflow>> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaListResponse<GiteaWorkflow>>(
      `${this.repositoryPath(owner, repositoryName)}/actions/workflows`,
      { query: { page, limit } },
    );
  }

  /**
   * Liefert Workflow-Runs eines Repositories oder eines bestimmten Workflows.
   *
   * Was: Wählt abhängig von workflowId den allgemeinen oder workflow-spezifischen Runs-Endpunkt.
   * Warum: Phase 1 soll sowohl Überblick als auch fokussierte Laufhistorie ermöglichen.
   * Wofür: Für das Tool gitea_list_workflow_runs.
   * Woher: Aus der Gitea Actions API.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Paginierte und optional gefilterte Workflow-Run-Daten.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Runs.
   * @param workflowId Optionale Workflow-ID für einen spezifischen Runs-Endpunkt.
   * @returns Paginierte Workflow-Run-Antwort von Gitea.
   */
  public async listWorkflowRuns(
    owner: string,
    repositoryName: string,
    page: number,
    limit: number,
    workflowId?: string,
  ): Promise<GiteaListResponse<GiteaWorkflowRun>> {
    this.assertAllowedOwner(owner);
    const actionsPath = `${this.repositoryPath(owner, repositoryName)}/actions`;
    const path = workflowId
      ? `${actionsPath}/workflows/${encodeURIComponent(workflowId)}/runs`
      : `${actionsPath}/runs`;

    return this.request<GiteaListResponse<GiteaWorkflowRun>>(path, { query: { page, limit } });
  }

  /**
   * Löst einen Workflow manuell aus und fordert die Gitea-Run-Details an.
   *
   * Was: Sendet ref und stringbasierte Inputs per POST an den Dispatch-Endpunkt.
   * Warum: Der MCP-Client braucht nach einer bestätigten Schreiboperation eine prüfbare Run-ID.
   * Wofür: Für das Tool gitea_dispatch_workflow nach confirm: true.
   * Woher: Aus der Gitea Actions API /dispatches mit return_run_details=true.
   * Wo: Im Actions-Write-Service.
   * Soll-Ergebnis: Eine nachvollziehbare Dispatch-Antwort mit Run-Details, falls Gitea diese liefert.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param workflowId Workflow-ID oder Workflow-Dateiname.
   * @param ref Vollständige Git-Referenz, beispielsweise refs/heads/main.
   * @param inputs Optionale Workflow-Eingaben als String-Werte.
   * @returns Dispatch-Details oder ein leeres Objekt bei 204 No Content.
   */
  public async dispatchWorkflow(
    owner: string,
    repositoryName: string,
    workflowId: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<GiteaWorkflowDispatchResult> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaWorkflowDispatchResult>(
      `${this.repositoryPath(owner, repositoryName)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
      {
        method: "POST",
        query: { return_run_details: true },
        body: { ref, inputs },
      },
    );
  }

  /**
   * Startet den vollständigen erneuten Lauf eines Workflow-Runs.
   *
   * Was: Sendet eine POST-Anfrage an den Gitea-Rerun-Endpunkt.
   * Warum: Reruns sind mutierende Operationen und werden nur nach Tool-Bestätigung aufgerufen.
   * Wofür: Für das Tool gitea_rerun_workflow nach confirm: true.
   * Woher: Aus der Gitea Actions API /actions/runs/{run}/rerun.
   * Wo: Im Actions-Write-Service.
   * Soll-Ergebnis: Der neu erstellte Gitea-Workflow-Run.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param runId Numerische ID des erneut zu startenden Runs.
   * @returns Der von Gitea erstellte Workflow-Run.
   */
  public async rerunWorkflow(owner: string, repositoryName: string, runId: number): Promise<GiteaWorkflowRun> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaWorkflowRun>(
      `${this.repositoryPath(owner, repositoryName)}/actions/runs/${encodeURIComponent(String(runId))}/rerun`,
      { method: "POST" },
    );
  }

  /**
   * Erzwingt den einen erlaubten Owner vor jeder repositorybezogenen Operation.
   *
   * Was: Vergleicht angeforderten und konfigurierten Namespace.
   * Warum: Ein Token mit breiteren Rechten darf nicht zu breiterem MCP-Zugriff führen.
   * Wofür: Für alle Tools mit owner-Parameter.
   * Woher: Aus GITEA_ALLOWED_OWNER und dem Sicherheitsmodell des Implementierungsplans.
   * Wo: Vor der URL-Erzeugung jedes repositorybezogenen Aufrufs.
   * Soll-Ergebnis: Fremde Namespaces werden vor einem Netzwerkaufruf abgewiesen.
   *
   * @param owner Vom MCP-Client angeforderter Owner.
   * @throws {DbzsError} Wenn der Owner nicht freigegeben ist.
   */
  private assertAllowedOwner(owner: string): void {
    if (owner !== this.allowedOwner) {
      this.eventBus.publish("policy.owner.rejected", "warn", {
        requestedOwner: owner,
        allowedOwner: this.allowedOwner,
      });
      throw new DbzsError("POLICY_VIOLATION", `Owner '${owner}' ist nicht freigegeben.`);
    }
  }

  /**
   * Erzeugt den relativ kodierten API-Pfad für ein Repository.
   *
   * Was: Kodiert Owner und Repositoryname als jeweils eigenes URL-Segment.
   * Warum: Sonderzeichen dürfen weder Pfadtrennung noch API-Ziel manipulieren.
   * Wofür: Für alle repositorybezogenen Endpunkte.
   * Woher: Aus den MCP-Toolargumenten nach Zod-Validierung.
   * Wo: Im Gitea-Client vor jeder Request-Erzeugung.
   * Soll-Ergebnis: Ein sicherer relativer /repos-Pfad.
   *
   * @param owner Repository-Owner.
   * @param repositoryName Repositoryname.
   * @returns Kodierter relativer Gitea-API-Pfad.
   */
  private repositoryPath(owner: string, repositoryName: string): string {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`;
  }

  /**
   * Führt eine Gitea-REST-Anfrage aus und verarbeitet Antworten konsistent.
   *
   * Was: Baut URL und Header, ruft fetch auf, protokolliert den Prozess und normalisiert Fehler.
   * Warum: Jeder API-Aufruf muss dieselbe Authentifizierung, Fehlersemantik und Observability erhalten.
   * Wofür: Für alle Read- und Write-Methoden dieses Clients.
   * Woher: Aus den öffentlichen Gitea-REST-API-Endpunkten.
   * Wo: Zentral im Gitea-Adapter.
   * Soll-Ergebnis: Typisierte API-Antwort oder ein strukturierter, sicherer Fehler.
   *
   * @param path Relativer /api/v1-Pfad.
   * @param options HTTP-Methode, Query-Parameter und JSON-Body.
   * @returns Typisierte JSON-Antwort oder ein leeres Objekt für No-Content-Antworten.
   */
  private async request<T>(
    path: string,
    options: {
      readonly method?: "GET" | "POST";
      readonly query?: Record<string, string | number | boolean | undefined>;
      readonly body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    const requestUrl = new URL(`${this.baseUrl}/api/v1${path}`);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        requestUrl.searchParams.set(key, String(value));
      }
    }

    const startedAt = Date.now();
    this.eventBus.publish("gitea.request.started", "info", { method, path });

    let response: Response;
    try {
      response = await this.fetchFunction(requestUrl, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `token ${this.token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unbekannter Netzwerkfehler";
      this.eventBus.publish("gitea.request.failed", "error", { method, path, reason });
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die Gitea-Instanz konnte nicht erreicht werden.", {
        method,
        path,
        reason,
      });
    }

    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      const responseBody = await this.readErrorBody(response);
      this.eventBus.publish("gitea.request.failed", "error", {
        method,
        path,
        status: response.status,
        durationMs,
      });
      throw new GiteaApiError(
        response.status,
        path,
        `Gitea hat die Anfrage mit HTTP ${response.status} abgelehnt${responseBody.message ? `: ${responseBody.message}` : "."}`,
        { method, responseMessage: responseBody.message },
      );
    }

    this.eventBus.publish("gitea.request.completed", "info", {
      method,
      path,
      status: response.status,
      durationMs,
    });

    if (response.status === 204) {
      return {} as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Gitea hat eine nicht lesbare JSON-Antwort geliefert.", {
        method,
        path,
        status: response.status,
      });
    }
  }

  /**
   * Liest die sichere Fehlermeldung aus einer nicht erfolgreichen Gitea-Antwort.
   *
   * Was: Extrahiert message aus JSON oder fällt auf eine kurze Textantwort zurück.
   * Warum: Fehler müssen sichtbar bleiben, ohne unkontrolliert große oder sensible Antwortkörper zu übernehmen.
   * Wofür: Für strukturierte GiteaApiError-Objekte.
   * Woher: Aus Gitea-API-Fehlerantworten.
   * Wo: Ausschließlich in der zentralen Request-Verarbeitung.
   * Soll-Ergebnis: Eine kurze, diagnostisch verwertbare Fehlerbeschreibung.
   *
   * @param response Fehlgeschlagene Fetch-Antwort.
   * @returns Bereinigte Fehlermeldung.
   */
  private async readErrorBody(response: Response): Promise<{ message?: string }> {
    const responseText = await response.text();
    if (!responseText) {
      return {};
    }

    try {
      const parsed = JSON.parse(responseText) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return { message: parsed.message.trim().slice(0, 500) };
      }
    } catch {
      return { message: responseText.trim().slice(0, 500) };
    }

    return {};
  }
}
