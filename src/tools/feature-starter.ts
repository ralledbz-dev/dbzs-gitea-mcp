/**
 * DBZS — Division By Zeros
 * Datei: tools/feature-starter.ts
 * Zweck: DBZS-Feature-Starter-Integrationstools (Health-Read und Update-/Installer-Hooks) registrieren, sofern konfiguriert.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { FeatureStarterHealthReader } from "../integrations/feature-starter-health-reader.js";
import { FeatureStarterHook } from "../integrations/feature-starter-hook.js";
import { buildAnnotations, executeTool } from "./shared.js";

/**
 * Registriert die Feature-Starter-Integrationstools, sofern die jeweiligen Adapter konfiguriert sind.
 *
 * @param server MCP-Server-Instanz.
 * @param eventBus Zentraler DBZS-EventBus.
 * @param featureStarterHealth Optionaler Read-only-Adapter der Feature-Starter-Plattformstatusdatei.
 * @param featureStarterHook Optionaler Adapter der bestehenden Feature-Starter-Update-/Installer-CLI-Verträge.
 * @returns Anzahl der registrierten Tools.
 */
export function registerFeatureStarterTools(
  server: McpServer,
  eventBus: DbzsEventBus,
  featureStarterHealth?: FeatureStarterHealthReader,
  featureStarterHook?: FeatureStarterHook,
): number {
  let toolCount = 0;

  if (featureStarterHealth) {
    server.registerTool(
      "dbzs_get_feature_starter_health",
      {
        title: "DBZS Feature Starter Plattformstatus lesen",
        description: "Liest ausschließlich die atomar publizierte read-only platform-health.json. Feature Starter bleibt kanonischer Bootstrap- und Lifecycle-Controller.",
        inputSchema: z.object({}),
        annotations: buildAnnotations(false),
      },
      async () => executeTool(eventBus, "dbzs_get_feature_starter_health", () => featureStarterHealth.readHealth()),
    );
    toolCount += 1;
  }

  if (featureStarterHook) {
    server.registerTool(
      "dbzs_check_feature_starter_updates",
      {
        title: "DBZS Feature Starter Updates prüfen",
        description: "Delegiert eine schreibgeschützte Update-Prüfung an den bestehenden DBZS Feature Starter. Die bestehende Update-Logik, Historie und Worktree-Policy bleiben dort verankert.",
        inputSchema: z.object({}),
        annotations: buildAnnotations(false),
      },
      async () => executeTool(eventBus, "dbzs_check_feature_starter_updates", () => featureStarterHook.checkUpdates()),
    );
    toolCount += 1;

    server.registerTool(
      "dbzs_apply_feature_starter_updates",
      {
        title: "DBZS Feature Starter Updates anwenden",
        description: "Schreiboperation: Delegiert nach confirm: true ausschließlich an den bestehenden transaktionalen Feature-Starter-Update-Manager. Zusätzlich muss DBZS_FEATURE_STARTER_ALLOW_HOOKS=true gesetzt sein.",
        inputSchema: z.object({ confirm: z.literal(true) }),
        annotations: buildAnnotations(true),
      },
      async () => executeTool(eventBus, "dbzs_apply_feature_starter_updates", () => featureStarterHook.applyUpdates()),
    );
    toolCount += 1;

    server.registerTool(
      "dbzs_run_feature_starter_install_all",
      {
        title: "DBZS Feature Starter Vollinstallation starten",
        description: "Schreiboperation: Delegiert nach confirm: true an den vorhandenen DBZS Feature Starter Installer-CLI-Vertrag. Zusätzlich muss DBZS_FEATURE_STARTER_ALLOW_HOOKS=true gesetzt sein.",
        inputSchema: z.object({ confirm: z.literal(true) }),
        annotations: buildAnnotations(true),
      },
      async () => executeTool(eventBus, "dbzs_run_feature_starter_install_all", () => featureStarterHook.installAll()),
    );
    toolCount += 1;
  }

  return toolCount;
}
