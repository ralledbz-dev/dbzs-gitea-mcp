/**
 * DBZS — Division By Zeros
 * Datei: core/config.ts
 * Zweck: Sichere Runtime-Konfiguration aus Environment Variables validieren und normalisieren.
 * Version: 0.3.0
 */

import { DbzsError } from "./errors.js";

/**
 * Beschreibt die unterstützten lokalen MCP-Transporte.
 */
export type McpTransportMode = "stdio" | "http";

/**
 * Enthält die nach erfolgreicher Validierung verwendete Serverkonfiguration.
 */
export interface ServerConfiguration {
  /** Normalisierte Gitea-Basisadresse ohne abschließenden Schrägstrich. */
  readonly giteaBaseUrl: string;
  /** Ausschließlich im Arbeitsspeicher gehaltenes Zugriffstoken. */
  readonly giteaToken: string;
  /** Verbindlich erlaubter Gitea-Namespace. */
  readonly allowedOwner: string;
  /** Sichere, nicht geheime Kennzeichnung der verwendeten Token-Variable. */
  readonly tokenSource: "DBZS_HOME_API_TOKEN" | "GITEA_TOKEN";
  /** Ausgewählter lokaler MCP-Transport. */
  readonly transport: McpTransportMode;
  /** TCP-Port des ausschließlich an 127.0.0.1 gebundenen HTTP-Transports. */
  readonly httpPort: number;
}

/**
 * Liest eine nicht leere Umgebungsvariable oder beendet den Start kontrolliert.
 *
 * Was: Liefert den getrimmten Wert einer Umgebungsvariable.
 * Warum: Fehlende Konfiguration darf nicht zu implizit unsicherem Verhalten führen.
 * Wofür: Für Basis-URL und Namespace-Allowlist.
 * Woher: Aus den Environment Variables des lokalen Hostprozesses.
 * Wo: Beim Start vor dem Aufbau des MCP-Servers.
 * Soll-Ergebnis: Jede Pflichtkonfiguration ist vollständig und nicht leer.
 *
 * @param environment Laufzeitumgebung für testbare Konfigurationsauflösung.
 * @param key Name der erwarteten Umgebungsvariable.
 * @returns Der getrimmte Wert der Umgebungsvariable.
 * @throws {DbzsError} Wenn der Wert fehlt oder nur Leerzeichen enthält.
 */
function requireEnvironmentValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) {
    throw new DbzsError("CONFIGURATION_ERROR", `Die erforderliche Umgebungsvariable ${key} ist nicht gesetzt.`);
  }

  return value;
}

/**
 * Normalisiert und prüft eine Gitea-Basis-URL.
 *
 * Was: Akzeptiert ausschließlich absolute HTTP(S)-URLs und entfernt abschließende Schrägstriche.
 * Warum: Der API-Client muss sichere, vorhersagbare Request-URLs erzeugen.
 * Wofür: Für die Verbindung zu einer lokalen oder LAN-erreichbaren Gitea-Instanz.
 * Woher: Aus GITEA_BASE_URL der Prozessumgebung.
 * Wo: Vor der Konstruktion des Gitea-Clients.
 * Soll-Ergebnis: Eine kanonische URL-Basis ohne API-Pfad-Duplikate.
 *
 * @param value Rohwert aus der Prozessumgebung.
 * @returns Normalisierte HTTP(S)-Basis-URL.
 * @throws {DbzsError} Wenn die URL ungültig ist oder kein HTTP(S) nutzt.
 */
function normalizeGiteaBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new DbzsError("CONFIGURATION_ERROR", "GITEA_BASE_URL muss eine absolute HTTP(S)-URL sein.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DbzsError("CONFIGURATION_ERROR", "GITEA_BASE_URL muss das Protokoll http oder https verwenden.");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

/**
 * Liest den explizit erlaubten lokalen MCP-Transport.
 *
 * Was: Akzeptiert ausschließlich stdio oder http und verwendet stdio als kompatiblen Standard.
 * Warum: Ein HTTP-Listener darf nie unbemerkt durch eine implizite Standardwahl entstehen.
 * Wofür: Für die additive Einführung des Phase-2-HTTP-Transports.
 * Woher: Aus MCP_TRANSPORT im gestarteten Prozess.
 * Wo: Vor dem Aufbau der Runtime.
 * Soll-Ergebnis: Eine eindeutige, sichere Transportsentscheidung.
 *
 * @param environment Laufzeitumgebung für testbare Konfigurationsauflösung.
 * @returns Der validierte Transportmodus.
 * @throws {DbzsError} Wenn ein nicht unterstützter Modus gesetzt ist.
 */
function parseTransportMode(environment: NodeJS.ProcessEnv): McpTransportMode {
  const value = environment.MCP_TRANSPORT?.trim().toLowerCase() || "stdio";
  if (value === "stdio" || value === "http") {
    return value;
  }

  throw new DbzsError("CONFIGURATION_ERROR", "MCP_TRANSPORT muss entweder 'stdio' oder 'http' sein.");
}

/**
 * Liest den Port für den ausschließlich lokalen HTTP-Transport.
 *
 * Was: Akzeptiert einen ganzzahligen TCP-Port aus MCP_HTTP_PORT oder nutzt 3939 als Standard.
 * Warum: Ein ungültiger Port darf nicht zu einem schwer diagnostizierbaren Runtime-Fehler führen.
 * Wofür: Für den auf 127.0.0.1 gebundenen `/mcp`-Listener in Phase 2.
 * Woher: Aus MCP_HTTP_PORT im gestarteten Prozess.
 * Wo: Bei der Konfigurationsvalidierung vor dem Serverstart.
 * Soll-Ergebnis: Ein gültiger, explizit dokumentierter TCP-Port.
 *
 * @param environment Laufzeitumgebung für testbare Konfigurationsauflösung.
 * @returns Ein Port im Bereich 1 bis 65535.
 * @throws {DbzsError} Wenn der konfigurierte Wert kein gültiger TCP-Port ist.
 */
function parseHttpPort(environment: NodeJS.ProcessEnv): number {
  const value = environment.MCP_HTTP_PORT?.trim();
  if (!value) {
    return 3939;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DbzsError("CONFIGURATION_ERROR", "MCP_HTTP_PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }

  return port;
}

/**
 * Lädt und validiert die produktive Serverkonfiguration.
 *
 * Was: Priorisiert DBZS_HOME_API_TOKEN, validiert die Owner-Allowlist und ergänzt den Transportmodus.
 * Warum: Zugangsdaten und Netzwerkgrenzen werden ausschließlich aus dem Prozesskontext bezogen und nie persistiert.
 * Wofür: Für die sichere Initialisierung von Policy, Gitea-Client und lokalem MCP-Transport.
 * Woher: Aus dem Nutzer- beziehungsweise Dienstprozess auf Windows.
 * Wo: Im Runtime-Container beim Serverstart.
 * Soll-Ergebnis: Ein voll validiertes Konfigurationsobjekt mit verpflichtender Owner-Allowlist und sicherem Transport.
 *
 * @param environment Optionale Umgebung für Tests; standardmäßig process.env.
 * @returns Validierte Serverkonfiguration.
 * @throws {DbzsError} Wenn eine Pflichtkonfiguration fehlt oder fehlerhaft ist.
 */
export function loadServerConfiguration(environment: NodeJS.ProcessEnv = process.env): ServerConfiguration {
  const dbzsToken = environment.DBZS_HOME_API_TOKEN?.trim();
  const fallbackToken = environment.GITEA_TOKEN?.trim();
  const giteaToken = dbzsToken || fallbackToken;

  if (!giteaToken) {
    throw new DbzsError(
      "CONFIGURATION_ERROR",
      "DBZS_HOME_API_TOKEN muss gesetzt sein; GITEA_TOKEN wird ausschließlich als kompatibler Fallback unterstützt.",
    );
  }

  const giteaBaseUrl = normalizeGiteaBaseUrl(requireEnvironmentValue(environment, "GITEA_BASE_URL"));
  const allowedOwner = requireEnvironmentValue(environment, "GITEA_ALLOWED_OWNER");

  return {
    giteaBaseUrl,
    giteaToken,
    allowedOwner,
    tokenSource: dbzsToken ? "DBZS_HOME_API_TOKEN" : "GITEA_TOKEN",
    transport: parseTransportMode(environment),
    httpPort: parseHttpPort(environment),
  };
}
