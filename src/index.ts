/**
 * DBZS — Division By Zeros
 * Datei: index.ts
 * Zweck: Lokale stdio-Runtime des DBZS Gitea MCP Servers starten und kontrolliert überwachen.
 * Version: 0.2.0
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadServerConfiguration } from "./core/config.js";
import { toDbzsError } from "./core/errors.js";
import { DbzsEventBus, StderrLogger } from "./core/observability.js";
import { GiteaClient } from "./gitea/client.js";
import { createMcpServer } from "./mcp/server.js";

/**
 * Baut alle Runtime-Komponenten auf und verbindet den MCP-Server mit stdio.
 *
 * Was: Lädt Konfiguration, aktiviert Observability, erstellt Policy-geschützte Services und verbindet den Transport.
 * Warum: Der Einstiegspunkt soll ausschließlich die Anwendung orchestrieren und keine Fachlogik enthalten.
 * Wofür: Für lokale MCP-Clients in Phase 1.
 * Woher: Aus den Environment Variables des gestarteten Prozesses und dem offiziellen MCP-v2-SDK.
 * Wo: Einmalig beim Programmstart.
 * Soll-Ergebnis: Ein laufender MCP-stdio-Server mit vollständiger DBZS-Protokollierung nach stderr.
 */
async function startServer(): Promise<void> {
  const eventBus = new DbzsEventBus();
  new StderrLogger().attach(eventBus);

  const configuration = loadServerConfiguration();
  eventBus.publish("runtime.configuration.loaded", "info", {
    giteaBaseUrl: configuration.giteaBaseUrl,
    allowedOwner: configuration.allowedOwner,
    tokenSource: configuration.tokenSource,
  });

  const giteaClient = new GiteaClient(
    configuration.giteaBaseUrl,
    configuration.giteaToken,
    configuration.allowedOwner,
    eventBus,
  );
  const server = createMcpServer(giteaClient, eventBus);
  const transport = new StdioServerTransport();

  eventBus.publish("runtime.transport.connecting", "info", { transport: "stdio" });
  await server.connect(transport);
  eventBus.publish("runtime.started", "info", {
    transport: "stdio",
    allowedOwner: configuration.allowedOwner,
  });
}

/**
 * Startet die Runtime und beendet den Prozess bei einem nicht behebbaren Startfehler mit Code 1.
 *
 * Was: Setzt eine explizite, sichtbare Fehlergrenze um die asynchrone Serverinitialisierung.
 * Warum: Konfigurations- und Initialisierungsfehler dürfen nicht als unbeobachtete Promise-Rejections enden.
 * Wofür: Für einen kontrollierten Dienststart unter Windows und lokalen MCP-Clients.
 * Woher: Aus Node.js-Prozesssemantik und den DBZS-Anforderungen an transparente Fehlerbehandlung.
 * Wo: Am Programmeinstieg.
 * Soll-Ergebnis: Fehler erscheinen sicher nach stderr und der Prozess signalisiert einen Fehlstart.
 */
void startServer().catch((error: unknown) => {
  const dbzsError = toDbzsError(error);
  process.stderr.write(
    `${JSON.stringify({
      source: "dbzs-gitea-mcp",
      timestamp: new Date().toISOString(),
      name: "runtime.start.failed",
      level: "error",
      context: {
        errorCode: dbzsError.code,
        errorMessage: dbzsError.message,
        details: dbzsError.details,
      },
    })}\n`,
  );
  process.exitCode = 1;
});
