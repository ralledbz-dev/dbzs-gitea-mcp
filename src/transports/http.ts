/**
 * DBZS — Division By Zeros
 * Datei: transports/http.ts
 * Zweck: Lokalen, durch Host- und Origin-Guards geschützten MCP-HTTP-Transport unter /mcp, die Betriebsendpunkte
 * /health, /ready und /version sowie optional signierte Gitea-Webhooks bereitstellen.
 * Version: 0.4.0
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { toDbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { buildHealthPayload, buildReadyPayload, buildVersionPayload } from "../health/probe.js";
import { countConfiguredTools, createMcpServer, type Phase3Services } from "../server/mcp-server.js";
import { GiteaWebhookReceiver } from "../webhooks/gitea-webhook-receiver.js";

/**
 * Repräsentiert die kontrollierten Laufzeitparameter des lokalen HTTP-Transports.
 */
export interface LoopbackHttpServerOptions {
  /** TCP-Port des ausschließlich lokalen Listeners. */
  readonly port: number;
  /** Policy-geschützter Gitea-Adapter für jede frische MCP-Request-Instanz. */
  readonly giteaClient: GiteaClient;
  /** Zentraler DBZS-EventBus für Transportereignisse. */
  readonly eventBus: DbzsEventBus;
  /** Optionaler, HMAC-gesicherter Receiver für lokale Gitea-Zustellungen. */
  readonly webhookReceiver?: GiteaWebhookReceiver;
  /** Optional konfigurierte DBZS Phase-3-Integrationsservices für jede frische MCP-Session. */
  readonly phase3Services?: Phase3Services;
}

/**
 * Liefert den URL-Pfad einer Node-HTTP-Anfrage ohne Query-Parameter.
 *
 * @param request Eingehende Node-HTTP-Anfrage.
 * @returns Normalisierter URL-Pfad ohne Query-Parameter.
 */
function getRequestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

/**
 * Schreibt eine kleine, sichere JSON-Fehlerantwort ohne MCP-Tooldetails.
 *
 * @param response Node-HTTP-Antwortobjekt.
 * @param statusCode HTTP-Statuscode.
 * @param message Sichere Fehlerbeschreibung.
 */
function writeJsonError(response: ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: message }));
}

/**
 * Schreibt eine erfolgreiche JSON-Antwort für die Betriebsendpunkte /health, /ready und /version.
 *
 * @param response Node-HTTP-Antwortobjekt.
 * @param statusCode HTTP-Statuscode.
 * @param payload Serialisierbare Antwortdaten.
 */
function writeJsonSuccess(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

/**
 * Kapselt den zustandslosen MCP-v2-HTTP-Handler in einem ausschließlich lokal gebundenen Node-Server.
 *
 * Was: Erstellt und verwaltet einen `node:http`-Server mit `/mcp`-, `/health`-, `/ready`-, `/version`-Routing und SDK-Handler.
 * Warum: Der HTTP-Transport soll additive Infrastruktur bleiben und keinerlei Gitea-Business-Logik enthalten.
 * Wofür: Für lokale Streamable-HTTP-MCP-Clients sowie externe Prozessüberwachung (z. B. DBZS Feature Starter).
 * Woher: Aus `createMcpHandler`, `toNodeHandler` und den Loopback-Guards des offiziellen MCP SDK v2.
 * Wo: Zwischen der DBZS-Runtime und einem lokalen MCP-Client oder Monitoring-Prozess.
 * Soll-Ergebnis: Ein nur auf 127.0.0.1 erreichbarer, beobachtbarer und sauber stoppbarer Dienst.
 */
export class LoopbackMcpHttpServer {
  private server?: Server;
  private handler?: ReturnType<typeof createMcpHandler>;

  /**
   * Erstellt die Runtime-Hülle für den lokalen MCP-HTTP-Listener.
   *
   * @param options Validierte lokale Transport-, Client- und Observability-Abhängigkeiten.
   */
  public constructor(private readonly options: LoopbackHttpServerOptions) {}

  /**
   * Liefert den tatsächlich gebundenen lokalen MCP-Endpunkt, sofern der Server läuft.
   *
   * @returns Vollständige lokale MCP-Endpoint-URL oder `undefined`.
   */
  public get endpoint(): string | undefined {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      return undefined;
    }

    return `http://127.0.0.1:${address.port}/mcp`;
  }

  /**
   * Liefert den lokalen Gitea-Webhook-Endpunkt nur bei aktivierter HMAC-Receiver-Konfiguration.
   *
   * @returns Vollständige lokale Webhook-URL oder `undefined`.
   */
  public get webhookEndpoint(): string | undefined {
    const address = this.server?.address();
    if (!this.options.webhookReceiver || !address || typeof address === "string") {
      return undefined;
    }

    return `http://127.0.0.1:${address.port}/webhooks/gitea`;
  }

  /**
   * Startet den zustandslosen MCP-v2-Handler ausschließlich an 127.0.0.1.
   *
   * @throws {Error} Wenn der Server bereits gestartet ist oder der Port nicht gebunden werden kann.
   */
  public async start(): Promise<void> {
    if (this.server) {
      throw new Error("Der lokale MCP-HTTP-Server wurde bereits gestartet.");
    }

    this.handler = createMcpHandler(() =>
      createMcpServer(this.options.giteaClient, this.options.eventBus, this.options.phase3Services),
    );
    const nodeHandler = toNodeHandler(this.handler, {
      onerror: (error) => {
        const dbzsError = toDbzsError(error);
        this.options.eventBus.publish("http.mcp.handler.failed", "error", {
          errorCode: dbzsError.code,
          errorMessage: dbzsError.message,
        });
      },
    });
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();

    this.server = createServer((request, response) => {
      const path = getRequestPath(request);
      this.options.eventBus.publish("http.request.received", "info", {
        method: request.method ?? "UNKNOWN",
        path,
      });

      const isMcpRoute = path === "/mcp";
      const isWebhookRoute = path === "/webhooks/gitea" && this.options.webhookReceiver !== undefined;
      const isHealthRoute = path === "/health";
      const isReadyRoute = path === "/ready";
      const isVersionRoute = path === "/version";
      if (!isMcpRoute && !isWebhookRoute && !isHealthRoute && !isReadyRoute && !isVersionRoute) {
        this.options.eventBus.publish("http.request.rejected", "warn", {
          reason: "route_not_found",
          method: request.method ?? "UNKNOWN",
          path,
        });
        writeJsonError(
          response,
          404,
          "Nur /mcp, /health, /ready, /version und ein ausdrücklich aktivierter lokaler Gitea-Webhook sind verfügbar.",
        );
        return;
      }

      if (!validateHost(request, response) || !validateOrigin(request, response)) {
        this.options.eventBus.publish("http.request.rejected", "warn", {
          reason: "host_or_origin_validation_failed",
          method: request.method ?? "UNKNOWN",
          path,
        });
        return;
      }

      if (isHealthRoute || isReadyRoute || isVersionRoute) {
        if (request.method !== "GET") {
          writeJsonError(response, 405, "Für /health, /ready und /version ist nur GET erlaubt.");
          return;
        }
        if (isVersionRoute) {
          writeJsonSuccess(response, 200, buildVersionPayload());
          return;
        }
        if (isHealthRoute) {
          writeJsonSuccess(response, 200, buildHealthPayload());
          return;
        }
        writeJsonSuccess(response, 200, buildReadyPayload(countConfiguredTools(this.options.phase3Services)));
        return;
      }

      if (isWebhookRoute) {
        void this.options.webhookReceiver?.handle(request, response).catch((error: unknown) => {
          const dbzsError = toDbzsError(error);
          this.options.eventBus.publish("webhook.gitea.failed", "error", {
            errorCode: dbzsError.code,
            errorMessage: dbzsError.message,
          });
          if (!response.headersSent && !response.destroyed) {
            writeJsonError(response, 500, "Der lokale Gitea-Webhook konnte nicht verarbeitet werden.");
          }
        });
        return;
      }

      if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") {
        this.options.eventBus.publish("http.request.rejected", "warn", {
          reason: "method_not_allowed",
          method: request.method ?? "UNKNOWN",
          path,
        });
        writeJsonError(response, 405, "Für /mcp sind nur POST, GET und DELETE erlaubt.");
        return;
      }

      void nodeHandler(request, response).catch((error: unknown) => {
        const dbzsError = toDbzsError(error);
        this.options.eventBus.publish("http.request.failed", "error", {
          method: request.method ?? "UNKNOWN",
          path,
          errorCode: dbzsError.code,
          errorMessage: dbzsError.message,
        });
        if (!response.headersSent && !response.destroyed) {
          writeJsonError(response, 500, "Der lokale MCP-Handler konnte die Anfrage nicht verarbeiten.");
        }
      });
    });

    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.port, "127.0.0.1");
    });

    this.options.eventBus.publish("http.server.started", "info", {
      host: "127.0.0.1",
      port: this.options.port,
      endpoint: "/mcp",
      webhookEndpoint: this.options.webhookReceiver ? "/webhooks/gitea" : undefined,
    });
  }

  /**
   * Stoppt den Listener und schließt alle im MCP-Handler laufenden Exchanges.
   */
  public async stop(): Promise<void> {
    const handler = this.handler;
    const server = this.server;
    this.handler = undefined;
    this.server = undefined;

    if (handler) {
      await handler.close();
    }

    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    this.options.eventBus.publish("http.server.stopped", "info", {
      host: "127.0.0.1",
      port: this.options.port,
    });
  }
}
