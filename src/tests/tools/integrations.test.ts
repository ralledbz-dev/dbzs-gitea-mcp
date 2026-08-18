/**
 * DBZS — Division By Zeros
 * Datei: tests/tools/integrations.test.ts
 * Zweck: Die bestehenden lokalen Fleet-Commander- und Feature-Starter-Adapter validieren, die
 * `tools/fleet-commander.ts` und `tools/feature-starter.ts` mit Daten versorgen.
 * Version: 0.4.0
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DbzsError } from "../../core/errors.js";
import { DbzsEventBus } from "../../core/observability.js";
import { FeatureStarterHealthReader } from "../../integrations/feature-starter-health-reader.js";
import { FeatureStarterHook, normalizeFeatureStarterExecutablePath } from "../../integrations/feature-starter-hook.js";
import { FleetCommanderClient, normalizeFleetCommanderBaseUrl } from "../../integrations/fleet-commander-client.js";

/**
 * Prüft die bestehenden lokalen Fleet- und Feature-Starter-Read-Verträge sowie fail-closed Hookpfade.
 */
test("DBZS-Integrationsadapter verwenden ausschließlich lokale Verträge und verweigern unfreigegebene Mutationen", async () => {
  assert.equal(normalizeFleetCommanderBaseUrl("http://127.0.0.1:8110/"), "http://127.0.0.1:8110");
  assert.throws(() => normalizeFleetCommanderBaseUrl("https://fleet.example.invalid"), DbzsError);
  const fleet = new FleetCommanderClient({
    baseUrl: "http://127.0.0.1:8110",
    eventBus: new DbzsEventBus(),
    fetchFunction: async (input, init) => {
      assert.equal(input.toString(), "http://127.0.0.1:8110/v1/health");
      assert.equal((init?.headers as Record<string, string>)["X-DBZS-Fleet-API"], "v1");
      return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
    },
  });
  assert.equal((await fleet.getHealth()).status, "ready");

  const directory = await mkdtemp(join(tmpdir(), "dbzs-feature-starter-"));
  const healthPath = join(directory, "platform-health.json");
  await writeFile(healthPath, JSON.stringify({ schemaVersion: 1, generatedAt: "2026-08-18T00:00:00.000Z", overallState: "READY", readyComponents: 2, enabledComponents: 2, components: [{ id: "fleet-commander" }] }));
  const health = await new FeatureStarterHealthReader({ healthPath, eventBus: new DbzsEventBus() }).readHealth();
  assert.equal(health.overallState, "READY");

  assert.equal(normalizeFeatureStarterExecutablePath("C:\\Program Files\\DBZS\\DBZS.FeatureStarter.exe"), "C:\\Program Files\\DBZS\\DBZS.FeatureStarter.exe");
  assert.throws(() => normalizeFeatureStarterExecutablePath("C:\\Windows\\System32\\cmd.exe"), DbzsError);
  const hook = new FeatureStarterHook({
    executablePath: "C:\\Program Files\\DBZS\\DBZS.FeatureStarter.exe",
    allowHooks: false,
    eventBus: new DbzsEventBus(),
  });
  await assert.rejects(() => hook.applyUpdates(), (error: unknown) => error instanceof DbzsError && error.code === "POLICY_VIOLATION");
  await assert.rejects(() => hook.installAll(), (error: unknown) => error instanceof DbzsError && error.code === "POLICY_VIOLATION");
});
