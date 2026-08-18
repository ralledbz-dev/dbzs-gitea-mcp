/**
 * DBZS — Division By Zeros
 * Datei: tools/packages.ts
 * Zweck: Package-Registry-Tools des DBZS Gitea MCP Servers registrieren.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { buildAnnotations, executeTool, ownerSchema, paginationSchema } from "./shared.js";

/**
 * Registriert die schreibgeschützten Package-Registry-Tools.
 *
 * @param server MCP-Server-Instanz.
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @returns Anzahl der registrierten Tools.
 */
export function registerPackageTools(server: McpServer, giteaClient: GiteaClient, eventBus: DbzsEventBus): number {
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
      annotations: buildAnnotations(false),
    },
    async ({ owner, page, limit, packageType, query }) =>
      executeTool(eventBus, "gitea_list_packages", () => giteaClient.listPackages(owner, page, limit, packageType, query)),
  );

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
      annotations: buildAnnotations(false),
    },
    async ({ owner, packageType, packageName, page, limit }) =>
      executeTool(eventBus, "gitea_list_package_versions", () =>
        giteaClient.listPackageVersions(owner, packageType, packageName, page, limit),
      ),
  );

  return 2;
}
