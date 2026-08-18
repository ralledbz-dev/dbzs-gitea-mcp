/**
 * DBZS — Division By Zeros
 * Datei: tools/branches-commits.ts
 * Zweck: Branch- und Commit-Tools des DBZS Gitea MCP Servers registrieren.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { buildAnnotations, executeTool, ownerSchema, paginationSchema, repositorySchema } from "./shared.js";

/**
 * Registriert die schreibgeschützten Branch- und Commit-Tools.
 *
 * @param server MCP-Server-Instanz.
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @returns Anzahl der registrierten Tools.
 */
export function registerBranchAndCommitTools(server: McpServer, giteaClient: GiteaClient, eventBus: DbzsEventBus): number {
  server.registerTool(
    "gitea_list_branches",
    {
      title: "Gitea-Branches auflisten",
      description: "Liest Branches einschließlich Schutz- und Head-Commit-Metadaten eines Repositories im freigegebenen Namespace.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, page: paginationSchema.default(1), limit: paginationSchema.default(30) }),
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, branch }) => executeTool(eventBus, "gitea_get_branch", () => giteaClient.getBranch(owner, repo, branch)),
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
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, sha }) => executeTool(eventBus, "gitea_get_commit", () => giteaClient.getCommit(owner, repo, sha)),
  );

  return 4;
}
