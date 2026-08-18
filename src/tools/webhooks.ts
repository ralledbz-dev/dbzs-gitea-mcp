/**
 * DBZS — Division By Zeros
 * Datei: tools/webhooks.ts
 * Zweck: Gitea-Webhook-Tools des DBZS Gitea MCP Servers registrieren.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { LocalWebhookService } from "../webhooks/local-webhook-service.js";
import { buildAnnotations, executeTool, ownerSchema, paginationSchema, positiveIdSchema, repositorySchema } from "./shared.js";

/**
 * Registriert die Webhook-Tools: das immer verfügbare, schreibgeschützte Listing sowie —
 * nur bei konfiguriertem lokalem Webhook-Receiver — die bestätigungspflichtigen Create-/Delete-Tools.
 *
 * @param server MCP-Server-Instanz.
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @param localWebhook Optionaler lokaler HMAC-Webhook-Registrierungsservice.
 * @returns Anzahl der registrierten Tools.
 */
export function registerWebhookTools(
  server: McpServer,
  giteaClient: GiteaClient,
  eventBus: DbzsEventBus,
  localWebhook?: LocalWebhookService,
): number {
  server.registerTool(
    "gitea_list_webhooks",
    {
      title: "Gitea-Repository-Webhooks auflisten",
      description: "Liest gesäuberte Hook-Metadaten eines Repositories. Secrets und Authorization-Header werden nie ausgegeben.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, page: paginationSchema.default(1), limit: paginationSchema.default(30) }),
      annotations: buildAnnotations(false),
    },
    async ({ owner, repo, page, limit }) =>
      executeTool(eventBus, "gitea_list_webhooks", () => giteaClient.listWebhooks(owner, repo, page, limit)),
  );

  let toolCount = 1;

  if (!localWebhook) {
    return toolCount;
  }

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
      annotations: buildAnnotations(true),
    },
    async ({ owner, repo, events, branchFilter }) =>
      executeTool(eventBus, "gitea_create_local_webhook", () => localWebhook.create(owner, repo, events, branchFilter)),
  );
  toolCount += 1;

  server.registerTool(
    "gitea_delete_local_webhook",
    {
      title: "Lokalen DBZS Gitea-Webhook entfernen",
      description: "Schreiboperation: Entfernt nach confirm: true ausschließlich einen Hook, dessen sichtbare Zieladresse dem konfigurierten lokalen DBZS-Receiver entspricht.",
      inputSchema: z.object({ owner: ownerSchema, repo: repositorySchema, webhookId: positiveIdSchema, confirm: z.literal(true) }),
      annotations: buildAnnotations(true),
    },
    async ({ owner, repo, webhookId }) =>
      executeTool(eventBus, "gitea_delete_local_webhook", async () => {
        const hooks = await giteaClient.listWebhooks(owner, repo, 1, 100);
        const webhook = hooks.find((candidate) => candidate.id === webhookId);
        if (!webhook) {
          throw new Error("Der angeforderte Gitea-Webhook wurde nicht gefunden oder ist nicht sichtbar.");
        }
        localWebhook.assertLocalTarget(webhook);
        await localWebhook.remove(owner, repo, webhookId);
        return { deleted: true, webhookId };
      }),
  );
  toolCount += 1;

  return toolCount;
}
