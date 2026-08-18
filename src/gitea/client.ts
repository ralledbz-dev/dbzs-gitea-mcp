/**
 * DBZS — Division By Zeros
 * Datei: gitea/client.ts
 * Zweck: Typisierten, policy-geschützten Adapter für die Gitea-REST-API /api/v1 bereitstellen.
 * Version: 0.3.0
 */

import { DbzsEventBus } from "../core/observability.js";
import { DbzsError, GiteaApiError } from "../core/errors.js";

/**
 * Beschreibt die für den Client benötigte Fetch-Signatur und ermöglicht isolierte Tests.
 */
export type FetchFunction = (input: URL | string, init?: RequestInit) => Promise<Response>;

/**
 * Beschreibt die kontrollierten Optionen eines Gitea-HTTP-Requests.
 */
interface GiteaRequestOptions {
  /** HTTP-Methode der unterstützten Phase-1- und Phase-2-Operationen. */
  readonly method?: "GET" | "POST" | "DELETE";
  /** Optionaler Query-Parameterbestand ohne undefinierte Werte. */
  readonly query?: Record<string, string | number | boolean | undefined>;
  /** Optionaler JSON-Body für mutierende Actions-Aufrufe. */
  readonly body?: Record<string, unknown>;
  /** Erwarteter Accept-Wert für JSON- oder Textantworten. */
  readonly accept?: string;
}

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
 * Repräsentiert einen Repository-Branch einschließlich seines aktuellen Commits.
 */
export interface GiteaBranch {
  readonly name: string;
  readonly commit?: { readonly id?: string; readonly message?: string; readonly timestamp?: string };
  readonly protected?: boolean;
  readonly user_can_push?: boolean;
  readonly user_can_merge?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert einen Commit aus der Gitea-Repository-API.
 */
export interface GiteaCommit {
  readonly sha: string;
  readonly html_url?: string;
  readonly commit?: { readonly message?: string; readonly author?: Record<string, unknown>; readonly committer?: Record<string, unknown> };
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert einen Pull Request aus der Gitea-Repository-API.
 */
export interface GiteaPullRequest {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly merged?: boolean;
  readonly draft?: boolean;
  readonly html_url?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert ein Issue aus der Gitea-Repository-API.
 */
export interface GiteaIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly html_url?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert einen einzelnen Job eines Gitea-Actions-Workflow-Runs.
 */
export interface GiteaWorkflowJob {
  readonly id: number;
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string;
  readonly started_at?: string;
  readonly completed_at?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert einen für ein Repository sichtbaren Gitea-Actions-Runner.
 */
export interface GiteaRunner {
  readonly id: number;
  readonly name?: string;
  readonly status?: string;
  readonly labels?: string[];
  readonly last_active?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert ein Actions-Artifact einschließlich seiner sicheren Metadaten.
 */
export interface GiteaArtifact {
  readonly id: number;
  readonly name: string;
  readonly size_in_bytes?: number;
  readonly expired?: boolean;
  readonly archive_download_url?: string;
  readonly created_at?: string;
  readonly expires_at?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert eine Gitea-Release-Metadatenansicht ohne Binärübertragung.
 */
export interface GiteaRelease {
  readonly id: number;
  readonly tag_name: string;
  readonly name?: string;
  readonly body?: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
  readonly published_at?: string;
  readonly html_url?: string;
  readonly tarball_url?: string;
  readonly zipball_url?: string;
  readonly assets?: GiteaReleaseAsset[];
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert ein Release Asset ausschließlich durch überprüfbare Metadaten und Download-URL.
 */
export interface GiteaReleaseAsset {
  readonly id: number;
  readonly name: string;
  readonly size?: number;
  readonly download_count?: number;
  readonly created_at?: string;
  readonly browser_download_url?: string;
  readonly uuid?: string;
  readonly [key: string]: unknown;
}

/**
 * Repräsentiert einen Owner-basierten Gitea-Package-Registry-Eintrag.
 */
export interface GiteaPackage {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly version: string;
  readonly created_at?: string;
  readonly html_url?: string;
  readonly owner?: { readonly login?: string };
  readonly repository?: { readonly full_name?: string; readonly name?: string };
  readonly [key: string]: unknown;
}

/**
 * Beschreibt einen gesäuberten Repository-Webhook ohne Secrets oder Authorization-Header.
 */
export interface GiteaWebhook {
  readonly id: number;
  readonly type: string;
  readonly name?: string;
  readonly active?: boolean;
  readonly branch_filter?: string;
  readonly events?: string[];
  readonly config?: Record<string, string>;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly [key: string]: unknown;
}

/**
 * Beschreibt die minimal kontrollierten Angaben für die Erstellung eines lokalen Gitea-Webhooks.
 */
export interface GiteaWebhookCreateRequest {
  readonly targetUrl: string;
  readonly secret: string;
  readonly events: string[];
  readonly branchFilter?: string;
}

/**
 * Beschreibt die paginierte Rückgabeform der Actions-Listenendpunkte.
 */
export interface GiteaListResponse<T> {
  readonly total_count?: number;
  readonly workflows?: T[];
  readonly workflow_runs?: T[];
  readonly jobs?: T[];
  readonly runners?: T[];
  readonly artifacts?: T[];
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
   * Listet Branches eines freigegebenen Repositories mit Gitea-Paginierung.
   *
   * Was: Ruft die Branch-Liste des Repositorys ab.
   * Warum: Branch- und Schutzinformationen sind für lokale Entwicklungsentscheidungen erforderlich.
   * Wofür: Für das schreibgeschützte Tool gitea_list_branches.
   * Woher: Aus GET /repos/{owner}/{repo}/branches der Gitea-REST-API.
   * Wo: Im Repository-Read-Service.
   * Soll-Ergebnis: Ausschließlich Branch-Daten des erlaubten Owners.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Branches.
   * @returns Branch-Liste von Gitea.
   */
  public async listBranches(owner: string, repositoryName: string, page: number, limit: number): Promise<GiteaBranch[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaBranch[]>(`${this.repositoryPath(owner, repositoryName)}/branches`, { query: { page, limit } });
  }

  /**
   * Liest einen einzelnen Branch eines freigegebenen Repositories.
   *
   * Was: Ruft den Branch-Endpunkt für einen exakt kodierten Branch-Namen ab.
   * Warum: Detaillierte Branch- und Schutzinformationen müssen gezielt abrufbar sein.
   * Wofür: Für das schreibgeschützte Tool gitea_get_branch.
   * Woher: Aus GET /repos/{owner}/{repo}/branches/{branch} der Gitea-REST-API.
   * Wo: Im Repository-Read-Service.
   * Soll-Ergebnis: Sicherer Zugriff ohne Fremdnamespace oder Pfadinjektion.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param branchName Name des Branches.
   * @returns Branch-Details von Gitea.
   */
  public async getBranch(owner: string, repositoryName: string, branchName: string): Promise<GiteaBranch> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaBranch>(
      `${this.repositoryPath(owner, repositoryName)}/branches/${encodeURIComponent(branchName)}`,
    );
  }

  /**
   * Listet Commits eines freigegebenen Repositories mit optionalem Ref- und Pfadfilter.
   *
   * Was: Ruft die paginierte Commit-Liste ab.
   * Warum: Änderungen müssen ohne lokalen Git-Checkout nachvollziehbar sein.
   * Wofür: Für das schreibgeschützte Tool gitea_list_commits.
   * Woher: Aus GET /repos/{owner}/{repo}/commits der Gitea-REST-API.
   * Wo: Im Repository-Read-Service.
   * Soll-Ergebnis: Gefilterte Commit-Metadaten innerhalb des erlaubten Owners.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Commits.
   * @param sha Optionale Branch- oder SHA-Referenz.
   * @param path Optionaler repositoryrelativer Pfadfilter.
   * @returns Commit-Liste von Gitea.
   */
  public async listCommits(
    owner: string,
    repositoryName: string,
    page: number,
    limit: number,
    sha?: string,
    path?: string,
  ): Promise<GiteaCommit[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaCommit[]>(`${this.repositoryPath(owner, repositoryName)}/commits`, {
      query: { page, limit, sha, path, stat: false, verification: true, files: false },
    });
  }

  /**
   * Liest Commit-Details ohne ungebremste Dateiliste und Diff-Statistik.
   *
   * Was: Ruft einen einzelnen Commit über SHA oder Git-Referenz ab.
   * Warum: Große Commit-Antworten müssen standardmäßig begrenzt bleiben.
   * Wofür: Für das schreibgeschützte Tool gitea_get_commit.
   * Woher: Aus GET /repos/{owner}/{repo}/git/commits/{sha} der Gitea-REST-API.
   * Wo: Im Repository-Read-Service.
   * Soll-Ergebnis: Commit-Metadaten ohne unnötig große Nutzlast.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param sha SHA oder Git-Referenz.
   * @returns Commit-Details von Gitea.
   */
  public async getCommit(owner: string, repositoryName: string, sha: string): Promise<GiteaCommit> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaCommit>(
      `${this.repositoryPath(owner, repositoryName)}/git/commits/${encodeURIComponent(sha)}`,
      { query: { stat: false, verification: true, files: false } },
    );
  }

  /**
   * Listet Pull Requests eines freigegebenen Repositories.
   *
   * Was: Ruft die paginierte Pull-Request-Liste mit State- und Base-Branch-Filter ab.
   * Warum: Code-Review-Status soll ohne mutierende Operationen sichtbar sein.
   * Wofür: Für das schreibgeschützte Tool gitea_list_pull_requests.
   * Woher: Aus GET /repos/{owner}/{repo}/pulls der Gitea-REST-API.
   * Wo: Im Collaboration-Read-Service.
   * Soll-Ergebnis: Pull-Request-Daten nur für den erlaubten Namespace.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Pull Requests.
   * @param state Gewünschter State: open, closed oder all.
   * @param baseBranch Optionaler Zielbranchfilter.
   * @returns Pull-Request-Liste von Gitea.
   */
  public async listPullRequests(
    owner: string,
    repositoryName: string,
    page: number,
    limit: number,
    state: "open" | "closed" | "all",
    baseBranch?: string,
  ): Promise<GiteaPullRequest[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaPullRequest[]>(`${this.repositoryPath(owner, repositoryName)}/pulls`, {
      query: { page, limit, state, base_branch: baseBranch },
    });
  }

  /**
   * Liest die Details eines Pull Requests eines freigegebenen Repositories.
   *
   * Was: Ruft einen Pull Request über seine positive Repository-Indexnummer ab.
   * Warum: Detaildaten müssen getrennt von der paginierten Übersicht zugänglich sein.
   * Wofür: Für das schreibgeschützte Tool gitea_get_pull_request.
   * Woher: Aus GET /repos/{owner}/{repo}/pulls/{index} der Gitea-REST-API.
   * Wo: Im Collaboration-Read-Service.
   * Soll-Ergebnis: Pull-Request-Details ohne Mutation.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param pullRequestIndex Repository-lokale Pull-Request-Indexnummer.
   * @returns Pull-Request-Details von Gitea.
   */
  public async getPullRequest(
    owner: string,
    repositoryName: string,
    pullRequestIndex: number,
  ): Promise<GiteaPullRequest> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaPullRequest>(
      `${this.repositoryPath(owner, repositoryName)}/pulls/${encodeURIComponent(String(pullRequestIndex))}`,
    );
  }

  /**
   * Listet Issues eines freigegebenen Repositories und schließt Pull Requests aus.
   *
   * Was: Ruft die paginierte Issue-Liste mit State- und Volltextfilter ab.
   * Warum: Aufgaben und Defekte müssen separat von Pull Requests sichtbar bleiben.
   * Wofür: Für das schreibgeschützte Tool gitea_list_issues.
   * Woher: Aus GET /repos/{owner}/{repo}/issues der Gitea-REST-API.
   * Wo: Im Collaboration-Read-Service.
   * Soll-Ergebnis: Ausschließlich reguläre Issues im erlaubten Namespace.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Issues.
   * @param state Gewünschter State: open, closed oder all.
   * @param query Optionaler Gitea-Volltextfilter.
   * @returns Issue-Liste von Gitea.
   */
  public async listIssues(
    owner: string,
    repositoryName: string,
    page: number,
    limit: number,
    state: "open" | "closed" | "all",
    query?: string,
  ): Promise<GiteaIssue[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaIssue[]>(`${this.repositoryPath(owner, repositoryName)}/issues`, {
      query: { page, limit, state, q: query, type: "issues" },
    });
  }

  /**
   * Liest die Details eines Issues eines freigegebenen Repositories.
   *
   * Was: Ruft ein Issue über seine positive Repository-Indexnummer ab.
   * Warum: Detaildaten müssen ohne Suchantwort oder Mutation abrufbar sein.
   * Wofür: Für das schreibgeschützte Tool gitea_get_issue.
   * Woher: Aus GET /repos/{owner}/{repo}/issues/{index} der Gitea-REST-API.
   * Wo: Im Collaboration-Read-Service.
   * Soll-Ergebnis: Issue-Details nur im erlaubten Namespace.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param issueIndex Repository-lokale Issue-Indexnummer.
   * @returns Issue-Details von Gitea.
   */
  public async getIssue(owner: string, repositoryName: string, issueIndex: number): Promise<GiteaIssue> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaIssue>(
      `${this.repositoryPath(owner, repositoryName)}/issues/${encodeURIComponent(String(issueIndex))}`,
    );
  }

  /**
   * Listet Jobs eines Workflow-Runs eines freigegebenen Repositories.
   *
   * Was: Ruft die paginierte Job-Liste eines Actions-Runs ab.
   * Warum: Der Run-Status allein enthält keine Ausführungsdetails pro Job.
   * Wofür: Für das schreibgeschützte Tool gitea_list_workflow_jobs.
   * Woher: Aus GET /repos/{owner}/{repo}/actions/runs/{run}/jobs der Gitea-Actions-API.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Jobstatus und Schrittmetadaten des erlaubten Repository-Runs.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param runId Numerische Workflow-Run-ID.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Jobs.
   * @returns Paginierte Job-Antwort von Gitea.
   */
  public async listWorkflowJobs(
    owner: string,
    repositoryName: string,
    runId: number,
    page: number,
    limit: number,
  ): Promise<GiteaListResponse<GiteaWorkflowJob>> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaListResponse<GiteaWorkflowJob>>(
      `${this.repositoryPath(owner, repositoryName)}/actions/runs/${encodeURIComponent(String(runId))}/jobs`,
      { query: { page, limit } },
    );
  }

  /**
   * Liest Job-Logs mit einer expliziten, lokal erzwungenen Zeichenbegrenzung.
   *
   * Was: Lädt Textlogs eines Actions-Jobs und liefert nur den angeforderten Präfix zurück.
   * Warum: Unbegrenzte Logantworten könnten MCP-Clients und Speicher unnötig belasten.
   * Wofür: Für das schreibgeschützte Tool gitea_get_workflow_job_log.
   * Woher: Aus GET /repos/{owner}/{repo}/actions/jobs/{job}/logs der Gitea-Actions-API.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Nachvollziehbare Logs mit transparenter Trunkierungsmarkierung.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param jobId Numerische Actions-Job-ID.
   * @param maxCharacters Höchstzahl zurückgegebener Zeichen.
   * @returns Logtext inklusive Metadaten zur Trunkierung.
   */
  public async getWorkflowJobLog(
    owner: string,
    repositoryName: string,
    jobId: number,
    maxCharacters: number,
  ): Promise<{ readonly jobId: number; readonly content: string; readonly truncated: boolean }> {
    this.assertAllowedOwner(owner);
    const content = await this.requestText(
      `${this.repositoryPath(owner, repositoryName)}/actions/jobs/${encodeURIComponent(String(jobId))}/logs`,
    );
    return {
      jobId,
      content: content.slice(0, maxCharacters),
      truncated: content.length > maxCharacters,
    };
  }

  /**
   * Listet die für ein freigegebenes Repository sichtbaren Actions-Runner.
   *
   * Was: Ruft die paginierte Runner-Liste ab.
   * Warum: CI-Ausführbarkeit und Kapazität sollen ohne Admin-Token sichtbar sein.
   * Wofür: Für das schreibgeschützte Tool gitea_list_runners.
   * Woher: Aus GET /repos/{owner}/{repo}/actions/runners der Gitea-Actions-API.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Runner-Status ausschließlich im freigegebenen Namespace.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Runnern.
   * @returns Paginierte Runner-Antwort von Gitea.
   */
  public async listRunners(
    owner: string,
    repositoryName: string,
    page: number,
    limit: number,
  ): Promise<GiteaListResponse<GiteaRunner>> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaListResponse<GiteaRunner>>(
      `${this.repositoryPath(owner, repositoryName)}/actions/runners`,
      { query: { page, limit } },
    );
  }

  /**
   * Liest die Details eines Actions-Runners eines freigegebenen Repositories.
   *
   * Was: Ruft einen Runner über seine numerische ID ab.
   * Warum: Status- und Labeldaten einzelner Runner müssen gezielt prüfbar sein.
   * Wofür: Für das schreibgeschützte Tool gitea_get_runner.
   * Woher: Aus GET /repos/{owner}/{repo}/actions/runners/{runner_id} der Gitea-Actions-API.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Runner-Details ohne Admin- oder Mutationszugriff.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param runnerId Numerische Runner-ID.
   * @returns Runner-Details von Gitea.
   */
  public async getRunner(owner: string, repositoryName: string, runnerId: number): Promise<GiteaRunner> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaRunner>(
      `${this.repositoryPath(owner, repositoryName)}/actions/runners/${encodeURIComponent(String(runnerId))}`,
    );
  }

  /**
   * Listet Artifacts eines Repositorys oder eines einzelnen Workflow-Runs.
   *
   * Was: Wählt abhängig von runId den Repository- oder Run-spezifischen Artifact-Endpunkt.
   * Warum: Build-Ergebnisse sollen auffindbar bleiben, ohne Dateien unkontrolliert herunterzuladen.
   * Wofür: Für das schreibgeschützte Tool gitea_list_artifacts.
   * Woher: Aus den Gitea-Actions-Artifact-Endpunkten.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Artifact-Metadaten mit optionalem Run- und Namensfilter.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param runId Optionale Workflow-Run-ID.
   * @param name Optionaler Artifact-Namensfilter.
   * @returns Paginierte Artifact-Antwort von Gitea.
   */
  public async listArtifacts(
    owner: string,
    repositoryName: string,
    runId?: number,
    name?: string,
  ): Promise<GiteaListResponse<GiteaArtifact>> {
    this.assertAllowedOwner(owner);
    const actionsPath = `${this.repositoryPath(owner, repositoryName)}/actions`;
    const path = runId
      ? `${actionsPath}/runs/${encodeURIComponent(String(runId))}/artifacts`
      : `${actionsPath}/artifacts`;
    return this.request<GiteaListResponse<GiteaArtifact>>(path, { query: { name } });
  }

  /**
   * Liest die Metadaten eines einzelnen Actions-Artifacts ohne Download.
   *
   * Was: Ruft Artifact-Metadaten einschließlich Ablauf- und Download-URL ab.
   * Warum: Der MCP-Server soll Binärdownloads nicht verdeckt in den Prozessspeicher laden.
   * Wofür: Für das schreibgeschützte Tool gitea_get_artifact.
   * Woher: Aus GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id} der Gitea-Actions-API.
   * Wo: Im Actions-Read-Service.
   * Soll-Ergebnis: Transparente Artifact-Metadaten, keine Binärübertragung.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param artifactId Numerische Artifact-ID.
   * @returns Artifact-Metadaten von Gitea.
   */
  public async getArtifact(owner: string, repositoryName: string, artifactId: number): Promise<GiteaArtifact> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaArtifact>(
      `${this.repositoryPath(owner, repositoryName)}/actions/artifacts/${encodeURIComponent(String(artifactId))}`,
    );
  }

  /**
   * Listet Releases eines freigegebenen Repositories ohne Asset-Binärdaten zu laden.
   *
   * Was: Ruft die paginierte Release-Liste mit Draft- und Prerelease-Filtern ab.
   * Warum: DBZS-Updateentscheidungen benötigen nachvollziehbare Release-Metadaten, aber keine verdeckten Downloads.
   * Wofür: Für das schreibgeschützte MCP-Tool `gitea_list_releases`.
   * Woher: Aus GET /repos/{owner}/{repo}/releases der Gitea-REST-API.
   * Wo: Im Gitea-Release-Adapter hinter der Owner-Policy.
   * Soll-Ergebnis: Release-Daten ausschließlich im freigegebenen Namespace.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Releases.
   * @param includeDrafts Ob Draft-Releases von Gitea berücksichtigt werden sollen.
   * @param includePrereleases Ob Vorabversionen von Gitea berücksichtigt werden sollen.
   * @returns Paginierte Release-Liste.
   */
  public async listReleases(
    owner: string,
    repositoryName: string,
    page: number,
    limit: number,
    includeDrafts: boolean,
    includePrereleases: boolean,
  ): Promise<GiteaRelease[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaRelease[]>(`${this.repositoryPath(owner, repositoryName)}/releases`, {
      query: { page, limit, draft: includeDrafts, "pre-release": includePrereleases },
    });
  }

  /**
   * Liest die Asset-Metadaten eines Releases ohne Binärtransfer.
   *
   * Was: Ruft die Release-Attachment-Liste ab.
   * Warum: Installer und Update-Services brauchen Name, Größe und Download-URL, dürfen Assets jedoch nicht heimlich herunterladen.
   * Wofür: Für das schreibgeschützte MCP-Tool `gitea_list_release_assets`.
   * Woher: Aus GET /repos/{owner}/{repo}/releases/{id}/assets der Gitea-REST-API.
   * Wo: Im Gitea-Release-Adapter hinter der Owner-Policy.
   * Soll-Ergebnis: Ausschließlich Metadaten des abgefragten Releases.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param releaseId Numerische Release-ID.
   * @returns Liste der Release-Asset-Metadaten.
   */
  public async listReleaseAssets(owner: string, repositoryName: string, releaseId: number): Promise<GiteaReleaseAsset[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaReleaseAsset[]>(
      `${this.repositoryPath(owner, repositoryName)}/releases/${encodeURIComponent(String(releaseId))}/assets`,
    );
  }

  /**
   * Listet Packages des freigegebenen Owners.
   *
   * Was: Ruft den ownerbasierten Package-Registry-Endpunkt auf.
   * Warum: Packages sind in Gitea owner- und nicht repositorygebunden; dieselbe Namespace-Policy muss daher explizit greifen.
   * Wofür: Für das schreibgeschützte MCP-Tool `gitea_list_packages`.
   * Woher: Aus GET /packages/{owner} der Gitea-REST-API.
   * Wo: Im Package-Registry-Adapter.
   * Soll-Ergebnis: Paginierte Package-Metadaten ohne Mutationen oder Downloads.
   *
   * @param owner Angefragter Package-Owner.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Packages.
   * @param packageType Optionaler Gitea-Package-Typ.
   * @param query Optionaler Package-Namensfilter.
   * @returns Paginierte Package-Liste.
   */
  public async listPackages(
    owner: string,
    page: number,
    limit: number,
    packageType?: string,
    query?: string,
  ): Promise<GiteaPackage[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaPackage[]>(`/packages/${encodeURIComponent(owner)}`, {
      query: { page, limit, type: packageType, q: query },
    });
  }

  /**
   * Listet alle sichtbaren Versionen eines Owner-Package-Namens.
   *
   * Was: Ruft die Versionen eines nach Typ und Name präzisierten Packages ab.
   * Warum: Updateplanung muss verfügbare Versionen sehen, ohne Registry-Daten zu verändern.
   * Wofür: Für das schreibgeschützte MCP-Tool `gitea_list_package_versions`.
   * Woher: Aus GET /packages/{owner}/{type}/{name} der Gitea-REST-API.
   * Wo: Im Package-Registry-Adapter hinter Owner-Policy und Segmentkodierung.
   * Soll-Ergebnis: Sichere Versionsmetadaten für den erlaubten Owner.
   *
   * @param owner Angefragter Package-Owner.
   * @param packageType Gitea-Package-Typ.
   * @param packageName Package-Name.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Versionen.
   * @returns Paginierte Package-Versionsliste.
   */
  public async listPackageVersions(
    owner: string,
    packageType: string,
    packageName: string,
    page: number,
    limit: number,
  ): Promise<GiteaPackage[]> {
    this.assertAllowedOwner(owner);
    return this.request<GiteaPackage[]>(
      `/packages/${encodeURIComponent(owner)}/${encodeURIComponent(packageType)}/${encodeURIComponent(packageName)}`,
      { query: { page, limit } },
    );
  }

  /**
   * Listet gesäuberte Repository-Webhooks ohne Secret- oder Authorization-Header-Offenlegung.
   *
   * Was: Ruft Hooks ab und entfernt sensible Konfigurationsschlüssel vor der Rückgabe.
   * Warum: Ein MCP-Read-Tool darf die Konfiguration nicht als Secret-Exfiltrationspfad missbrauchen.
   * Wofür: Für das schreibgeschützte MCP-Tool `gitea_list_webhooks`.
   * Woher: Aus GET /repos/{owner}/{repo}/hooks der Gitea-REST-API.
   * Wo: Im Gitea-Webhook-Adapter hinter der Owner-Policy.
   * Soll-Ergebnis: Prüffähige Hook-Metadaten ohne geheime Werte.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param page Angefragte 1-basierte Seite.
   * @param limit Maximale Anzahl von Hooks.
   * @returns Bereinigte Hook-Liste.
   */
  public async listWebhooks(owner: string, repositoryName: string, page: number, limit: number): Promise<GiteaWebhook[]> {
    this.assertAllowedOwner(owner);
    const hooks = await this.request<GiteaWebhook[]>(`${this.repositoryPath(owner, repositoryName)}/hooks`, {
      query: { page, limit },
    });
    return hooks.map((hook) => this.sanitizeWebhook(hook));
  }

  /**
   * Erstellt nach expliziter MCP-Bestätigung einen Gitea-Webhook für den lokalen DBZS-Receiver.
   *
   * Was: Sendet einen Gitea-Hook mit JSON-Payload, HMAC-Secret und klarer Eventliste an Gitea.
   * Warum: Die Webhook-Runtime kann nur geprüfte Zustellungen eines absichtlich angelegten Hooks verarbeiten.
   * Wofür: Für das mutierende MCP-Tool `gitea_create_local_webhook` nach `confirm: true`.
   * Woher: Aus POST /repos/{owner}/{repo}/hooks der Gitea-REST-API.
   * Wo: Im Gitea-Webhook-Adapter; Secret wird ausschließlich in der Request-Nutzlast verwendet.
   * Soll-Ergebnis: Gesäuberte Hook-Metadaten ohne Rückgabe des Secrets.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param request Kontrollierte lokale Ziel- und HMAC-Konfiguration.
   * @returns Gesäuberte Metadaten des erzeugten Hooks.
   */
  public async createLocalWebhook(
    owner: string,
    repositoryName: string,
    request: GiteaWebhookCreateRequest,
  ): Promise<GiteaWebhook> {
    this.assertAllowedOwner(owner);
    const webhook = await this.request<GiteaWebhook>(`${this.repositoryPath(owner, repositoryName)}/hooks`, {
      method: "POST",
      body: {
        type: "gitea",
        active: true,
        events: request.events,
        branch_filter: request.branchFilter ?? "*",
        config: {
          url: request.targetUrl,
          content_type: "json",
          secret: request.secret,
        },
      },
    });
    return this.sanitizeWebhook(webhook);
  }

  /**
   * Entfernt nach expliziter MCP-Bestätigung einen Repository-Webhook.
   *
   * Was: Führt den Hook-Delete-Endpunkt aus.
   * Warum: Remote-Webhook-Konfiguration ist eine Mutation und darf nur bewusst zurückgenommen werden.
   * Wofür: Für das mutierende MCP-Tool `gitea_delete_webhook` nach `confirm: true`.
   * Woher: Aus DELETE /repos/{owner}/{repo}/hooks/{id} der Gitea-REST-API.
   * Wo: Im Gitea-Webhook-Adapter hinter Owner-Policy.
   * Soll-Ergebnis: Die Gitea-API bestätigt die Löschung, ohne eine lokale Nebenliste zu führen.
   *
   * @param owner Angefragter Owner.
   * @param repositoryName Angefragter Repositoryname.
   * @param webhookId Numerische Hook-ID.
   */
  public async deleteWebhook(owner: string, repositoryName: string, webhookId: number): Promise<void> {
    this.assertAllowedOwner(owner);
    await this.request<unknown>(
      `${this.repositoryPath(owner, repositoryName)}/hooks/${encodeURIComponent(String(webhookId))}`,
      { method: "DELETE" },
    );
  }

  /**
   * Bereinigt sensible Hook-Responsefelder vor der MCP-Ausgabe.
   *
   * Was: Kopiert sichere Metadaten und verwirft Secret- sowie Authorization-Werte aus äußeren und config-Feldern.
   * Warum: Hook-Listen dürfen niemals zum Auslesen von HMAC-Schlüsseln oder Zugangsdaten dienen.
   * Wofür: Für alle Webhook-Read- und Write-Ergebnisse.
   * Woher: Aus der Gitea-Hook-Antwort.
   * Wo: An der Adapter-Ausgabegrenze vor MCP.
   * Soll-Ergebnis: Funktionsfähige, aber nicht sensible Hook-Diagnosedaten.
   *
   * @param webhook Gitea-Hook-Antwort.
   * @returns Bereinigte Hook-Metadaten.
   */
  private sanitizeWebhook(webhook: GiteaWebhook): GiteaWebhook {
    const config = { ...(webhook.config ?? {}) };
    for (const key of Object.keys(config)) {
      if (["secret", "authorization", "authorization_header", "token", "password"].includes(key.toLowerCase())) {
        delete config[key];
      }
    }

    const { authorization_header: _authorizationHeader, ...safeWebhook } = webhook;
    return { ...safeWebhook, config };
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
  private async request<T>(path: string, options: GiteaRequestOptions = {}): Promise<T> {
    const response = await this.requestResponse(path, options);
    if (response.status === 204) {
      return {} as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Gitea hat eine nicht lesbare JSON-Antwort geliefert.", {
        method: options.method ?? "GET",
        path,
        status: response.status,
      });
    }
  }

  /**
   * Führt einen Gitea-Request aus und liefert eine Textantwort mit unveränderter Fehlersemantik.
   *
   * Was: Ruft den zentralen HTTP-Pfad auf und liest danach den Response-Text.
   * Warum: Job-Logs sind Text und dürfen weder als JSON fehlinterpretiert noch ohne Auditpfad abgerufen werden.
   * Wofür: Für die begrenzte Actions-Logabfrage in Phase 2.
   * Woher: Aus der Gitea-Actions-Job-Log-API.
   * Wo: Im Gitea-Adapter oberhalb des gemeinsamen Request-Transports.
   * Soll-Ergebnis: Textlogs mit denselben Headern, Richtlinien und Events wie JSON-Antworten.
   *
   * @param path Relativer /api/v1-Pfad.
   * @param options Kontrollierte Request-Optionen.
   * @returns Vollständige Textantwort vor lokaler Trunkierung.
   */
  private async requestText(path: string, options: GiteaRequestOptions = {}): Promise<string> {
    const response = await this.requestResponse(path, { ...options, accept: options.accept ?? "text/plain, */*" });
    return response.text();
  }

  /**
   * Führt den gemeinsamen authentifizierten und beobachtbaren Gitea-HTTP-Request aus.
   *
   * Was: Baut URL und Header, ruft fetch auf, protokolliert den Prozess und normalisiert HTTP-Fehler.
   * Warum: JSON- und Textendpunkte müssen dieselben Token-, Policy- und Observability-Garantien erhalten.
   * Wofür: Für alle Read- und Write-Methoden dieses Clients.
   * Woher: Aus den öffentlichen Gitea-REST-API-Endpunkten.
   * Wo: Zentral im Gitea-Adapter.
   * Soll-Ergebnis: Eine erfolgreiche Response oder ein strukturierter, sicherer Fehler.
   *
   * @param path Relativer /api/v1-Pfad.
   * @param options HTTP-Methode, Query-Parameter, JSON-Body und Accept-Wert.
   * @returns Erfolgreiche Fetch-Response zur formatspezifischen Weiterverarbeitung.
   */
  private async requestResponse(path: string, options: GiteaRequestOptions = {}): Promise<Response> {
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
          Accept: options.accept ?? "application/json",
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
    return response;
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
