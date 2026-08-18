/**
 * DBZS — Division By Zeros
 * Datei: core/errors.ts
 * Zweck: Einheitliche, sichere Fehlerobjekte für Konfiguration, Richtlinien und die Gitea-API bereitstellen.
 * Version: 0.2.0
 */

/**
 * Kennzeichnet Fehlerklassen, damit MCP-Antworten und Protokolle eindeutig bewertet werden können.
 */
export type DbzsErrorCode =
  | "CONFIGURATION_ERROR"
  | "POLICY_VIOLATION"
  | "GITEA_API_ERROR"
  | "GITEA_PROTOCOL_ERROR"
  | "UNEXPECTED_ERROR";

/**
 * Repräsentiert einen kontrolliert weitergegebenen Fehler ohne Geheimniswerte.
 *
 * Was: Erweiterung von Error um einen maschinenlesbaren DBZS-Fehlercode und optionale Kontextdaten.
 * Warum: MCP-Clients benötigen klare Fehler, während interne Details und Tokens geschützt bleiben.
 * Wofür: Für Konfiguration, Namespace-Policy und Fehlerantworten der Gitea-REST-API.
 * Woher: Aus DBZS-Anforderungen zu Observability und transparenter Fehlerbehandlung.
 * Wo: Im gesamten Runtime- und Gitea-Adapter-Layer.
 * Soll-Ergebnis: Einheitliche Fehlerbehandlung ohne Leaken von Zugangsdaten.
 */
export class DbzsError extends Error {
  /**
   * Erstellt einen DBZS-Fehler mit sicherem Kontext.
   *
   * Was: Initialisiert Code und optionale, nicht geheime Metadaten.
   * Warum: Fehler sollen kategorisierbar und nachvollziehbar sein.
   * Wofür: Für die Weitergabe an Logger, EventBus und MCP-Toolantworten.
   * Woher: Aus der DBZS-Vorgabe, Fehler weder zu unterdrücken noch unsicher offenzulegen.
   * Wo: Bei jeder erwarteten Fehlerbedingung.
   * Soll-Ergebnis: Ein Error-Objekt mit stabiler Ursache und Code.
   *
   * @param code Fehlerkategorie für Maschinen und Protokolle.
   * @param message Für Nutzende geeignete, sichere Fehlerbeschreibung.
   * @param details Optionale Metadaten ohne Secrets.
   */
  public constructor(
    public readonly code: DbzsErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DbzsError";
  }
}

/**
 * Repräsentiert einen von Gitea zurückgegebenen API-Fehler.
 *
 * Was: Ergänzt einen DBZS-Fehler um HTTP-Status und angefragten relativen API-Pfad.
 * Warum: HTTP-Fehler müssen im Betrieb gezielt analysiert werden können.
 * Wofür: Für fehlgeschlagene Gitea-REST-Aufrufe.
 * Woher: Aus dem Gitea-API-Vertrag und den DBZS-Observability-Regeln.
 * Wo: Ausschließlich im Gitea-Client.
 * Soll-Ergebnis: Fehlerantworten sind nachvollziehbar, ohne den Token preiszugeben.
 */
export class GiteaApiError extends DbzsError {
  /**
   * Erstellt einen sicher protokollierbaren Fehler für eine Gitea-HTTP-Antwort.
   *
   * Was: Speichert Status und relativen Pfad als sichere Kontextdaten.
   * Warum: Die Ursache eines API-Fehlers muss ohne sensiblen Request-Header sichtbar sein.
   * Wofür: Für Fehlermeldungen bei 4xx/5xx-Antworten und Protokollfehlern.
   * Woher: Aus den Gitea-REST-API-Endpunkten unter /api/v1.
   * Wo: In der zentralen Request-Funktion des Gitea-Clients.
   * Soll-Ergebnis: Strukturierter API-Fehler für MCP und Logs.
   *
   * @param status HTTP-Statuscode der Gitea-Antwort.
   * @param path Relativer API-Pfad ohne Base-URL und ohne Zugangsdaten.
   * @param message Sichere Fehlerbeschreibung.
   * @param details Zusätzliche, bereinigte Antwortdaten.
   */
  public constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super("GITEA_API_ERROR", message, { status, path, ...details });
    this.name = "GiteaApiError";
  }
}

/**
 * Wandelt einen unbekannten Fehler in eine sichere DBZS-Fehlerdarstellung um.
 *
 * Was: Normalisiert beliebige geworfene Werte zu einem DbzsError.
 * Warum: Alle Fehlerpfade müssen transparent, aber ohne Geheimnisse behandelbar sein.
 * Wofür: Für die letzte Fehlergrenze der MCP-Toolausführung.
 * Woher: Aus JavaScripts Möglichkeit, beliebige Werte zu werfen.
 * Wo: In Server- und Runtime-Grenzen.
 * Soll-Ergebnis: Jede Fehlersituation erhält eine eindeutige und sichere Fehlerbeschreibung.
 *
 * @param error Unbekannter abgefangener Wert.
 * @returns Den ursprünglichen DBZS-Fehler oder einen normalisierten unerwarteten Fehler.
 */
export function toDbzsError(error: unknown): DbzsError {
  if (error instanceof DbzsError) {
    return error;
  }

  if (error instanceof Error) {
    return new DbzsError("UNEXPECTED_ERROR", "Ein unerwarteter Serverfehler ist aufgetreten.", {
      originalName: error.name,
      originalMessage: error.message,
    });
  }

  return new DbzsError("UNEXPECTED_ERROR", "Ein nicht klassifizierter Serverfehler ist aufgetreten.", {
    originalValueType: typeof error,
  });
}
