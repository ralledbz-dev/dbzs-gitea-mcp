/**
 * DBZS — Division By Zeros
 * Datei: tools/repositories.ts
 * Zweck: Repository- und Inhalts-Tools des DBZS Gitea MCP Servers registrieren.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { buildAnnotations, executeTool, ownerSchema, paginationSchema, repositorySchema } from "./shared.js";

/**
 * Registriert die schreibgeschützten Repository- und Inhalts-Tools.
 *
 * @param server MCP-Server-Instanz.
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @returns Anzahl der registrierten Tools.
 */
export function registerRepositoryTools(server: McpServer, giteaClient: GiteaClient, eventBus: DbzsEventBus): number {
  server.registerTool(
    "gitea_list_repositories",
    {
      title: "Gitea-Repositories auflisten",
      description: "Liest die für den Token sichtbaren Repositories und gibt ausschließlich Repositories des freigegebenen GITEA_ALLOWED_OWNER zurück.",
      inputSchema: z.object({ limit: paginationSchema.default(30) }),
      annotations: buildAnnotations(false),
    },
    async ({ limit }) => executeTool(eventBus, "gitea_list_repositories", () => giteaClient.listRepositories(limit)),
  );

  server.registerTool(
    "gitea_get_repository",
    {
      title: "Gitea-Repository-Metadaten lesen",
      description: "Liest Metadaten eines Repositories im freigegebenen Namespace. Andere Owner werden vor dem Gitea-Aufruf abgewiesen.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema }),
      annotations: buildAnnotations(false),
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, path, ref }) =>
      executeTool(eventBus, "gitea_get_contents", () => giteaClient.getContents(owner, repo, path, ref)),
  );

  return 3;
}
