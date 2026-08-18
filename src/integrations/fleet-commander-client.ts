/**
 * DBZS — Division By Zeros
 * Datei: integrations/fleet-commander-client.ts
 * Zweck: Die bestehende versionierte DBZS Fleet Commander Control Plane schreibgeschützt und beobachtbar anbinden.
 * Version: 0.3.0
 */

import { DbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import type { FetchFunction } from "../gitea/client.js";

/**
 * Beschreibt die Version und den verpflichtenden Header der vorhandenen Fleet Commander Control Plane.
 */
const FLEET_API_VERSION = "v1";
const FLEET_API_HEADER = "X-DBZS-Fleet-API";

/**
 * Beschreibt eine kompakte, lesende Fleet-Commander-Adapterkonfiguration.
 */
export interface FleetCommanderClientOptions {
  /** Ausschließlich lokale Fleet-Commander-Basis-URL. */
  readonly baseUrl: string;
  /** Zentraler DBZS-EventBus für Integrationstelemetrie. */
  readonly eventBus: DbzsEventBus;
  /** Optionaler testbarer Fetch-Adapter. */
  readonly fetchFunction?: FetchFunction;
}

/**
 * Prüft und normalisiert eine ausschließlich lokale Fleet-Commander-URL.
 *
 * Was: Akzeptiert HTTP-URLs an 127.0.0.1, ::1 oder localhost und entfernt einen abschließenden Slash.
 * Warum: Die MCP-Integration darf die lokale Fleet Control Plane nicht versehentlich zu einem externen Request-Proxy machen.
 * Wofür: Für `DBZS_FLEET_API_URL` und den Fleet Commander Read-Adapter.
 * Woher: Aus der bestehenden Fleet-Commander-Default-URL und optionaler Prozesskonfiguration.
 * Wo: Vor jedem Aufbau des Integration-Clients.
 * Soll-Ergebnis: Kanonische Loopback-URL oder ein sichtbarer Konfigurationsfehler.
 *
 * @param value Konfigurierte Fleet-Commander-Basisadresse.
 * @returns Normalisierte lokale HTTP-Basisadresse.
 * @throws {DbzsError} Bei ungültiger oder nicht lokaler URL.
 */
export function normalizeFleetCommanderBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DbzsError("CONFIGURATION_ERROR", "DBZS_FLEET_API_URL muss eine absolute lokale HTTP-URL sein.");
  }

  const normalizedHost = url.hostname.toLowerCase();
  if (url.protocol !== "http:" || !["127.0.0.1", "::1", "localhost"].includes(normalizedHost)) {
    throw new DbzsError("CONFIGURATION_ERROR", "DBZS_FLEET_API_URL darf ausschließlich auf einen lokalen HTTP-Loopback-Endpunkt zeigen.");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

/**
 * Bindet die bestehende Fleet Commander Control Plane als schreibgeschützten DBZS-Adapter an.
 *
 * Was: Liest Health-, Dashboard-, Betriebs-, Service- und Event-Projektionen mit dem kanonischen Versionsheader.
 * Warum: Fleet Commander bleibt alleiniger Owner seiner Runtime- und Operator-Logik; der MCP-Server dupliziert sie nicht.
 * Wofür: Für DBZS-übergreifende Diagnose- und Updateentscheidungen in Phase 3.
 * Woher: Aus der existierenden Fleet Commander v1 Control Plane.
 * Wo: Zwischen MCP-Orchestrierung und der lokalen Fleet-API.
 * Soll-Ergebnis: Transparente Read-Integration mit EventBus-Observability und ohne mutierende Fleet-Aufrufe.
 */
export class FleetCommanderClient {
  private readonly baseUrl: string;
  private readonly fetchFunction: FetchFunction;

  /**
   * Erstellt den lokalen Fleet-Commander-Adapter.
   *
   * @param options Validierte Loopback-Adresse, EventBus und optionaler Request-Adapter.
   */
  public constructor(private readonly options: FleetCommanderClientOptions) {
    this.baseUrl = normalizeFleetCommanderBaseUrl(options.baseUrl);
    this.fetchFunction = options.fetchFunction ?? fetch;
  }

  /**
   * Liest den kleinen versionierten Fleet-Healthstatus.
   *
   * @returns Fleet-Health-Projektion.
   */
  public getHealth(): Promise<Record<string, unknown>> {
    return this.request("/health");
  }

  /**
   * Liest die umfassende, von Fleet Commander besessene Dashboard-Projektion.
   *
   * @returns Fleet-Dashboard-Projektion.
   */
  public getDashboard(): Promise<Record<string, unknown>> {
    return this.request("/dashboard");
  }

  /**
   * Liest die schreibgeschützte Commissioning-, Production- und Maintenance-Projektion.
   *
   * @returns Fleet-Betriebsstatus.
   */
  public getOperatingStatus(): Promise<Record<string, unknown>> {
    return this.request("/operating-status");
  }

  /**
   * Liest die durch Fleet Commander verwalteten Ready-Service-Projektionen.
   *
   * @returns Lokale Fleet-Service-Liste.
   */
  public getServices(): Promise<Record<string, unknown>[]> {
    return this.request("/services");
  }

  /**
   * Liest die jüngsten Fleet-Ereignisse für Diagnosezwecke.
   *
   * @returns Lokale Fleet-Ereignisliste.
   */
  public getEvents(): Promise<Record<string, unknown>[]> {
    return this.request("/events");
  }

  /**
   * Führt einen kontrollierten schreibgeschützten Fleet-API-Request aus.
   *
   * Was: Baut den kanonischen v1-Pfad und Header, misst Dauer und normalisiert Fehler.
   * Warum: Fleet-spezifische Versions- und Fehlersemantik darf nicht in MCP-Tools dupliziert werden.
   * Wofür: Für alle öffentlichen Read-Methoden dieses Adapters.
   * Woher: Aus der dokumentierten Fleet Commander Control Plane.
   * Wo: Zentral an der Integrationsgrenze.
   * Soll-Ergebnis: Typisierte JSON-Projektion oder ein transparenter DBZS-Fehler.
   *
   * @param path Relativer Fleet-v1-Pfad.
   * @returns JSON-Projektion der lokalen Fleet-API.
   */
  private async request<T>(path: string): Promise<T> {
    const url = new URL(`${this.baseUrl}/${FLEET_API_VERSION}${path}`);
    const startedAt = Date.now();
    this.options.eventBus.publish("fleet.request.started", "info", { path });

    let response: Response;
    try {
      response = await this.fetchFunction(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          [FLEET_API_HEADER]: FLEET_API_VERSION,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unbekannter Netzwerkfehler";
      this.options.eventBus.publish("fleet.request.failed", "error", { path, reason });
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die lokale DBZS Fleet Commander API konnte nicht erreicht werden.", { path, reason });
    }

    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      const message = (await response.text()).trim().slice(0, 500);
      this.options.eventBus.publish("fleet.request.failed", "error", { path, status: response.status, durationMs });
      throw new DbzsError("GITEA_PROTOCOL_ERROR", `Die DBZS Fleet Commander API hat HTTP ${response.status} geliefert.`, {
        path,
        status: response.status,
        responseMessage: message || undefined,
      });
    }

    try {
      const result = (await response.json()) as T;
      this.options.eventBus.publish("fleet.request.completed", "info", { path, status: response.status, durationMs });
      return result;
    } catch {
      this.options.eventBus.publish("fleet.request.failed", "error", { path, status: response.status, durationMs, reason: "json_invalid" });
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die DBZS Fleet Commander API hat keine lesbare JSON-Antwort geliefert.", { path, status: response.status });
    }
  }
}
