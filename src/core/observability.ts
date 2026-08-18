/**
 * DBZS — Division By Zeros
 * Datei: core/observability.ts
 * Zweck: Ereignisverteilung und strukturiertes stderr-Logging für den MCP-Server bereitstellen.
 * Version: 0.2.0
 */

import { EventEmitter } from "node:events";

/**
 * Definiert die Schwere eines DBZS-Protokolleintrags.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Beschreibt ein fachlich relevantes Runtime-Ereignis des MCP-Servers.
 */
export interface DbzsRuntimeEvent {
  /** ISO-8601-Zeitpunkt der Ereigniserzeugung. */
  readonly timestamp: string;
  /** Stabile Kategorie für Filterung und Diagnose. */
  readonly name: string;
  /** Schweregrad des Ereignisses. */
  readonly level: LogLevel;
  /** Bereinigte Kontextdaten ohne Geheimnisse. */
  readonly context: Record<string, unknown>;
}

/**
 * Zentraler EventBus für lose gekoppelte Observability-Ereignisse.
 *
 * Was: Verteilt typisierte Runtime-Ereignisse an registrierte Beobachter.
 * Warum: Infrastruktur, Gitea-Adapter und MCP-Tools sollen ohne direkte Abhängigkeiten beobachtbar sein.
 * Wofür: Für Audit-, Start-, Request- und Fehlerereignisse des lokalen Servers.
 * Woher: Aus den verbindlichen DBZS-Prinzipien für EventBus und Observability.
 * Wo: Als gemeinsame Instanz im Runtime-Container.
 * Soll-Ergebnis: Jeder relevante Prozess erzeugt ein maschinenlesbares Ereignis.
 */
export class DbzsEventBus {
  private readonly emitter = new EventEmitter();

  /**
   * Veröffentlicht ein Runtime-Ereignis an alle Beobachter.
   *
   * Was: Erzeugt einen unveränderlichen Ereignisdatensatz und sendet ihn synchron aus.
   * Warum: Logging und künftige Adapter sollen denselben, vollständigen Kontext erhalten.
   * Wofür: Für alle fachlich relevanten Servervorgänge.
   * Woher: Aus den Aufrufen der Runtime, des Policy-Layers und des Gitea-Clients.
   * Wo: Im zentralen EventBus.
   * Soll-Ergebnis: Alle Abonnenten erhalten identische Ereignisdaten.
   *
   * @param name Stabiler Ereignisname, beispielsweise "gitea.request.completed".
   * @param level Schweregrad des Ereignisses.
   * @param context Bereinigte Zusatzdaten ohne Secrets.
   */
  public publish(name: string, level: LogLevel, context: Record<string, unknown> = {}): void {
    const event: DbzsRuntimeEvent = {
      timestamp: new Date().toISOString(),
      name,
      level,
      context,
    };

    this.emitter.emit("dbzs.runtime", event);
  }

  /**
   * Registriert einen Beobachter für alle Runtime-Ereignisse.
   *
   * Was: Bindet einen Listener an den zentralen Ereigniskanal.
   * Warum: Module dürfen Observability konsumieren, ohne Produzenten zu verändern.
   * Wofür: Für Logger und spätere lokale Integrationsadapter.
   * Woher: Aus der EventBus-basierten DBZS-Architektur.
   * Wo: Beim Start der Runtime.
   * Soll-Ergebnis: Der Listener erhält alle künftig veröffentlichten Ereignisse.
   *
   * @param listener Callback für Ereignisdatensätze.
   * @returns Funktion zum kontrollierten Abmelden des Listeners.
   */
  public subscribe(listener: (event: DbzsRuntimeEvent) => void): () => void {
    this.emitter.on("dbzs.runtime", listener);
    return () => this.emitter.off("dbzs.runtime", listener);
  }
}

/**
 * Schreibt strukturierte DBZS-Protokolle nach stderr.
 *
 * Was: Serialisiert Runtime-Ereignisse als JSON-Zeilen.
 * Warum: stdout ist beim MCP-stdio-Transport ausschließlich dem Protokoll vorbehalten.
 * Wofür: Lokale Diagnose, Prozessüberwachung und spätere Log-Aggregation.
 * Woher: Aus dem MCP-stdio-Protokoll und der DBZS-Observability-Pflicht.
 * Wo: Als Abonnent des zentralen EventBus.
 * Soll-Ergebnis: Beobachtbarkeit ohne Beschädigung des MCP-Datenstroms.
 */
export class StderrLogger {
  /**
   * Bindet diesen Logger an einen EventBus.
   *
   * Was: Registriert eine JSON-Zeilen-Ausgabe für jedes Runtime-Ereignis.
   * Warum: Ein einziger Startvorgang aktiviert konsistente Protokollierung.
   * Wofür: Für die Betriebsdiagnose des lokalen MCP-Servers.
   * Woher: Aus dem Runtime-Container beim Serverstart.
   * Wo: An der Schnittstelle zwischen EventBus und stderr.
   * Soll-Ergebnis: Alle Ereignisse werden ohne Tokenwerte nach stderr geschrieben.
   *
   * @param eventBus Zentraler DBZS-EventBus.
   */
  public attach(eventBus: DbzsEventBus): void {
    eventBus.subscribe((event) => {
      process.stderr.write(`${JSON.stringify({ source: "dbzs-gitea-mcp", ...event })}\n`);
    });
  }
}
