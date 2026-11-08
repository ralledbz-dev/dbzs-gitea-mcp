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
import { LocalWorkspaceBridge } from "../local/workspace-bridge.js";
import { LocalWebhookService } from "../webhooks/local-webhook-service.js";
import { registerActionsTools } from "../tools/actions.js";
import { registerArtifactAndReleaseTools } from "../tools/artifacts-releases.js";
import { registerBranchAndCommitTools } from "../tools/branches-commits.js";
import { registerFleetCommanderTools } from "../tools/fleet-commander.js";
import { registerLocalWorkspaceTools } from "../tools/local-workspace.js";
import { registerPackageTools } from "../tools/packages.js";
import { registerPullRequestAndIssueTools } from "../tools/pull-requests-issues.js";
import { registerRepositoryTools } from "../tools/repositories.js";
import { registerWebhookTools } from "../tools/webhooks.js";

export interface Phase3Services {
  readonly fleetCommander?: FleetCommanderClient;
  readonly localWebhook?: LocalWebhookService;
  readonly localWorkspace?: LocalWorkspaceBridge;
}
const FIXED_TOOL_COUNT = 26;
export function countConfiguredTools(phase3Services: Phase3Services = {}): number {
  let count = FIXED_TOOL_COUNT;
  if (phase3Services.localWebhook) count += 2;
  if (phase3Services.fleetCommander) count += 5;
  if (phase3Services.localWorkspace) count += 9;
  return count;
}
export function createMcpServer(giteaClient:GiteaClient,eventBus:DbzsEventBus,phase3Services:Phase3Services={}):McpServer {
  const server=new McpServer({name:SERVICE_NAME,version:SERVICE_VERSION});
  let toolCount=0;
  toolCount+=registerRepositoryTools(server,giteaClient,eventBus);
  toolCount+=registerBranchAndCommitTools(server,giteaClient,eventBus);
  toolCount+=registerPullRequestAndIssueTools(server,giteaClient,eventBus);
  toolCount+=registerActionsTools(server,giteaClient,eventBus);
  toolCount+=registerArtifactAndReleaseTools(server,giteaClient,eventBus);
  toolCount+=registerPackageTools(server,giteaClient,eventBus);
  toolCount+=registerWebhookTools(server,giteaClient,eventBus,phase3Services.localWebhook);
  toolCount+=registerFleetCommanderTools(server,eventBus,phase3Services.fleetCommander);
  toolCount+=registerLocalWorkspaceTools(server,eventBus,phase3Services.localWorkspace);
  eventBus.publish("mcp.server.tools_registered","info",{toolCount,localWebhookEnabled:Boolean(phase3Services.localWebhook),fleetCommanderEnabled:Boolean(phase3Services.fleetCommander),localWorkspaceEnabled:Boolean(phase3Services.localWorkspace)});
  return server;
}
