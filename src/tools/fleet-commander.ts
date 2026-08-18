/**
 * DBZS — Division By Zeros
 * Datei: tools/fleet-commander.ts
 * Zweck: Schreibgeschützte DBZS-Fleet-Commander-Tools registrieren, sofern konfiguriert.
 * Version: 0.4.0
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { FleetCommanderClient } from "../integrations/fleet-commander-client.js";
import { buildAnnotations, executeTool } from "./shared.js";

/**
 * Registriert die schreibgeschützten Fleet-Commander-Diagnose-Tools, sofern eine lokale Control Plane konfiguriert ist.
 *
 * @param server MCP-Server-Instanz.
 * @param eventBus Zentraler DBZS-EventBus.
 * @param fleetCommander Optionaler Read-Adapter der bestehenden lokalen Fleet Commander Control Plane.
 * @returns Anzahl der registrierten Tools.
 */
export function registerFleetCommanderTools(server: McpServer, eventBus: DbzsEventBus, fleetCommander?: FleetCommanderClient): number {
  if (!fleetCommander) {
    return 0;
  }

  const fleetTools: ReadonlyArray<readonly [string, string, () => Promise<unknown>]> = [
    ["dbzs_get_fleet_health", "Liest den versionierten Healthstatus der bestehenden lokalen DBZS Fleet Commander Control Plane.", () => fleetCommander.getHealth()],
    ["dbzs_get_fleet_dashboard", "Liest die durch Fleet Commander besessene Dashboard-Projektion ohne Runtime-Mutation.", () => fleetCommander.getDashboard()],
    ["dbzs_get_fleet_operating_status", "Liest Commissioning-, Production- und Maintenance-Status aus der bestehenden Fleet Control Plane.", () => fleetCommander.getOperatingStatus()],
    ["dbzs_list_fleet_services", "Liest die von Fleet Commander verwalteten Ready-Service-Projektionen ohne Operator-Aktion.", () => fleetCommander.getServices()],
    ["dbzs_list_fleet_events", "Liest jüngste Fleet-Commander-Ereignisse für lokale Diagnosezwecke.", () => fleetCommander.getEvents()],
  ];

  for (const [name, description, operation] of fleetTools) {
    server.registerTool(
      name,
      { title: name, description, inputSchema: z.object({}), annotations: buildAnnotations(false) },
      async () => executeTool(eventBus, name, operation),
    );
  }

  return fleetTools.length;
}
