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
  /** Optionales HMAC-Secret für den ausschließlich lokalen Gitea-Webhook-Receiver. */
  readonly webhookSecret?: string;
  /** Optionaler exakt lokaler Zielendpunkt für die Gitea-Hook-Registrierung. */
  readonly webhookTargetUrl?: string;
  /** Optionale lokale Fleet-Commander-v1-API-Basisadresse. */
  readonly fleetApiUrl?: string;
  /** Optionaler absoluter Pfad zur atomaren Feature-Starter-Health-Datei. */
  readonly featureStarterHealthPath?: string;
  /** Optionaler kanonischer Pfad zur DBZS.FeatureStarter.exe für bestehende CLI-Hooks. */
  readonly featureStarterExecutable?: string;
  /** Getrennte lokale Freigabe für mutierende Feature-Starter-Update- und Installer-Hooks. */
  readonly featureStarterAllowHooks: boolean;
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
 * Prüft die optionale Zieladresse für eine Gitea-Hook-Registrierung auf strikten Local-first-Betrieb.
 *
 * Was: Akzeptiert ausschließlich HTTP-Adressen an 127.0.0.1, ::1 oder localhost mit exakt `/webhooks/gitea`.
 * Warum: Ein konfigurierter Gitea-Hook darf nie als allgemeiner ausgehender HTTP-Kanal missbraucht werden.
 * Wofür: Für die Phase-3-Webhook-Registrierung über LocalWebhookService.
 * Woher: Aus GITEA_WEBHOOK_TARGET_URL.
 * Wo: Bei Runtime-Konfigurationsvalidierung.
 * Soll-Ergebnis: Sicherer lokaler Receiver-Endpunkt oder ein sichtbarer Konfigurationsfehler.
 *
 * @param environment Laufzeitumgebung für testbare Konfigurationsauflösung.
 * @returns Normalisierte lokale Ziel-URL oder `undefined`.
 * @throws {DbzsError} Bei externer, ungültiger oder falsch gerouteter Zieladresse.
 */
function parseOptionalLocalWebhookTargetUrl(environment: NodeJS.ProcessEnv): string | undefined {
  const value = environment.GITEA_WEBHOOK_TARGET_URL?.trim();
  if (!value) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DbzsError("CONFIGURATION_ERROR", "GITEA_WEBHOOK_TARGET_URL muss eine absolute lokale HTTP-URL sein.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "::1", "localhost"].includes(url.hostname.toLowerCase()) ||
    url.pathname !== "/webhooks/gitea" ||
    url.search ||
    url.hash
  ) {
    throw new DbzsError(
      "CONFIGURATION_ERROR",
      "GITEA_WEBHOOK_TARGET_URL muss ausschließlich auf http://127.0.0.1:<port>/webhooks/gitea zeigen.",
    );
  }
  return url.toString();
}

/**
 * Liest einen strikt booleschen lokalen Freigabeschalter.
 *
 * Was: Akzeptiert nur den Stringwert `true` für eine aktive Freigabe und sonst false.
 * Warum: Mutierende Update- und Installer-Hooks müssen zusätzlich zur MCP-Bestätigung lokal aktiviert werden.
 * Wofür: Für DBZS_FEATURE_STARTER_ALLOW_HOOKS.
 * Woher: Aus dem gestarteten Prozess.
 * Wo: Bei der Runtime-Konfigurationsauflösung.
 * Soll-Ergebnis: Fail-closed bei jeder nicht exakten Aktivierung.
 *
 * @param environment Laufzeitumgebung für testbare Konfigurationsauflösung.
 * @returns Ob die mutierenden lokalen Hooks aktiviert sind.
 */
function parseExplicitBoolean(environment: NodeJS.ProcessEnv, key: string): boolean {
  return environment[key]?.trim().toLowerCase() === "true";
}

/**
 * Liest ein optionales HMAC-Secret für den ausschließlich lokalen Gitea-Webhook-Receiver.
 *
 * Was: Akzeptiert einen nicht leeren Secretwert erst ab 32 Zeichen und lässt den Receiver sonst deaktiviert.
 * Warum: Ohne geheimen HMAC-Schlüssel darf kein eingehender Webhook-Endpunkt verarbeitet werden.
 * Wofür: Für den opt-in Phase-3-Webhook-Receiver unter `/webhooks/gitea`.
 * Woher: Aus GITEA_WEBHOOK_SECRET des gestarteten Prozesses.
 * Wo: Bei Konfigurationsvalidierung vor dem Aufbau der HTTP-Runtime.
 * Soll-Ergebnis: Ein ausreichend langes, nie geloggtes Secret oder ein sicher deaktivierter Receiver.
 *
 * @param environment Laufzeitumgebung für testbare Konfigurationsauflösung.
 * @returns Getrimmtes Webhook-Secret oder `undefined`.
 * @throws {DbzsError} Wenn ein gesetztes Secret zu kurz ist.
 */
function parseOptionalWebhookSecret(environment: NodeJS.ProcessEnv): string | undefined {
  const secret = environment.GITEA_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return undefined;
  }
  if (secret.length < 32) {
    throw new DbzsError("CONFIGURATION_ERROR", "GITEA_WEBHOOK_SECRET muss mindestens 32 Zeichen lang sein.");
  }
  return secret;
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
  const transport = parseTransportMode(environment);
  const webhookSecret = parseOptionalWebhookSecret(environment);
  const webhookTargetUrl = parseOptionalLocalWebhookTargetUrl(environment);
  const featureStarterExecutable = environment.DBZS_FEATURE_STARTER_EXECUTABLE?.trim() || undefined;
  const featureStarterAllowHooks = parseExplicitBoolean(environment, "DBZS_FEATURE_STARTER_ALLOW_HOOKS");

  if (Boolean(webhookSecret) !== Boolean(webhookTargetUrl)) {
    throw new DbzsError(
      "CONFIGURATION_ERROR",
      "GITEA_WEBHOOK_SECRET und GITEA_WEBHOOK_TARGET_URL müssen gemeinsam gesetzt sein, um lokale Gitea-Webhooks zu aktivieren.",
    );
  }
  if (webhookTargetUrl && transport !== "http") {
    throw new DbzsError("CONFIGURATION_ERROR", "Lokale Gitea-Webhooks erfordern MCP_TRANSPORT=http.");
  }
  if (featureStarterAllowHooks && !featureStarterExecutable) {
    throw new DbzsError(
      "CONFIGURATION_ERROR",
      "DBZS_FEATURE_STARTER_ALLOW_HOOKS=true erfordert DBZS_FEATURE_STARTER_EXECUTABLE.",
    );
  }

  return {
    giteaBaseUrl,
    giteaToken,
    allowedOwner,
    tokenSource: dbzsToken ? "DBZS_HOME_API_TOKEN" : "GITEA_TOKEN",
    transport,
    httpPort: parseHttpPort(environment),
    webhookSecret,
    webhookTargetUrl,
    fleetApiUrl: environment.DBZS_FLEET_API_URL?.trim() || undefined,
    featureStarterHealthPath: environment.DBZS_FEATURE_STARTER_HEALTH_PATH?.trim() || undefined,
    featureStarterExecutable,
    featureStarterAllowHooks,
  };
}
