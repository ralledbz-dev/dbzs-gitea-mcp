/**
 * DBZS — Division By Zeros
 * Datei: tests/tools/integrations.test.ts
 * Zweck: Den optionalen lokalen Fleet-Commander-Adapter validieren.
 * Version: 0.4.0
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DbzsError } from "../../core/errors.js";
import { DbzsEventBus } from "../../core/observability.js";
import { FleetCommanderClient, normalizeFleetCommanderBaseUrl } from "../../integrations/fleet-commander-client.js";

test("Fleet-Commander-Adapter verwendet den lokalen v1-Vertrag", async () => {
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
});
