/**
 * DBZS — Division By Zeros
 * Datei: server/mcp-server.ts
 * Zweck: Den offiziellen MCP-v2-Server konstruieren und alle Tool-Module verdrahten.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import { DbzsEventBus } from "../core/observability.js";
import { SERVICE_NAME, SERVICE_VERSION } from "../health/probe.js";
import { GiteaClient } from "../gitea/client.js";
import { FleetCommanderClient } from "../integrations/fleet-commander-client.js";
import { LocalWebhookService } from "../webhooks/local-webhook-service.js";
import { registerActionsTools } from "../tools/actions.js";
import { registerArtifactAndReleaseTools } from "../tools/artifacts-releases.js";
import { registerBranchAndCommitTools } from "../tools/branches-commits.js";
import { registerFleetCommanderTools } from "../tools/fleet-commander.js";
import { registerPackageTools } from "../tools/packages.js";
import { registerPullRequestAndIssueTools } from "../tools/pull-requests-issues.js";
import { registerRepositoryTools } from "../tools/repositories.js";
import { registerWebhookTools } from "../tools/webhooks.js";

/**
 * Beschreibt optional verfügbare Phase-3-Integrationsservices.
 */
export interface Phase3Services {
  /** Bestehende lokale Fleet-Commander-Control-Plane; nur Read-Adapter. */
  readonly fleetCommander?: FleetCommanderClient;
  /** Lokaler HMAC-Webhook-Registrierungsservice. */
  readonly localWebhook?: LocalWebhookService;
}

/**
 * Feste Anzahl der immer registrierten Gitea-Tools (Repositories 3 + Branches/Commits 4 +
 * Pull-Requests/Issues 4 + Actions 8 + Artifacts/Releases 4 + Packages 2 + Webhooks-Basis 1).
 *
 * Warum als Konstante und nicht nur aus den tatsächlichen `register*Tools`-Rückgabewerten abgeleitet:
 * `countConfiguredTools` muss ohne Serverkonstruktion aufrufbar sein, damit der `/ready`-Endpunkt bei
 * häufigem externem Polling keine 26+ Tools neu registriert.
 * Ein Test (`tests/protocol/http-transport.test.ts`) sichert ab, dass diese Konstante nicht von der
 * tatsächlichen Toolanzahl abweicht.
 */
const FIXED_TOOL_COUNT = 26;

/**
 * Berechnet die aktuell konfigurierte Gesamtzahl der MCP-Tools ohne Serverkonstruktion.
 *
 * @param phase3Services Optionale Phase-3-Integrationsservices.
 * @returns Gesamtzahl der Tools, die `createMcpServer` mit derselben Konfiguration registrieren würde.
 */
export function countConfiguredTools(phase3Services: Phase3Services = {}): number {
  let count = FIXED_TOOL_COUNT;
  if (phase3Services.localWebhook) {
    count += 2;
  }
  if (phase3Services.fleetCommander) {
    count += 5;
  }
  return count;
}

/**
 * Registriert alle Tools auf einem offiziellen MCP-v2-Server.
 *
 * Was: Erstellt den Server und delegiert jede Toolgruppe an ihr eigenes `tools/*`-Modul.
 * Warum: Die Serverkonstruktion soll schlank bleiben; Toolregistrierung und Fachlogik verbleiben in `tools/`.
 * Wofür: Für lokale stdio- und HTTP-Clients.
 * Woher: Aus dem DBZS-Implementierungsplan.
 * Wo: In der Runtime-Fabrik vor dem Anschluss eines Transports.
 * Soll-Ergebnis: Ein vollständig registrierter MCP-Server mit Read-/Write-Trennung, Annotationen und confirm-Gate.
 *
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @param phase3Services Optionale Phase-3-Integrationsservices.
 * @returns Der vollständig registrierte, noch nicht mit einem Transport verbundene MCP-Server.
 */
export function createMcpServer(
  giteaClient: GiteaClient,
  eventBus: DbzsEventBus,
  phase3Services: Phase3Services = {},
): McpServer {
  const server = new McpServer({ name: SERVICE_NAME, version: SERVICE_VERSION });

  let toolCount = 0;
  toolCount += registerRepositoryTools(server, giteaClient, eventBus);
  toolCount += registerBranchAndCommitTools(server, giteaClient, eventBus);
  toolCount += registerPullRequestAndIssueTools(server, giteaClient, eventBus);
  toolCount += registerActionsTools(server, giteaClient, eventBus);
  toolCount += registerArtifactAndReleaseTools(server, giteaClient, eventBus);
  toolCount += registerPackageTools(server, giteaClient, eventBus);
  toolCount += registerWebhookTools(server, giteaClient, eventBus, phase3Services.localWebhook);
  toolCount += registerFleetCommanderTools(server, eventBus, phase3Services.fleetCommander);

  eventBus.publish("mcp.server.tools_registered", "info", {
    toolCount,
    localWebhookEnabled: Boolean(phase3Services.localWebhook),
    fleetCommanderEnabled: Boolean(phase3Services.fleetCommander),
  });

  return server;
}
