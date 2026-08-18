/**
 * DBZS — Division By Zeros
 * Datei: tools/pull-requests-issues.ts
 * Zweck: Pull-Request- und Issue-Tools des DBZS Gitea MCP Servers registrieren.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { buildAnnotations, executeTool, ownerSchema, paginationSchema, positiveIdSchema, repositorySchema, stateSchema } from "./shared.js";

/**
 * Registriert die schreibgeschützten Pull-Request- und Issue-Tools.
 *
 * @param server MCP-Server-Instanz.
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @returns Anzahl der registrierten Tools.
 */
export function registerPullRequestAndIssueTools(server: McpServer, giteaClient: GiteaClient, eventBus: DbzsEventBus): number {
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
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, index }) => executeTool(eventBus, "gitea_get_pull_request", () => giteaClient.getPullRequest(owner, repo, index)),
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
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, index }) => executeTool(eventBus, "gitea_get_issue", () => giteaClient.getIssue(owner, repo, index)),
  );

  return 4;
}
