/**
 * DBZS — Division By Zeros
 * Datei: http/loopback-server.ts
 * Zweck: Lokalen, durch Host- und Origin-Guards geschützten MCP-HTTP-Transport unter /mcp bereitstellen.
 * Version: 0.3.0
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { toDbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { GiteaClient } from "../gitea/client.js";
import { createMcpServer } from "../mcp/server.js";

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
}

/**
 * Liefert den URL-Pfad einer Node-HTTP-Anfrage ohne Query-Parameter.
 *
 * Was: Normalisiert die optionale Node-Request-URL zu einem sicheren Pathname.
 * Warum: Route-Vergleiche dürfen nicht durch Query-Parameter oder eine fehlende URL verfälscht werden.
 * Wofür: Für die ausschließliche Freigabe des MCP-Endpunkts `/mcp`.
 * Woher: Aus `IncomingMessage.url` des lokalen Node-HTTP-Servers.
 * Wo: Vor jeder Host-, Origin- und Handler-Verarbeitung.
 * Soll-Ergebnis: Ein stabiler Pathname für die lokale Routenpolicy.
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
 * Was: Sendet Status, Content-Type und einen stabilen Fehlerkörper.
 * Warum: Nicht erlaubte Routen und Methoden müssen vor dem MCP-Handler klar abgewiesen werden.
 * Wofür: Für die Loopback-Transportgrenze.
 * Woher: Aus der lokalen HTTP-Routing- und Sicherheitsrichtlinie.
 * Wo: Im Node-HTTP-Request-Handler.
 * Soll-Ergebnis: Deterministische HTTP-Fehler ohne geheime Kontextdaten.
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
 * Kapselt den zustandslosen MCP-v2-HTTP-Handler in einem ausschließlich lokal gebundenen Node-Server.
 *
 * Was: Erstellt und verwaltet einen `node:http`-Server mit `/mcp`-Routing und SDK-Handler.
 * Warum: Der HTTP-Transport soll additive Infrastruktur bleiben und keinerlei Gitea-Business-Logik enthalten.
 * Wofür: Für lokale Streamable-HTTP-MCP-Clients in Phase 2.
 * Woher: Aus `createMcpHandler`, `toNodeHandler` und den Loopback-Guards des offiziellen MCP SDK v2.
 * Wo: Zwischen der DBZS-Runtime und einem lokalen MCP-Client.
 * Soll-Ergebnis: Ein nur auf 127.0.0.1 erreichbarer, beobachtbarer und sauber stoppbarer `/mcp`-Dienst.
 */
export class LoopbackMcpHttpServer {
  private server?: Server;
  private handler?: ReturnType<typeof createMcpHandler>;

  /**
   * Erstellt die Runtime-Hülle für den lokalen MCP-HTTP-Listener.
   *
   * Was: Übernimmt validierte Transportoptionen und hält erst beim Start Server- und Handlerinstanzen.
   * Warum: Konstruktion muss nebenwirkungsfrei bleiben und Tests eine kontrollierte Runtime erlauben.
   * Wofür: Für Start, Stop und Observability des HTTP-Transports.
   * Woher: Aus dem zentralen Runtime-Container.
   * Wo: In der Phase-2-HTTP-Infrastruktur.
   * Soll-Ergebnis: Ein vorbereiteter, aber noch nicht lauschender Loopback-Server.
   *
   * @param options Validierte lokale Transport-, Client- und Observability-Abhängigkeiten.
   */
  public constructor(private readonly options: LoopbackHttpServerOptions) {}

  /**
   * Liefert den tatsächlich gebundenen lokalen MCP-Endpunkt, sofern der Server läuft.
   *
   * Was: Liest die von Node aufgelöste Listeneradresse einschließlich eines optional dynamisch vergebenen Testports.
   * Warum: Runtime-Tests dürfen keine Portannahmen treffen und müssen dennoch den realen Loopback-Listener ansprechen.
   * Wofür: Für lokale Betriebsdiagnosen und deterministische HTTP-Transporttests.
   * Woher: Aus `node:http` nach erfolgreichem `listen`.
   * Wo: An der beobachtbaren Grenze des HTTP-Runtime-Moduls.
   * Soll-Ergebnis: Eine lokale `/mcp`-URL oder `undefined`, wenn kein Listener aktiv ist.
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
   * Startet den zustandslosen MCP-v2-Handler ausschließlich an 127.0.0.1.
   *
   * Was: Baut die per Request frische MCP-Server-Factory auf und bindet den Node-Listener an Loopback.
   * Warum: Local-first-Betrieb braucht einen expliziten und nicht versehentlich externen Netzwerkendpunkt.
   * Wofür: Für Streamable HTTP unter `http://127.0.0.1:<port>/mcp`.
   * Woher: Aus der validierten `MCP_HTTP_PORT`-Konfiguration.
   * Wo: Beim kontrollierten Runtime-Start.
   * Soll-Ergebnis: Ein aktiver HTTP-Listener mit Host-, Origin-, Methoden- und Routenprüfung.
   *
   * @throws {Error} Wenn der Server bereits gestartet ist oder der Port nicht gebunden werden kann.
   */
  public async start(): Promise<void> {
    if (this.server) {
      throw new Error("Der lokale MCP-HTTP-Server wurde bereits gestartet.");
    }

    this.handler = createMcpHandler(() => createMcpServer(this.options.giteaClient, this.options.eventBus));
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

      if (path !== "/mcp") {
        this.options.eventBus.publish("http.request.rejected", "warn", {
          reason: "route_not_found",
          method: request.method ?? "UNKNOWN",
          path,
        });
        writeJsonError(response, 404, "Nur der lokale MCP-Endpunkt /mcp ist verfügbar.");
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
    });
  }

  /**
   * Stoppt den Listener und schließt alle im MCP-Handler laufenden Exchanges.
   *
   * Was: Schließt zuerst den SDK-Handler und anschließend den Node-HTTP-Server.
   * Warum: Ein kontrollierter Shutdown darf keine offenen MCP-Exchanges oder Listener hinterlassen.
   * Wofür: Für Signalbehandlung, Tests und geordnete Prozessbeendigung.
   * Woher: Aus der Runtime-Shutdown-Orchestrierung.
   * Wo: Am Ende des HTTP-Betriebs.
   * Soll-Ergebnis: Vollständig freigegebener Loopback-Port und nachvollziehbares Stop-Ereignis.
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
