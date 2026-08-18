/**
 * DBZS — Division By Zeros
 * Datei: mcp/server.ts
 * Zweck: Phase-1-MCP-Tools mit Eingabevalidierung, Bestätigungs-Gate und DBZS-Observability registrieren.
 * Version: 0.2.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { toDbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";

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
export function createMcpServer(giteaClient: GiteaClient, eventBus: DbzsEventBus): McpServer {
  const server = new McpServer({
    name: "dbzs-gitea-mcp",
    version: "0.2.0",
  });

  const ownerSchema = z.string().trim().min(1).max(100);
  const repositorySchema = z.string().trim().min(1).max(255);
  const paginationSchema = z.number().int().min(1).max(100);

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

  eventBus.publish("mcp.server.tools_registered", "info", { toolCount: 7 });
  return server;
}
