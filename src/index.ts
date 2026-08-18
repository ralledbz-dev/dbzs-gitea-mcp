/**
 * DBZS — Division By Zeros
 * Datei: index.ts
 * Zweck: Schlanker Prozesseinstiegspunkt; delegiert den kompletten Runtime-Aufbau an server/runtime.ts.
 * Version: 0.4.0
 */

import { toDbzsError } from "./core/errors.js";
import { startServer } from "./server/runtime.js";

/**
 * Startet die Runtime und beendet den Prozess bei einem nicht behebbaren Startfehler mit Code 1.
 *
 * Was: Setzt eine explizite, sichtbare Fehlergrenze um die asynchrone Serverinitialisierung.
 * Warum: Konfigurations- und Initialisierungsfehler dürfen nicht als unbeobachtete Promise-Rejections enden.
 * Wofür: Für einen kontrollierten Dienststart unter Windows und lokalen MCP-Clients.
 * Woher: Aus Node.js-Prozesssemantik und den DBZS-Anforderungen an transparente Fehlerbehandlung.
 * Wo: Am Programmeinstieg.
 * Soll-Ergebnis: Fehler erscheinen sicher nach stderr und der Prozess signalisiert einen Fehlstart.
 */
void startServer().catch((error: unknown) => {
  const dbzsError = toDbzsError(error);
  process.stderr.write(
    `${JSON.stringify({
      source: "dbzs-gitea-mcp",
      timestamp: new Date().toISOString(),
      name: "runtime.start.failed",
      level: "error",
      context: {
        errorCode: dbzsError.code,
        errorMessage: dbzsError.message,
        details: dbzsError.details,
      },
    })}\n`,
  );
  process.exitCode = 1;
});
