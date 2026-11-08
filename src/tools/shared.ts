/**
 * DBZS — Division By Zeros
 * Datei: tools/shared.ts
 * Zweck: Gemeinsame Zod-Schemas, MCP-Ergebnisformung und Tool-Annotationen für alle Tool-Module bereitstellen.
 * Version: 0.4.0
 */

import * as z from "zod/v4";
import { toDbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";

/**
 * Serialisiert einen beliebigen API-Wert stabil für eine MCP-Textantwort.
 *
 * @param value Ergebnisdaten einer Tooloperation.
 * @returns MCP-konforme Textantwort.
 */
export function successResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Erstellt eine sichere MCP-Fehlerantwort.
 *
 * @param code Stabile DBZS-Fehlerkategorie.
 * @param message Sichere, lesbare Fehlermeldung.
 * @returns MCP-konforme Fehlerantwort.
 */
export function failureResult(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }, null, 2) }],
    isError: true as const,
  };
}

/**
 * Führt eine Tooloperation mit einheitlichem EventBus- und Fehlerverhalten aus.
 *
 * @param eventBus Zentraler DBZS-EventBus.
 * @param toolName Stabile Kennung des ausgeführten MCP-Tools.
 * @param operation Asynchrone Geschäftsoperation ohne MCP-Protokolldetails.
 * @returns Ein erfolgreiches oder kontrolliertes fehlerhaftes MCP-Tool-Ergebnis.
 */
export async function executeTool(eventBus: DbzsEventBus, toolName: string, operation: () => Promise<unknown>) {
  const startedAt = Date.now();
  eventBus.publish("mcp.tool.started", "info", { toolName });

  try {
    const result = await operation();
    eventBus.publish("mcp.tool.completed", "info", {
      toolName,
      durationMs: Date.now() - startedAt,
    });
    return successResult(result);
  } catch (error) {
    const dbzsError = toDbzsError(error);
    eventBus.publish("mcp.tool.failed", "error", {
      toolName,
      durationMs: Date.now() - startedAt,
      errorCode: dbzsError.code,
      errorMessage: dbzsError.message,
      details: dbzsError.details,
    });
    return failureResult(dbzsError.code, dbzsError.message);
  }
}

/**
 * Leitet MCP-Tool-Annotationen mechanisch aus der bestehenden Schreib-Bestätigungskonvention ab.
 *
 * Was: Tools mit `confirm: z.literal(true)` gelten als mutierend, alle anderen als schreibgeschützt.
 * Warum: Annotationen sollen kein zweites, unabhängig pflegbares Klassifikationssystem sein, sondern die bereits
 * im Inputschema erzwungene Schreib-Policy widerspiegeln — dieselbe Unterscheidung, die MCP-Clients wie ein
 * OpenAI-Tool-Scan zur Einstufung verwenden.
 * Wofür: Für jede `registerTool`-Aufruf in den `tools/*`-Modulen.
 * Woher: Aus der bestehenden `confirm`-Konvention des Gitea-Clients und der MCP-Registrierung.
 * Wo: Bei jeder Toolregistrierung.
 * Soll-Ergebnis: `readOnlyHint`/`destructiveHint`/`idempotentHint` stimmen immer mit der tatsächlichen Semantik überein.
 *
 * @param isMutating Ob das Tool eine Gitea- oder Fleet-Commander-Mutation auslöst.
 * @returns Vollständige MCP-Tool-Annotationen.
 */
export function buildAnnotations(isMutating: boolean): {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
} {
  return isMutating
    ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    : { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
}

/** Gemeinsames Owner-Schema für alle repository- und packagebezogenen Tools. */
export const ownerSchema = z.string().trim().min(1).max(100);
/** Gemeinsames Repository-Namensschema. */
export const repositorySchema = z.string().trim().min(1).max(255);
/** Gemeinsames Paginierungs-Limitschema. */
export const paginationSchema = z.number().int().min(1).max(100);
/** Gemeinsames State-Schema für Pull Requests und Issues. */
export const stateSchema = z.enum(["open", "closed", "all"]);
/** Gemeinsames Schema für positive numerische Gitea-IDs. */
export const positiveIdSchema = z.number().int().positive();
