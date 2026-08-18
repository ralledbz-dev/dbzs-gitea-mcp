/**
 * DBZS — Division By Zeros
 * Datei: tests/protocol/http-transport.test.ts
 * Zweck: Den lokalen HTTP-Transport (Routing, Loopback-/Origin-Guards, Webhook-HMAC-Verifikation,
 * Betriebsendpunkte /health /ready /version) sowie die Konsistenz von Toolanzahl und -Annotationen validieren.
 * Version: 0.4.0
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/server";
import { DbzsEventBus } from "../../core/observability.js";
import { type FetchFunction, GiteaClient } from "../../gitea/client.js";
import { SERVICE_VERSION } from "../../health/probe.js";
import { countConfiguredTools } from "../../server/mcp-server.js";
import { registerActionsTools } from "../../tools/actions.js";
import { registerArtifactAndReleaseTools } from "../../tools/artifacts-releases.js";
import { registerBranchAndCommitTools } from "../../tools/branches-commits.js";
import { registerFeatureStarterTools } from "../../tools/feature-starter.js";
import { registerFleetCommanderTools } from "../../tools/fleet-commander.js";
import { registerPackageTools } from "../../tools/packages.js";
import { registerPullRequestAndIssueTools } from "../../tools/pull-requests-issues.js";
import { registerRepositoryTools } from "../../tools/repositories.js";
import { registerWebhookTools } from "../../tools/webhooks.js";
import { LoopbackMcpHttpServer } from "../../transports/http.js";
import { GiteaWebhookReceiver } from "../../webhooks/gitea-webhook-receiver.js";
import { LocalWebhookService } from "../../webhooks/local-webhook-service.js";
import { FeatureStarterHealthReader } from "../../integrations/feature-starter-health-reader.js";
import { FeatureStarterHook } from "../../integrations/feature-starter-hook.js";
import { FleetCommanderClient } from "../../integrations/fleet-commander-client.js";

/**
 * Erstellt einen Gitea-Client mit testbarem Fetch-Adapter.
 *
 * @param fetchFunction Deterministische Fake-Implementierung von fetch.
 * @returns Konfigurierter Gitea-Client.
 */
function createClient(fetchFunction: FetchFunction): GiteaClient {
  return new GiteaClient("http://gitea.local", "unit-test-token", "devdbzemusic", new DbzsEventBus(), fetchFunction);
}

/**
 * Prüft die echte lokale HTTP-Grenze für Routing, Loopback-Bindung und fremde Origin-Header.
 */
test("Loopback-MCP-HTTP-Transport beschränkt Zugriff auf /mcp und weist fremde Origins ab", async () => {
  const eventBus = new DbzsEventBus();
  const client = createClient(async () => new Response(JSON.stringify([]), { status: 200 }));
  const server = new LoopbackMcpHttpServer({ port: 0, giteaClient: client, eventBus });

  await server.start();
  const endpoint = server.endpoint;
  assert.ok(endpoint);

  try {
    const missingRoute = await fetch(`${endpoint?.replace("/mcp", "")}/unbekannt`);
    assert.equal(missingRoute.status, 404);

    const crossOrigin = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await server.stop();
  }
});

/**
 * Prüft echte Loopback-HMAC-Verifikation, Owner-Policy und Delivery-Deduplizierung.
 */
test("Lokaler Gitea-Webhook akzeptiert nur signierte Owner-zugelassene Zustellungen einmalig", async () => {
  const eventBus = new DbzsEventBus();
  const secret = "12345678901234567890123456789012";
  const receiver = new GiteaWebhookReceiver({ secret, allowedOwner: "devdbzemusic", eventBus });
  const server = new LoopbackMcpHttpServer({
    port: 0,
    giteaClient: createClient(async () => new Response(JSON.stringify([]), { status: 200 })),
    eventBus,
    webhookReceiver: receiver,
  });
  await server.start();
  const endpoint = server.webhookEndpoint;
  assert.ok(endpoint);

  const payload = JSON.stringify({ action: "published", repository: { full_name: "devdbzemusic/dbzs-gitea-mcp", owner: { login: "devdbzemusic" } }, release: { tag_name: "v0.3.0" } });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    const accepted = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gitea-Signature": signature, "X-Gitea-Delivery": "delivery-1", "X-Gitea-Event": "release" },
      body: payload,
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { accepted: true, duplicate: false });

    const duplicate = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gitea-Signature": signature, "X-Gitea-Delivery": "delivery-1" },
      body: payload,
    });
    assert.equal(duplicate.status, 202);
    assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true });

    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gitea-Signature": "0".repeat(64), "X-Gitea-Delivery": "delivery-2" },
      body: payload,
    });
    assert.equal(invalid.status, 401);
  } finally {
    await server.stop();
  }
});

/**
 * Prüft die neuen Betriebsendpunkte /health, /ready und /version sowie deren Guard- und Methodenverhalten.
 */
test("/health, /ready und /version liefern konsistente Betriebsdaten unter denselben Loopback-Guards wie /mcp", async () => {
  const eventBus = new DbzsEventBus();
  const client = createClient(async () => new Response(JSON.stringify([]), { status: 200 }));
  const server = new LoopbackMcpHttpServer({ port: 0, giteaClient: client, eventBus });
  await server.start();
  const base = server.endpoint?.replace("/mcp", "");
  assert.ok(base);

  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { service: "dbzs-gitea-mcp", status: "healthy" });

    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 200);
    const readyBody = (await ready.json()) as { service: string; status: string; version: string; tools: number };
    assert.equal(readyBody.service, "dbzs-gitea-mcp");
    assert.equal(readyBody.status, "ready");
    assert.equal(readyBody.version, SERVICE_VERSION);
    assert.equal(readyBody.tools, countConfiguredTools());

    const version = await fetch(`${base}/version`);
    assert.equal(version.status, 200);
    assert.deepEqual(await version.json(), { service: "dbzs-gitea-mcp", version: SERVICE_VERSION });

    const wrongMethod = await fetch(`${base}/health`, { method: "POST" });
    assert.equal(wrongMethod.status, 405);

    const crossOriginHealth = await fetch(`${base}/health`, { headers: { Origin: "https://attacker.invalid" } });
    assert.equal(crossOriginHealth.status, 403);
  } finally {
    await server.stop();
  }
});

/**
 * Prüft, dass `countConfiguredTools` (verwendet von /ready, ohne Serverkonstruktion) für jede Phase-3-Kombination
 * exakt mit der Summe der tatsächlich von den `register*Tools`-Funktionen zurückgegebenen Toolanzahlen übereinstimmt.
 *
 * Warum dieser Test: `countConfiguredTools` pflegt eine eigene, feste Basiskonstante parallel zu den echten
 * Registrierungsfunktionen, damit /ready ohne wiederholte Serverkonstruktion bei häufigem externem Polling
 * auskommt (siehe server/mcp-server.ts). Dieser Test ist die einzige Absicherung gegen ein unbemerktes
 * Auseinanderlaufen beider Zahlen — genau die Art von Drift, die zuvor bei der MCP-Protokollversion auftrat.
 */
test("countConfiguredTools stimmt für jede Phase-3-Kombination mit der tatsächlichen Registrierung überein", () => {
  function actualCount(phase3: Parameters<typeof countConfiguredTools>[0]): number {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const eventBus = new DbzsEventBus();
    const giteaClient = createClient(async () => new Response("{}", { status: 200 }));

    let total = 0;
    total += registerRepositoryTools(server, giteaClient, eventBus);
    total += registerBranchAndCommitTools(server, giteaClient, eventBus);
    total += registerPullRequestAndIssueTools(server, giteaClient, eventBus);
    total += registerActionsTools(server, giteaClient, eventBus);
    total += registerArtifactAndReleaseTools(server, giteaClient, eventBus);
    total += registerPackageTools(server, giteaClient, eventBus);
    total += registerWebhookTools(server, giteaClient, eventBus, phase3?.localWebhook);
    total += registerFleetCommanderTools(server, eventBus, phase3?.fleetCommander);
    total += registerFeatureStarterTools(server, eventBus, phase3?.featureStarterHealth, phase3?.featureStarterHook);
    return total;
  }

  const giteaClient = createClient(async () => new Response("{}", { status: 200 }));
  const eventBus = new DbzsEventBus();
  const localWebhook = new LocalWebhookService({
    targetUrl: "http://127.0.0.1:3939/webhooks/gitea",
    secret: "1".repeat(32),
    giteaClient,
    eventBus,
  });
  const fleetCommander = new FleetCommanderClient({ baseUrl: "http://127.0.0.1:8110", eventBus });
  const featureStarterHealth = new FeatureStarterHealthReader({
    healthPath: "C:\\ProgramData\\DBZS\\CV5\\platform-health.json",
    eventBus,
  });
  const featureStarterHook = new FeatureStarterHook({
    executablePath: "C:\\Program Files\\DBZS\\DBZS.FeatureStarter.exe",
    allowHooks: false,
    eventBus,
  });

  const combinations: Array<Parameters<typeof countConfiguredTools>[0]> = [
    {},
    { localWebhook },
    { fleetCommander },
    { featureStarterHealth, featureStarterHook },
    { localWebhook, fleetCommander, featureStarterHealth, featureStarterHook },
  ];

  for (const combination of combinations) {
    assert.equal(countConfiguredTools(combination), actualCount(combination));
  }
});

/**
 * Prüft strukturell, dass jede Toolregistrierung in `src/tools/*.ts` `buildAnnotations` mit dem Wert
 * verwendet, der zur eigenen `confirm: z.literal(true)`-Konvention passt.
 *
 * Warum als Quelltextprüfung statt als Live-Protokolltest: Weder `@modelcontextprotocol/server` noch
 * `@modelcontextprotocol/node` (die einzigen installierten MCP-Pakete dieses Projekts) stellen eine
 * MCP-Client-Implementierung oder eine öffentliche Introspektion bereits registrierter Tools bereit —
 * `McpServer` hält seine Toolliste in einem privaten Feld. Ein echter `tools/list`-Rundlauf würde eine
 * zusätzliche Abhängigkeit oder Zugriff auf SDK-Interna erfordern. Diese Quelltextprüfung erzwingt dieselbe
 * Invariante ohne beides und schlägt fehl, sobald ein neues Tool ohne passende Annotation hinzukommt.
 */
test("Jede Toolregistrierung verwendet buildAnnotations passend zur eigenen confirm-Konvention", () => {
  const toolsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "tools");
  const toolFiles = ["repositories.ts", "branches-commits.ts", "pull-requests-issues.ts", "actions.ts", "artifacts-releases.ts", "packages.ts", "webhooks.ts", "fleet-commander.ts", "feature-starter.ts"];

  for (const fileName of toolFiles) {
    const source = readFileSync(join(toolsDirectory, fileName), "utf8");
    const registerToolBlocks = source.split("server.registerTool(").slice(1);

    for (const block of registerToolBlocks) {
      const requiresConfirm = /confirm:\s*z\.literal\(true\)/.test(block);
      const expectedAnnotation = requiresConfirm ? "buildAnnotations(true)" : "buildAnnotations(false)";
      const forbiddenAnnotation = requiresConfirm ? "buildAnnotations(false)" : "buildAnnotations(true)";
      const toolNameMatch = /^\s*"([^"]+)"/.exec(block);
      const toolName = toolNameMatch ? toolNameMatch[1] : `${fileName}:unbekannt`;

      assert.ok(
        block.includes(expectedAnnotation),
        `${toolName} in ${fileName} sollte ${expectedAnnotation} verwenden (confirm-Pflicht: ${requiresConfirm}).`,
      );
      assert.ok(
        !block.includes(forbiddenAnnotation),
        `${toolName} in ${fileName} sollte NICHT ${forbiddenAnnotation} verwenden (confirm-Pflicht: ${requiresConfirm}).`,
      );
    }
  }
});
