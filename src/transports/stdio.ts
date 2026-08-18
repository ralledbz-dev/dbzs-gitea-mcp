/**
 * DBZS — Division By Zeros
 * Datei: transports/stdio.ts
 * Zweck: Den MCP-Server über den offiziellen stdio-Transport verbinden.
 * Version: 0.4.0
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { createMcpServer, type Phase3Services } from "../server/mcp-server.js";

/**
 * Baut den MCP-Server auf und verbindet ihn mit dem stdio-Transport.
 *
 * Was: Verbindet einen frisch registrierten MCP-Server mit `StdioServerTransport` und protokolliert Start/Verbindung.
 * Warum: Phase 1 verwendet ausschließlich stdio und macht keinen Netzwerklistener auf.
 * Wofür: Für lokale MCP-Clients, die den Server als Kindprozess starten.
 * Woher: Aus dem offiziellen `@modelcontextprotocol/server`-stdio-Transport.
 * Wo: Beim Runtime-Start, wenn `MCP_TRANSPORT=stdio` (Standard) konfiguriert ist.
 * Soll-Ergebnis: Ein über stdio verbundener MCP-Server ohne Netzwerklistener.
 *
 * @param giteaClient Policy-geschützter Gitea-REST-Adapter.
 * @param eventBus Zentraler DBZS-EventBus.
 * @param phase3Services Optionale Phase-3-Integrationsservices.
 * @param allowedOwner Verbindlich erlaubter Gitea-Namespace, ausschließlich für das Start-Ereignis.
 */
export async function startStdioTransport(
  giteaClient: GiteaClient,
  eventBus: DbzsEventBus,
  phase3Services: Phase3Services,
  allowedOwner: string,
): Promise<void> {
  const server = createMcpServer(giteaClient, eventBus, phase3Services);
  const transport = new StdioServerTransport();
  eventBus.publish("runtime.transport.connecting", "info", { transport: "stdio" });
  await server.connect(transport);
  eventBus.publish("runtime.started", "info", { transport: "stdio", allowedOwner });
}
