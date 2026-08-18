/**
 * DBZS — Division By Zeros
 * Datei: health/probe.ts
 * Zweck: Einmalige Versionsquelle sowie Health- und Ready-Nutzlasten für den lokalen HTTP-Transport bereitstellen.
 * Version: 0.4.0
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Stabiler MCP-Servicename, identisch mit dem in der MCP-Server-Registrierung verwendeten Namen.
 */
export const SERVICE_NAME = "dbzs-gitea-mcp";

/**
 * Liest die Serverversion einmalig direkt aus package.json.
 *
 * Was: Löst den Projektwurzelpfad relativ zur kompilierten Datei auf und liest ausschließlich das Feld "version".
 * Warum: Ein statischer JSON-Import würde package.json (außerhalb von `rootDir: "src"`) in den TypeScript-Buildgraphen
 * ziehen und riskiert, den `dist/index.js`-Ausgabepfad zu verschieben, von dem Installer und Feature-Starter-Dienst
 * bereits abhängen. Ein Runtime-Read umgeht das vollständig.
 * Wofür: Für `SERVICE_VERSION`.
 * Woher: Aus package.json im Projektwurzelverzeichnis, relativ zu `dist/health/probe.js` zur Laufzeit aufgelöst.
 * Wo: Einmalig beim Modul-Import.
 * Soll-Ergebnis: Die tatsächliche package.json-Version, ohne den Build-Ausgabepfad zu beeinflussen.
 *
 * @returns Der Wert des "version"-Felds aus package.json.
 */
function readPackageVersion(): string {
  const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { readonly version?: unknown };
  const version = parsed.version;
  if (typeof version !== "string" || !version) {
    throw new Error("package.json enthält keine gültige 'version'.");
  }
  return version;
}

/**
 * Einmalig aus package.json gelesene Serverversion.
 *
 * Was: Einzige Quelle für die in `McpServer` und `/version` verwendete Versionsangabe.
 * Warum: Eine hart kodierte zweite Versionskonstante lief zuvor unbemerkt aus dem Takt (0.3.0 vs. package.json 0.4.0).
 * Wofür: Für `McpServer({ version })` und den `/version`-Endpunkt.
 * Woher: Aus package.json im Projektwurzelverzeichnis.
 * Wo: Beim Modul-Import, vor jedem Serverstart.
 * Soll-Ergebnis: MCP-Protokollversion und HTTP-`/version`-Antwort sind immer identisch.
 */
export const SERVICE_VERSION: string = readPackageVersion();

/**
 * Baut die Antwort des `/version`-Endpunkts.
 *
 * @returns Servicename und aktuelle Version.
 */
export function buildVersionPayload(): { readonly service: string; readonly version: string } {
  return { service: SERVICE_NAME, version: SERVICE_VERSION };
}

/**
 * Baut die Antwort des `/health`-Endpunkts.
 *
 * Was: Meldet ausschließlich, dass der Prozess läuft und der HTTP-Listener antwortet.
 * Warum: Ein reiner Liveness-Check darf keine Fremdsystem-Aufrufe auslösen und muss für häufiges Polling sicher billig bleiben.
 * Wofür: Für externe Prozessüberwachung, beispielsweise DBZS Feature Starter.
 * Woher: Aus dem lokalen HTTP-Transport, sobald der Listener gebunden ist.
 * Wo: Unter `/health`.
 * Soll-Ergebnis: Ein stets erfolgreiches, sofortiges Ergebnis ohne Netzwerklatenz.
 *
 * @returns Servicename und Status "healthy".
 */
export function buildHealthPayload(): { readonly service: string; readonly status: "healthy" } {
  return { service: SERVICE_NAME, status: "healthy" };
}

/**
 * Baut die Antwort des `/ready`-Endpunkts.
 *
 * Was: Meldet Version und aktuell registrierte Toolanzahl, weiterhin ohne Fremdsystem-Aufruf.
 * Warum: Externe Orchestrierung (z. B. Feature-Starter-Probes im 500ms-Takt) darf keine Gitea-Last durch Polling erzeugen;
 * der MCP-Server hat außerdem keine asynchrone Aufwärmphase, die eine echte Bereitschaftsprüfung rechtfertigen würde.
 * Wofür: Für externe Ready-Checks vor dem Beginn der eigentlichen Nutzung.
 * Woher: Aus dem lokalen HTTP-Transport nach vollständiger Toolregistrierung.
 * Wo: Unter `/ready`.
 * Soll-Ergebnis: Ein sofortiges Ergebnis mit diagnostisch nützlicher Toolanzahl.
 *
 * @param toolCount Anzahl der aktuell registrierten MCP-Tools.
 * @returns Servicename, Status "ready", Version und Toolanzahl.
 */
export function buildReadyPayload(
  toolCount: number,
): { readonly service: string; readonly status: "ready"; readonly version: string; readonly tools: number } {
  return { service: SERVICE_NAME, status: "ready", version: SERVICE_VERSION, tools: toolCount };
}
