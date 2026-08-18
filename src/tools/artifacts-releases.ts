/**
 * DBZS — Division By Zeros
 * Datei: tools/artifacts-releases.ts
 * Zweck: Artifact- und Release-Tools des DBZS Gitea MCP Servers registrieren.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { buildAnnotations, executeTool, ownerSchema, paginationSchema, positiveIdSchema, repositorySchema } from "./shared.js";

/**
 * Registriert die schreibgeschützten Artifact- und Release-Tools.
 *
 * @param server MCP-Server-Instanz.
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @returns Anzahl der registrierten Tools.
 */
export function registerArtifactAndReleaseTools(server: McpServer, giteaClient: GiteaClient, eventBus: DbzsEventBus): number {
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, runId, name }) => executeTool(eventBus, "gitea_list_artifacts", () => giteaClient.listArtifacts(owner, repo, runId, name)),
  );

  server.registerTool(
    "gitea_get_artifact",
    {
      title: "Gitea-Actions-Artifact lesen",
      description: "Liest Metadaten eines einzelnen Artifacts einschließlich einer von Gitea gelieferten Download-URL, ohne das Artifact herunterzuladen.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, artifactId: positiveIdSchema }),
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, artifactId }) => executeTool(eventBus, "gitea_get_artifact", () => giteaClient.getArtifact(owner, repo, artifactId)),
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, page, limit, includeDrafts, includePrereleases }) =>
      executeTool(eventBus, "gitea_list_releases", () =>
        giteaClient.listReleases(owner, repo, page, limit, includeDrafts, includePrereleases),
      ),
  );

  server.registerTool(
    "gitea_list_release_assets",
    {
      title: "Gitea-Release-Assets auflisten",
      description: "Liest Metadaten und Gitea-Download-URLs der Assets eines Releases, ohne Binärdaten zu laden.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, releaseId: positiveIdSchema }),
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, releaseId }) =>
      executeTool(eventBus, "gitea_list_release_assets", () => giteaClient.listReleaseAssets(owner, repo, releaseId)),
  );

  return 4;
}
