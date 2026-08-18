/**
 * DBZS — Division By Zeros
 * Datei: mcp/server.ts
 * Zweck: DBZS Gitea-, Webhook-, Release-, Registry- und lokale Integrationswerkzeuge mit Eingabevalidierung, Bestätigungs-Gate und Observability registrieren.
 * Version: 0.3.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { toDbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { FleetCommanderClient } from "../integrations/fleet-commander-client.js";
import { FeatureStarterHealthReader } from "../integrations/feature-starter-health-reader.js";
import { FeatureStarterHook } from "../integrations/feature-starter-hook.js";
import { LocalWebhookService } from "../webhooks/local-webhook-service.js";

/**
 * Serialisiert einen beliebigen API-Wert stabil für eine MCP-Textantwort.
 *
 * Was: Wandelt Ergebnisse in eingerücktes JSON um.
 * Warum: Gitea-Antworten sollen ohne proprietäre Transformation transparent verfügbar sein.
 * Wofür: Für alle erfolgreichen Tool-Antworten.
 * Woher: Aus den typisierten Rückgabewerten des Gitea-Clients.
 * Wo: An der letzten Grenze zwischen Service-Layer und MCP-Protokoll.
 * Soll-Ergebnis: Ein lesbarer Textblock mit vollständigen, serialisierbaren Ergebnisdaten.
 *
 * @param value Ergebnisdaten einer Tooloperation.
 * @returns MCP-konforme Textantwort.
 */
function successResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Erstellt eine sichere MCP-Fehlerantwort.
 *
 * Was: Gibt Fehlercode und nutzergeeignete Beschreibung als JSON aus.
 * Warum: Fehler dürfen nicht versteckt werden, aber interne Details und Secrets müssen geschützt bleiben.
 * Wofür: Für jede kontrolliert abgefangene Toolausnahme.
 * Woher: Aus dem zentralen DBZS-Fehlermodell.
 * Wo: An der Fehlergrenze der Toolausführung.
 * Soll-Ergebnis: Der MCP-Client erhält einen auswertbaren Fehler ohne sensible Daten.
 *
 * @param code Stabile DBZS-Fehlerkategorie.
 * @param message Sichere, lesbare Fehlermeldung.
 * @returns MCP-konforme Fehlerantwort.
 */
function failureResult(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }, null, 2) }],
    isError: true as const,
  };
}

/**
 * Führt eine Tooloperation mit einheitlichem EventBus- und Fehlerverhalten aus.
 *
 * Was: Protokolliert Start, Erfolg und Fehler einer bereits validierten Tooloperation.
 * Warum: Business-Operationen bleiben in Services; die MCP-Schicht steuert nur Ein- und Ausgabe.
 * Wofür: Für alle Phase-1-Tools.
 * Woher: Aus der DBZS-Vorgabe für zentrale Orchestrierung, Events und sichtbare Fehler.
 * Wo: An der Grenze zwischen MCP-Handlern und Gitea-Client.
 * Soll-Ergebnis: Konsistente MCP-Ergebnisse und vollständige Observability für jede Toolausführung.
 *
 * @param eventBus Zentraler DBZS-EventBus.
 * @param toolName Stabile Kennung des ausgeführten MCP-Tools.
 * @param operation Asynchrone Geschäftsoperation ohne MCP-Protokolldetails.
 * @returns Ein erfolgreiches oder kontrolliertes fehlerhaftes MCP-Tool-Ergebnis.
 */
async function executeTool(
  eventBus: DbzsEventBus,
  toolName: string,
  operation: () => Promise<unknown>,
) {
  const startedAt = Date.now();
  eventBus.publish("mcp.tool.started", "info", { toolName });

  try {
    const result = await operation();
    eventBus.publish("mcp.tool.completed", "info", {
      toolName,
      durationMs: Date.now() - startedAt,
    });
    return successResult(result);
  } catch (error) {
    const dbzsError = toDbzsError(error);
    eventBus.publish("mcp.tool.failed", "error", {
      toolName,
      durationMs: Date.now() - startedAt,
      errorCode: dbzsError.code,
      errorMessage: dbzsError.message,
      details: dbzsError.details,
    });
    return failureResult(dbzsError.code, dbzsError.message);
  }
}

/**
 * Beschreibt optional verfügbare Phase-3-Integrationsservices.
 */
export interface Phase3Services {
  /** Bestehende lokale Fleet-Commander-Control-Plane; nur Read-Adapter. */
  readonly fleetCommander?: FleetCommanderClient;
  /** Bestehende atomare Feature-Starter-Health-Sicht; nur Read-Adapter. */
  readonly featureStarterHealth?: FeatureStarterHealthReader;
  /** Bestehende Feature-Starter-CLI-Verträge für Update und Installer. */
  readonly featureStarterHook?: FeatureStarterHook;
  /** Lokaler HMAC-Webhook-Registrierungsservice. */
  readonly localWebhook?: LocalWebhookService;
}

/**
 * Registriert alle Phase-1-Tools auf einem offiziellen MCP-v2-Server.
 *
 * Was: Erstellt den Server und bindet Repository- sowie Actions-Operationen an GiteaClient-Methoden.
 * Warum: Die MCP-Transportschicht soll schlank bleiben und keinerlei Gitea-Business-Logik enthalten.
 * Wofür: Für lokale stdio-Clients in Phase 1.
 * Woher: Aus dem bereitgestellten DBZS-Implementierungsplan.
 * Wo: In der Runtime-Fabrik vor dem Anschluss des stdio-Transports.
 * Soll-Ergebnis: Ein vollständig registrierter MCP-Server mit Read-/Write-Trennung und confirm-Gate.
 *
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @returns Konfigurierter MCP-Server ohne verbundenen Transport.
 */
export function createMcpServer(
  giteaClient: GiteaClient,
  eventBus: DbzsEventBus,
  phase3Services: Phase3Services = {},
): McpServer {
  const server = new McpServer({
    name: "dbzs-gitea-mcp",
    version: "0.3.0",
  });

  const ownerSchema = z.string().trim().min(1).max(100);
  const repositorySchema = z.string().trim().min(1).max(255);
  const paginationSchema = z.number().int().min(1).max(100);
  let toolCount = 21;

  server.registerTool(
    "gitea_list_repositories",
    {
      title: "Gitea-Repositories auflisten",
      description: "Liest die für den Token sichtbaren Repositories und gibt ausschließlich Repositories des freigegebenen GITEA_ALLOWED_OWNER zurück.",
      inputSchema: z.object({
        limit: paginationSchema.default(30),
      }),
    },
    async ({ limit }) => executeTool(eventBus, "gitea_list_repositories", () => giteaClient.listRepositories(limit)),
  );

  server.registerTool(
    "gitea_get_repository",
    {
      title: "Gitea-Repository-Metadaten lesen",
      description: "Liest Metadaten eines Repositories im freigegebenen Namespace. Andere Owner werden vor dem Gitea-Aufruf abgewiesen.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
      }),
    },
    async ({ owner, repo }) => executeTool(eventBus, "gitea_get_repository", () => giteaClient.getRepository(owner, repo)),
  );

  server.registerTool(
    "gitea_get_contents",
    {
      title: "Gitea-Datei oder Verzeichnis lesen",
      description: "Liest eine Datei oder ein Verzeichnis im freigegebenen Repository. Der optionale ref-Wert kann Branch, Tag oder Commit sein.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        path: z.string().trim().max(4096).default(""),
        ref: z.string().trim().min(1).max(255).optional(),
      }),
    },
    async ({ owner, repo, path, ref }) =>
      executeTool(eventBus, "gitea_get_contents", () => giteaClient.getContents(owner, repo, path, ref)),
  );

  server.registerTool(
    "gitea_list_workflows",
    {
      title: "Gitea-Actions-Workflows auflisten",
      description: "Liest die registrierten Actions-Workflows eines Repositories im freigegebenen Namespace.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
      }),
    },
    async ({ owner, repo, page, limit }) =>
      executeTool(eventBus, "gitea_list_workflows", () => giteaClient.listWorkflows(owner, repo, page, limit)),
  );

  server.registerTool(
    "gitea_list_workflow_runs",
    {
      title: "Gitea-Actions-Workflow-Runs auflisten",
      description: "Liest Workflow-Runs eines Repositories; workflowId begrenzt die Historie optional auf einen einzelnen Workflow.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        workflowId: z.string().trim().min(1).max(255).optional(),
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
      }),
    },
    async ({ owner, repo, workflowId, page, limit }) =>
      executeTool(eventBus, "gitea_list_workflow_runs", () =>
        giteaClient.listWorkflowRuns(owner, repo, page, limit, workflowId),
      ),
  );

  server.registerTool(
    "gitea_dispatch_workflow",
    {
      title: "Gitea-Workflow manuell auslösen",
      description: "Schreiboperation: Löst nach explizitem confirm: true einen Workflow mit ref und optionalen String-Inputs aus. Gitea wird mit return_run_details=true aufgerufen.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        workflowId: z.string().trim().min(1).max(255),
        ref: z.string().trim().min(1).max(500),
        inputs: z.record(z.string().min(1).max(255), z.string().max(10_000)).default({}),
        confirm: z.literal(true),
      }),
    },
    async ({ owner, repo, workflowId, ref, inputs }) =>
      executeTool(eventBus, "gitea_dispatch_workflow", () =>
        giteaClient.dispatchWorkflow(owner, repo, workflowId, ref, inputs),
      ),
  );

  server.registerTool(
    "gitea_rerun_workflow",
    {
      title: "Gitea-Workflow-Run erneut starten",
      description: "Schreiboperation: Startet nach explizitem confirm: true den vollständigen erneuten Lauf eines bestehenden Workflow-Runs.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        runId: z.number().int().positive(),
        confirm: z.literal(true),
      }),
    },
    async ({ owner, repo, runId }) =>
      executeTool(eventBus, "gitea_rerun_workflow", () => giteaClient.rerunWorkflow(owner, repo, runId)),
  );

  const stateSchema = z.enum(["open", "closed", "all"]);
  const positiveIdSchema = z.number().int().positive();

  server.registerTool(
    "gitea_list_branches",
    {
      title: "Gitea-Branches auflisten",
      description: "Liest Branches einschließlich Schutz- und Head-Commit-Metadaten eines Repositories im freigegebenen Namespace.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, page: paginationSchema.default(1), limit: paginationSchema.default(30) }),
    },
    async ({ owner, repo, page, limit }) =>
      executeTool(eventBus, "gitea_list_branches", () => giteaClient.listBranches(owner, repo, page, limit)),
  );

  server.registerTool(
    "gitea_get_branch",
    {
      title: "Gitea-Branch lesen",
      description: "Liest die Details eines einzelnen Branches im freigegebenen Namespace.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, branch: z.string().trim().min(1).max(500) }),
    },
    async ({ owner, repo, branch }) =>
      executeTool(eventBus, "gitea_get_branch", () => giteaClient.getBranch(owner, repo, branch)),
  );

  server.registerTool(
    "gitea_list_commits",
    {
      title: "Gitea-Commits auflisten",
      description: "Liest Commits eines Repositories; ref und path können die Liste eingrenzen. Große Diff- und Dateilisten werden nicht angefordert.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
        ref: z.string().trim().min(1).max(500).optional(),
        path: z.string().trim().min(1).max(4096).optional(),
      }),
    },
    async ({ owner, repo, page, limit, ref, path }) =>
      executeTool(eventBus, "gitea_list_commits", () => giteaClient.listCommits(owner, repo, page, limit, ref, path)),
  );

  server.registerTool(
    "gitea_get_commit",
    {
      title: "Gitea-Commit lesen",
      description: "Liest Metadaten eines einzelnen Commits oder einer Git-Referenz ohne ungebremste Diff- und Dateilisten.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, sha: z.string().trim().min(1).max(500) }),
    },
    async ({ owner, repo, sha }) =>
      executeTool(eventBus, "gitea_get_commit", () => giteaClient.getCommit(owner, repo, sha)),
  );

  server.registerTool(
    "gitea_list_pull_requests",
    {
      title: "Gitea-Pull-Requests auflisten",
      description: "Liest Pull Requests eines Repositories mit Status- und optionalem Zielbranchfilter. Die Operation ist schreibgeschützt.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        state: stateSchema.default("open"),
        baseBranch: z.string().trim().min(1).max(500).optional(),
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
      }),
    },
    async ({ owner, repo, state, baseBranch, page, limit }) =>
      executeTool(eventBus, "gitea_list_pull_requests", () =>
        giteaClient.listPullRequests(owner, repo, page, limit, state, baseBranch),
      ),
  );

  server.registerTool(
    "gitea_get_pull_request",
    {
      title: "Gitea-Pull-Request lesen",
      description: "Liest Details eines einzelnen Pull Requests anhand seiner Repository-Indexnummer.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, index: positiveIdSchema }),
    },
    async ({ owner, repo, index }) =>
      executeTool(eventBus, "gitea_get_pull_request", () => giteaClient.getPullRequest(owner, repo, index)),
  );

  server.registerTool(
    "gitea_list_issues",
    {
      title: "Gitea-Issues auflisten",
      description: "Liest reguläre Issues, nicht Pull Requests, mit Status- und optionalem Volltextfilter. Die Operation ist schreibgeschützt.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        state: stateSchema.default("open"),
        query: z.string().trim().min(1).max(500).optional(),
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
      }),
    },
    async ({ owner, repo, state, query, page, limit }) =>
      executeTool(eventBus, "gitea_list_issues", () => giteaClient.listIssues(owner, repo, page, limit, state, query)),
  );

  server.registerTool(
    "gitea_get_issue",
    {
      title: "Gitea-Issue lesen",
      description: "Liest Details eines einzelnen Issues anhand seiner Repository-Indexnummer.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, index: positiveIdSchema }),
    },
    async ({ owner, repo, index }) =>
      executeTool(eventBus, "gitea_get_issue", () => giteaClient.getIssue(owner, repo, index)),
  );

  server.registerTool(
    "gitea_list_workflow_jobs",
    {
      title: "Gitea-Actions-Workflow-Jobs auflisten",
      description: "Liest die Jobs eines Workflow-Runs einschließlich Status, Zeitstempeln und Schrittmetadaten.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        runId: positiveIdSchema,
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
      }),
    },
    async ({ owner, repo, runId, page, limit }) =>
      executeTool(eventBus, "gitea_list_workflow_jobs", () => giteaClient.listWorkflowJobs(owner, repo, runId, page, limit)),
  );

  server.registerTool(
    "gitea_get_workflow_job_log",
    {
      title: "Gitea-Actions-Job-Log lesen",
      description: "Liest das Log eines Workflow-Jobs als Text. maxCharacters begrenzt die Antwort lokal und meldet eine Trunkierung transparent.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        jobId: positiveIdSchema,
        maxCharacters: z.number().int().min(1_000).max(100_000).default(50_000),
      }),
    },
    async ({ owner, repo, jobId, maxCharacters }) =>
      executeTool(eventBus, "gitea_get_workflow_job_log", () =>
        giteaClient.getWorkflowJobLog(owner, repo, jobId, maxCharacters),
      ),
  );

  server.registerTool(
    "gitea_list_runners",
    {
      title: "Gitea-Actions-Runner auflisten",
      description: "Liest Status, Labels und Aktivitätsmetadaten der für ein Repository sichtbaren Actions-Runner.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, page: paginationSchema.default(1), limit: paginationSchema.default(30) }),
    },
    async ({ owner, repo, page, limit }) =>
      executeTool(eventBus, "gitea_list_runners", () => giteaClient.listRunners(owner, repo, page, limit)),
  );

  server.registerTool(
    "gitea_get_runner",
    {
      title: "Gitea-Actions-Runner lesen",
      description: "Liest Details eines einzelnen für das Repository sichtbaren Actions-Runners.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, runnerId: positiveIdSchema }),
    },
    async ({ owner, repo, runnerId }) =>
      executeTool(eventBus, "gitea_get_runner", () => giteaClient.getRunner(owner, repo, runnerId)),
  );

  server.registerTool(
    "gitea_list_artifacts",
    {
      title: "Gitea-Actions-Artifacts auflisten",
      description: "Liest Artifact-Metadaten eines Repositories oder eines Workflow-Runs. Es werden keine Binärdaten heruntergeladen.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        runId: positiveIdSchema.optional(),
        name: z.string().trim().min(1).max(500).optional(),
      }),
    },
    async ({ owner, repo, runId, name }) =>
      executeTool(eventBus, "gitea_list_artifacts", () => giteaClient.listArtifacts(owner, repo, runId, name)),
  );

  server.registerTool(
    "gitea_get_artifact",
    {
      title: "Gitea-Actions-Artifact lesen",
      description: "Liest Metadaten eines einzelnen Artifacts einschließlich einer von Gitea gelieferten Download-URL, ohne das Artifact herunterzuladen.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, artifactId: positiveIdSchema }),
    },
    async ({ owner, repo, artifactId }) =>
      executeTool(eventBus, "gitea_get_artifact", () => giteaClient.getArtifact(owner, repo, artifactId)),
  );

  server.registerTool(
    "gitea_list_releases",
    {
      title: "Gitea-Releases auflisten",
      description: "Liest paginierte Release-Metadaten inklusive sicherer Asset-Metadaten. Es werden keine Archive oder Release Assets heruntergeladen.",
      inputSchema: z.object({
        owner: ownerSchema,
        repo: repositorySchema,
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
        includeDrafts: z.boolean().default(false),
        includePrereleases: z.boolean().default(true),
      }),
    },
    async ({ owner, repo, page, limit, includeDrafts, includePrereleases }) =>
      executeTool(eventBus, "gitea_list_releases", () =>
        giteaClient.listReleases(owner, repo, page, limit, includeDrafts, includePrereleases),
      ),
  );
  toolCount += 1;

  server.registerTool(
    "gitea_list_release_assets",
    {
      title: "Gitea-Release-Assets auflisten",
      description: "Liest Metadaten und Gitea-Download-URLs der Assets eines Releases, ohne Binärdaten zu laden.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, releaseId: positiveIdSchema }),
    },
    async ({ owner, repo, releaseId }) =>
      executeTool(eventBus, "gitea_list_release_assets", () => giteaClient.listReleaseAssets(owner, repo, releaseId)),
  );
  toolCount += 1;

  server.registerTool(
    "gitea_list_packages",
    {
      title: "Gitea-Package-Registry auflisten",
      description: "Liest ownerbasierte Package-Registry-Metadaten im freigegebenen Namespace ohne Download, Upload oder Löschung.",
      inputSchema: z.object({
        owner: ownerSchema,
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
        packageType: z.string().trim().regex(/^[a-z][a-z0-9-]{0,30}$/).optional(),
        query: z.string().trim().min(1).max(255).optional(),
      }),
    },
    async ({ owner, page, limit, packageType, query }) =>
      executeTool(eventBus, "gitea_list_packages", () => giteaClient.listPackages(owner, page, limit, packageType, query)),
  );
  toolCount += 1;

  server.registerTool(
    "gitea_list_package_versions",
    {
      title: "Gitea-Package-Versionen auflisten",
      description: "Liest Versionen eines ownerbasierten Gitea-Packages im freigegebenen Namespace ohne Registry-Mutation.",
      inputSchema: z.object({
        owner: ownerSchema,
        packageType: z.string().trim().regex(/^[a-z][a-z0-9-]{0,30}$/),
        packageName: z.string().trim().min(1).max(255),
        page: paginationSchema.default(1),
        limit: paginationSchema.default(30),
      }),
    },
    async ({ owner, packageType, packageName, page, limit }) =>
      executeTool(eventBus, "gitea_list_package_versions", () =>
        giteaClient.listPackageVersions(owner, packageType, packageName, page, limit),
      ),
  );
  toolCount += 1;

  server.registerTool(
    "gitea_list_webhooks",
    {
      title: "Gitea-Repository-Webhooks auflisten",
      description: "Liest gesäuberte Hook-Metadaten eines Repositories. Secrets und Authorization-Header werden nie ausgegeben.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, page: paginationSchema.default(1), limit: paginationSchema.default(30) }),
    },
    async ({ owner, repo, page, limit }) =>
      executeTool(eventBus, "gitea_list_webhooks", () => giteaClient.listWebhooks(owner, repo, page, limit)),
  );
  toolCount += 1;

  if (phase3Services.localWebhook) {
    const webhookEventSchema = z.enum(["push", "release", "package", "workflow_run", "workflow_job", "pull_request", "issues"]);
    server.registerTool(
      "gitea_create_local_webhook",
      {
        title: "Lokalen DBZS Gitea-Webhook erstellen",
        description: "Schreiboperation: Erstellt nach confirm: true einen signierten Gitea-Webhook ausschließlich für den vorab konfigurierten lokalen DBZS-Receiver. Zieladresse und Secret sind nicht über MCP veränderbar.",
        inputSchema: z.object({
          owner: ownerSchema,
          repo: repositorySchema,
          events: z.array(webhookEventSchema).min(1).max(7),
          branchFilter: z.string().trim().min(1).max(500).optional(),
          confirm: z.literal(true),
        }),
      },
      async ({ owner, repo, events, branchFilter }) =>
        executeTool(eventBus, "gitea_create_local_webhook", () => phase3Services.localWebhook!.create(owner, repo, events, branchFilter)),
    );
    toolCount += 1;

    server.registerTool(
      "gitea_delete_local_webhook",
      {
        title: "Lokalen DBZS Gitea-Webhook entfernen",
        description: "Schreiboperation: Entfernt nach confirm: true ausschließlich einen Hook, dessen sichtbare Zieladresse dem konfigurierten lokalen DBZS-Receiver entspricht.",
        inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, webhookId: positiveIdSchema, confirm: z.literal(true) }),
      },
      async ({ owner, repo, webhookId }) =>
        executeTool(eventBus, "gitea_delete_local_webhook", async () => {
          const hooks = await giteaClient.listWebhooks(owner, repo, 1, 100);
          const webhook = hooks.find((candidate) => candidate.id === webhookId);
          if (!webhook) {
            throw new Error("Der angeforderte Gitea-Webhook wurde nicht gefunden oder ist nicht sichtbar.");
          }
          phase3Services.localWebhook!.assertLocalTarget(webhook);
          await phase3Services.localWebhook!.remove(owner, repo, webhookId);
          return { deleted: true, webhookId };
        }),
    );
    toolCount += 1;
  }

  if (phase3Services.fleetCommander) {
    const fleetCommander = phase3Services.fleetCommander;
    const fleetTools: ReadonlyArray<readonly [string, string, () => Promise<unknown>]> = [
      ["dbzs_get_fleet_health", "Liest den versionierten Healthstatus der bestehenden lokalen DBZS Fleet Commander Control Plane.", () => fleetCommander.getHealth()],
      ["dbzs_get_fleet_dashboard", "Liest die durch Fleet Commander besessene Dashboard-Projektion ohne Runtime-Mutation.", () => fleetCommander.getDashboard()],
      ["dbzs_get_fleet_operating_status", "Liest Commissioning-, Production- und Maintenance-Status aus der bestehenden Fleet Control Plane.", () => fleetCommander.getOperatingStatus()],
      ["dbzs_list_fleet_services", "Liest die von Fleet Commander verwalteten Ready-Service-Projektionen ohne Operator-Aktion.", () => fleetCommander.getServices()],
      ["dbzs_list_fleet_events", "Liest jüngste Fleet-Commander-Ereignisse für lokale Diagnosezwecke.", () => fleetCommander.getEvents()],
    ];
    for (const [name, description, operation] of fleetTools) {
      server.registerTool(name, { title: name, description, inputSchema: z.object({}) }, async () => executeTool(eventBus, name, operation));
      toolCount += 1;
    }
  }

  if (phase3Services.featureStarterHealth) {
    const featureStarterHealth = phase3Services.featureStarterHealth;
    server.registerTool(
      "dbzs_get_feature_starter_health",
      {
        title: "DBZS Feature Starter Plattformstatus lesen",
        description: "Liest ausschließlich die atomar publizierte read-only platform-health.json. Feature Starter bleibt kanonischer Bootstrap- und Lifecycle-Controller.",
        inputSchema: z.object({}),
      },
      async () => executeTool(eventBus, "dbzs_get_feature_starter_health", () => featureStarterHealth.readHealth()),
    );
    toolCount += 1;
  }

  if (phase3Services.featureStarterHook) {
    const featureStarterHook = phase3Services.featureStarterHook;
    server.registerTool(
      "dbzs_check_feature_starter_updates",
      {
        title: "DBZS Feature Starter Updates prüfen",
        description: "Delegiert eine schreibgeschützte Update-Prüfung an den bestehenden DBZS Feature Starter. Die bestehende Update-Logik, Historie und Worktree-Policy bleiben dort verankert.",
        inputSchema: z.object({}),
      },
      async () => executeTool(eventBus, "dbzs_check_feature_starter_updates", () => featureStarterHook.checkUpdates()),
    );
    toolCount += 1;

    server.registerTool(
      "dbzs_apply_feature_starter_updates",
      {
        title: "DBZS Feature Starter Updates anwenden",
        description: "Schreiboperation: Delegiert nach confirm: true ausschließlich an den bestehenden transaktionalen Feature-Starter-Update-Manager. Zusätzlich muss DBZS_FEATURE_STARTER_ALLOW_HOOKS=true gesetzt sein.",
        inputSchema: z.object({ confirm: z.literal(true) }),
      },
      async () => executeTool(eventBus, "dbzs_apply_feature_starter_updates", () => featureStarterHook.applyUpdates()),
    );
    toolCount += 1;

    server.registerTool(
      "dbzs_run_feature_starter_install_all",
      {
        title: "DBZS Feature Starter Vollinstallation starten",
        description: "Schreiboperation: Delegiert nach confirm: true an den vorhandenen DBZS Feature Starter Installer-CLI-Vertrag. Zusätzlich muss DBZS_FEATURE_STARTER_ALLOW_HOOKS=true gesetzt sein.",
        inputSchema: z.object({ confirm: z.literal(true) }),
      },
      async () => executeTool(eventBus, "dbzs_run_feature_starter_install_all", () => featureStarterHook.installAll()),
    );
    toolCount += 1;
  }

  eventBus.publish("mcp.server.tools_registered", "info", {
    toolCount,
    localWebhookEnabled: Boolean(phase3Services.localWebhook),
    fleetCommanderEnabled: Boolean(phase3Services.fleetCommander),
    featureStarterHealthEnabled: Boolean(phase3Services.featureStarterHealth),
    featureStarterHookEnabled: Boolean(phase3Services.featureStarterHook),
  });
  return server;
}
