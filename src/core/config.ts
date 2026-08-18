/**
 * DBZS — Division By Zeros
 * Datei: core/config.ts
 * Zweck: Sichere Runtime-Konfiguration aus Environment Variables validieren und normalisieren.
 * Version: 0.2.0
 */

import { DbzsError } from "./errors.js";

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
}

/**
 * Liest eine nicht leere Umgebungsvariable oder beendet den Start kontrolliert.
 *
 * Was: Liefert den getrimmten Wert einer Umgebungsvariable.
 * Warum: Fehlende Konfiguration darf nicht zu implizit unsicherem Verhalten führen.
 * Wofür: Für Basis-URL, Token und Namespace-Allowlist.
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
 * Lädt und validiert die produktive Serverkonfiguration.
 *
 * Was: Priorisiert DBZS_HOME_API_TOKEN und erlaubt GITEA_TOKEN nur als kompatiblen Fallback.
 * Warum: Zugangsdaten werden ausschließlich aus dem Prozesskontext bezogen und nie in Dateien persistiert.
 * Wofür: Für die sichere Initialisierung von Policy und Gitea-Client.
 * Woher: Aus dem Nutzer- beziehungsweise Dienstprozess auf Windows.
 * Wo: Im Runtime-Container beim Serverstart.
 * Soll-Ergebnis: Ein voll validiertes Konfigurationsobjekt mit verpflichtender Owner-Allowlist.
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
  };
}
