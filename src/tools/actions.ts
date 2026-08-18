/**
 * DBZS — Division By Zeros
 * Datei: tools/actions.ts
 * Zweck: Gitea-Actions-Tools (Workflows, Runs, Jobs, Logs, Runner) des DBZS Gitea MCP Servers registrieren.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { buildAnnotations, executeTool, ownerSchema, paginationSchema, positiveIdSchema, repositorySchema } from "./shared.js";

/**
 * Registriert die Actions-Tools: Read-Tools für Workflows/Runs/Jobs/Logs/Runner sowie
 * die beiden bestätigungspflichtigen Schreiboperationen Dispatch und Rerun.
 *
 * @param server MCP-Server-Instanz.
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @returns Anzahl der registrierten Tools.
 */
export function registerActionsTools(server: McpServer, giteaClient: GiteaClient, eventBus: DbzsEventBus): number {
  server.registerTool(
    "gitea_list_workflows",
    {
      title: "Gitea-Actions-Workflows auflisten",
      description: "Liest die registrierten Actions-Workflows eines Repositories im freigegebenen Namespace.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, page: paginationSchema.default(1), limit: paginationSchema.default(30) }),
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(true),
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
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, runId: z.number().int().positive(), confirm: z.literal(true) }),
      annotations: buildAnnotations(true),
    },
    async ({ owner, repo, runId }) => executeTool(eventBus, "gitea_rerun_workflow", () => giteaClient.rerunWorkflow(owner, repo, runId)),
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
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, runnerId }) => executeTool(eventBus, "gitea_get_runner", () => giteaClient.getRunner(owner, repo, runnerId)),
  );

  return 8;
}
