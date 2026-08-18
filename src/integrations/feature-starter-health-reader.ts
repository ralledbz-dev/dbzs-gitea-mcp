/**
 * DBZS — Division By Zeros
 * Datei: integrations/feature-starter-health-reader.ts
 * Zweck: Die bestehende atomar geschriebene DBZS Feature Starter Plattform-Health-Projektion schreibgeschützt anbinden.
 * Version: 0.3.0
 */

import { stat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { DbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";

/**
 * Beschreibt die minimal validierte Plattform-Health-Sicht des DBZS Feature Starters.
 */
export interface FeatureStarterPlatformHealth {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly overallState: string;
  readonly readyComponents: number;
  readonly enabledComponents: number;
  readonly components: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Beschreibt die kontrollierten Abhängigkeiten des Feature-Starter-Health-Adapters.
 */
export interface FeatureStarterHealthReaderOptions {
  /** Absoluter Pfad zur atomar publizierten platform-health.json. */
  readonly healthPath: string;
  /** Zentraler DBZS-EventBus für Read- und Fehlerereignisse. */
  readonly eventBus: DbzsEventBus;
  /** Maximale JSON-Dateigröße gegen unkontrollierte lokale Nutzlasten. */
  readonly maxFileBytes?: number;
}

/**
 * Prüft einen Health-Dateipfad als absoluten lokalen JSON-Pfad.
 *
 * Was: Normalisiert den konfigurierten absoluten Pfad und verlangt die erwartete JSON-Endung.
 * Warum: Die Integration darf keine relativen Arbeitsverzeichnisse oder beliebige Binärdateien als Health-Vertrag behandeln.
 * Wofür: Für `DBZS_FEATURE_STARTER_HEALTH_PATH` und die Read-only-Health-Integration.
 * Woher: Aus der bestehenden Feature-Starter-PlatformHealthSnapshotWriter-Ausgabe.
 * Wo: Beim Adapteraufbau.
 * Soll-Ergebnis: Stabiler absoluter JSON-Pfad oder sichtbarer Konfigurationsfehler.
 *
 * @param value Konfigurierter Health-Dateipfad.
 * @returns Normalisierter absoluter JSON-Pfad.
 * @throws {DbzsError} Bei ungültigem Pfad.
 */
export function normalizeFeatureStarterHealthPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !isAbsolute(trimmed) || !trimmed.toLowerCase().endsWith(".json")) {
    throw new DbzsError("CONFIGURATION_ERROR", "DBZS_FEATURE_STARTER_HEALTH_PATH muss ein absoluter Pfad zu einer JSON-Datei sein.");
  }
  return resolve(trimmed);
}

/**
 * Bindet die bestehende Feature-Starter-Health-Sicht schreibgeschützt an.
 *
 * Was: Liest und validiert die atomar geschriebene Plattformstatusdatei.
 * Warum: Feature Starter bleibt kanonischer Bootstrap- und Lifecycle-Controller; MCP erhält nur Diagnosesicht.
 * Wofür: Für lokale DBZS-Status- und Updateentscheidungen in Phase 3.
 * Woher: Aus PlatformHealthSnapshotWriter des DBZS Feature Starters.
 * Wo: Zwischen MCP-Orchestrierung und der lokalen Feature-Starter-Statusdatei.
 * Soll-Ergebnis: Eine robuste Read-only-Projektion ohne Prozess- oder Installersteuerung.
 */
export class FeatureStarterHealthReader {
  private readonly healthPath: string;
  private readonly maxFileBytes: number;

  /**
   * Erstellt den Read-only-Adapter auf die bestehende Feature-Starter-Health-Sicht.
   *
   * @param options Kontrollierter lokaler Pfad, EventBus und Größenlimit.
   */
  public constructor(private readonly options: FeatureStarterHealthReaderOptions) {
    this.healthPath = normalizeFeatureStarterHealthPath(options.healthPath);
    this.maxFileBytes = options.maxFileBytes ?? 1_048_576;
  }

  /**
   * Liest, parst und validiert die aktuelle Feature-Starter-Plattformstatusdatei.
   *
   * Was: Prüft Dateigröße, lädt JSON und validiert die Kernfelder des bestehenden Vertrags.
   * Warum: Lokale Diagnosefehler müssen sichtbar werden, ohne dass der MCP-Server eigene Lifecycle-Daten erfindet.
   * Wofür: Für das MCP-Tool `dbzs_get_feature_starter_health`.
   * Woher: Aus der atomar veröffentlichten `platform-health.json`.
   * Wo: Im Read-only-Integrationsadapter.
   * Soll-Ergebnis: Schematisch erkennbare Health-Projektion oder ein nachvollziehbarer DBZS-Fehler.
   *
   * @returns Validierte Plattform-Health-Projektion.
   */
  public async readHealth(): Promise<FeatureStarterPlatformHealth> {
    this.options.eventBus.publish("featureStarter.health.read.started", "info", { healthPath: this.healthPath });
    let size: number;
    try {
      size = (await stat(this.healthPath)).size;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Dateistatus unbekannt";
      this.options.eventBus.publish("featureStarter.health.read.failed", "error", { healthPath: this.healthPath, reason });
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die DBZS Feature Starter Health-Datei ist nicht erreichbar.", { healthPath: this.healthPath, reason });
    }

    if (size > this.maxFileBytes) {
      this.options.eventBus.publish("featureStarter.health.read.failed", "error", { healthPath: this.healthPath, size, maxFileBytes: this.maxFileBytes });
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die DBZS Feature Starter Health-Datei überschreitet die erlaubte Größe.", { healthPath: this.healthPath, size });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.healthPath, "utf8")) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "JSON konnte nicht gelesen werden";
      this.options.eventBus.publish("featureStarter.health.read.failed", "error", { healthPath: this.healthPath, reason });
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die DBZS Feature Starter Health-Datei enthält kein lesbares JSON.", { healthPath: this.healthPath, reason });
    }

    const health = this.validateHealthDocument(parsed);
    this.options.eventBus.publish("featureStarter.health.read.completed", "info", {
      healthPath: this.healthPath,
      overallState: health.overallState,
      readyComponents: health.readyComponents,
      enabledComponents: health.enabledComponents,
    });
    return health;
  }

  /**
   * Validiert die stabilen Kernfelder der Feature-Starter-Health-Projektion.
   *
   * Was: Prüft Recordstruktur, Schema- und Statusfelder sowie Komponentenliste.
   * Warum: Fremder lokaler Dateicontent darf nicht still als vertrauenswürdiger Integrationszustand behandelt werden.
   * Wofür: Für die Rückgabe einer sicheren MCP-Read-Projektion.
   * Woher: Aus dem bestehenden PlatformHealthDocument-Vertrag des Feature Starters.
   * Wo: Direkt nach dem JSON-Parsing.
   * Soll-Ergebnis: Minimal validierte, immutable Health-Daten.
   *
   * @param value Unbekanntes JSON-Dokument.
   * @returns Validierte Health-Projektion.
   */
  private validateHealthDocument(value: unknown): FeatureStarterPlatformHealth {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die DBZS Feature Starter Health-Datei hat keine gültige Objektstruktur.");
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.schemaVersion !== "number" ||
      typeof record.generatedAt !== "string" ||
      typeof record.overallState !== "string" ||
      typeof record.readyComponents !== "number" ||
      typeof record.enabledComponents !== "number" ||
      !Array.isArray(record.components)
    ) {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die DBZS Feature Starter Health-Datei verletzt den erwarteten Basisvertrag.");
    }
    if (!record.components.every((component) => typeof component === "object" && component !== null && !Array.isArray(component))) {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Die DBZS Feature Starter Health-Datei enthält ungültige Komponentenmetadaten.");
    }

    return {
      schemaVersion: record.schemaVersion,
      generatedAt: record.generatedAt,
      overallState: record.overallState,
      readyComponents: record.readyComponents,
      enabledComponents: record.enabledComponents,
      components: record.components as ReadonlyArray<Record<string, unknown>>,
    };
  }
}
