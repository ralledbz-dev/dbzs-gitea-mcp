/**
 * DBZS — Division By Zeros
 * Datei: index.ts
 * Zweck: Lokale stdio- oder Loopback-HTTP-Runtime des DBZS Gitea MCP Servers starten und kontrolliert überwachen.
 * Version: 0.3.0
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadServerConfiguration } from "./core/config.js";
import { toDbzsError } from "./core/errors.js";
import { DbzsEventBus, StderrLogger } from "./core/observability.js";
import { GiteaClient } from "./gitea/client.js";
import { LoopbackMcpHttpServer } from "./http/loopback-server.js";
import { FleetCommanderClient } from "./integrations/fleet-commander-client.js";
import { FeatureStarterHealthReader } from "./integrations/feature-starter-health-reader.js";
import { FeatureStarterHook } from "./integrations/feature-starter-hook.js";
import { createMcpServer, type Phase3Services } from "./mcp/server.js";
import { GiteaWebhookReceiver } from "./webhooks/gitea-webhook-receiver.js";
import { LocalWebhookService } from "./webhooks/local-webhook-service.js";

/**
 * Registriert einen einmaligen, kontrollierten Shutdown für den lokalen HTTP-Transport.
 *
 * Was: Wartet auf SIGINT oder SIGTERM, stoppt die HTTP-Runtime und setzt einen sichtbaren Exit-Code bei Fehlern.
 * Warum: Ein HTTP-Listener und offene MCP-Exchanges müssen bei Prozessende geordnet freigegeben werden.
 * Wofür: Für den Phase-2-Loopback-Transport unter Windows und lokalen Entwicklungsumgebungen.
 * Woher: Aus Node.js-Prozesssignalen und dem DBZS-Observability-Modell.
 * Wo: Nach erfolgreichem Start des HTTP-Listeners.
 * Soll-Ergebnis: Genau ein Shutdown-Vorgang mit nachvollziehbaren stderr-Events.
 *
 * @param httpServer Gestartete lokale HTTP-Runtime.
 * @param eventBus Zentraler DBZS-EventBus.
 */
function registerHttpShutdown(httpServer: LoopbackMcpHttpServer, eventBus: DbzsEventBus): void {
  let stopping = false;

  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    if (stopping) {
      return;
    }

    stopping = true;
    eventBus.publish("runtime.shutdown.started", "info", { transport: "http", signal });
    void httpServer
      .stop()
      .then(() => {
        eventBus.publish("runtime.shutdown.completed", "info", { transport: "http", signal });
      })
      .catch((error: unknown) => {
        const dbzsError = toDbzsError(error);
        eventBus.publish("runtime.shutdown.failed", "error", {
          transport: "http",
          signal,
          errorCode: dbzsError.code,
          errorMessage: dbzsError.message,
        });
        process.exitCode = 1;
      });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Baut alle Runtime-Komponenten auf und verbindet den MCP-Server mit dem gewählten lokalen Transport.
 *
 * Was: Lädt Konfiguration, aktiviert Observability, erstellt Policy-geschützte Services und startet stdio oder HTTP.
 * Warum: Der Einstiegspunkt orchestriert Infrastruktur; Gitea- und MCP-Fachlogik verbleiben in ihren Modulen.
 * Wofür: Für lokale MCP-Clients in Phase 1 und Phase 2.
 * Woher: Aus den Environment Variables des gestarteten Prozesses und dem offiziellen MCP-v2-SDK.
 * Wo: Einmalig beim Programmstart.
 * Soll-Ergebnis: Ein laufender MCP-Server mit vollständiger DBZS-Protokollierung nach stderr.
 */
async function startServer(): Promise<void> {
  const eventBus = new DbzsEventBus();
  new StderrLogger().attach(eventBus);

  const configuration = loadServerConfiguration();
  eventBus.publish("runtime.configuration.loaded", "info", {
    giteaBaseUrl: configuration.giteaBaseUrl,
    allowedOwner: configuration.allowedOwner,
    tokenSource: configuration.tokenSource,
    transport: configuration.transport,
    ...(configuration.transport === "http" ? { httpHost: "127.0.0.1", httpPort: configuration.httpPort } : {}),
    webhookReceiverEnabled: Boolean(configuration.webhookSecret),
    localWebhookRegistrationEnabled: Boolean(configuration.webhookTargetUrl),
    fleetCommanderEnabled: Boolean(configuration.fleetApiUrl),
    featureStarterHealthEnabled: Boolean(configuration.featureStarterHealthPath),
    featureStarterHookEnabled: Boolean(configuration.featureStarterExecutable),
    featureStarterMutationsEnabled: configuration.featureStarterAllowHooks,
  });

  const giteaClient = new GiteaClient(
    configuration.giteaBaseUrl,
    configuration.giteaToken,
    configuration.allowedOwner,
    eventBus,
  );
  const localWebhook = configuration.webhookSecret && configuration.webhookTargetUrl
    ? new LocalWebhookService({
        targetUrl: configuration.webhookTargetUrl,
        secret: configuration.webhookSecret,
        giteaClient,
        eventBus,
      })
    : undefined;
  const phase3Services: Phase3Services = {
    ...(configuration.fleetApiUrl
      ? { fleetCommander: new FleetCommanderClient({ baseUrl: configuration.fleetApiUrl, eventBus }) }
      : {}),
    ...(configuration.featureStarterHealthPath
      ? { featureStarterHealth: new FeatureStarterHealthReader({ healthPath: configuration.featureStarterHealthPath, eventBus }) }
      : {}),
    ...(configuration.featureStarterExecutable
      ? {
          featureStarterHook: new FeatureStarterHook({
            executablePath: configuration.featureStarterExecutable,
            allowHooks: configuration.featureStarterAllowHooks,
            eventBus,
          }),
        }
      : {}),
    ...(localWebhook ? { localWebhook } : {}),
  };

  if (configuration.transport === "stdio") {
    const server = createMcpServer(giteaClient, eventBus, phase3Services);
    const transport = new StdioServerTransport();
    eventBus.publish("runtime.transport.connecting", "info", { transport: "stdio" });
    await server.connect(transport);
    eventBus.publish("runtime.started", "info", {
      transport: "stdio",
      allowedOwner: configuration.allowedOwner,
    });
    return;
  }

  const webhookReceiver = configuration.webhookSecret
    ? new GiteaWebhookReceiver({
        secret: configuration.webhookSecret,
        allowedOwner: configuration.allowedOwner,
        eventBus,
      })
    : undefined;
  const httpServer = new LoopbackMcpHttpServer({
    port: configuration.httpPort,
    giteaClient,
    eventBus,
    webhookReceiver,
    phase3Services,
  });
  eventBus.publish("runtime.transport.connecting", "info", {
    transport: "http",
    host: "127.0.0.1",
    port: configuration.httpPort,
  });
  await httpServer.start();
  registerHttpShutdown(httpServer, eventBus);
  eventBus.publish("runtime.started", "info", {
    transport: "http",
    allowedOwner: configuration.allowedOwner,
    host: "127.0.0.1",
    port: configuration.httpPort,
    endpoint: "/mcp",
    webhookEndpoint: webhookReceiver ? "/webhooks/gitea" : undefined,
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
