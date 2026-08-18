/**
 * DBZS — Division By Zeros
 * Datei: test/phase3.test.ts
 * Zweck: Release-, Registry-, Webhook- und DBZS-Integrationsverträge der Phase 3 ohne reale Secrets, Gitea- oder Fleet-Instanz validieren.
 * Version: 0.3.0
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadServerConfiguration } from "../core/config.js";
import { DbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { type FetchFunction, GiteaClient } from "../gitea/client.js";
import { LoopbackMcpHttpServer } from "../http/loopback-server.js";
import { FleetCommanderClient, normalizeFleetCommanderBaseUrl } from "../integrations/fleet-commander-client.js";
import { FeatureStarterHealthReader } from "../integrations/feature-starter-health-reader.js";
import { FeatureStarterHook, normalizeFeatureStarterExecutablePath } from "../integrations/feature-starter-hook.js";
import { GiteaWebhookReceiver } from "../webhooks/gitea-webhook-receiver.js";

/**
 * Erstellt einen policy-geschützten Testclient mit kontrolliertem Netzwerkadapter.
 *
 * @param fetchFunction Deterministischer Gitea-Request-Adapter.
 * @returns GiteaClient für Phase-3-Vertragstests.
 */
function createClient(fetchFunction: FetchFunction): GiteaClient {
  return new GiteaClient("http://gitea.local", "unit-test-token", "devdbzemusic", new DbzsEventBus(), fetchFunction);
}

/**
 * Prüft Phase-3-Konfigurationspaare und fail-closed Hook-Freigaben.
 */
test("Phase-3-Konfiguration erzwingt lokale Webhook-Paare und Feature-Starter-Hook-Freigaben", () => {
  const base = {
    DBZS_HOME_API_TOKEN: "dbzs-token",
    GITEA_BASE_URL: "http://127.0.0.1:3000",
    GITEA_ALLOWED_OWNER: "devdbzemusic",
    MCP_TRANSPORT: "http",
  };
  const configuration = loadServerConfiguration({
    ...base,
    GITEA_WEBHOOK_SECRET: "12345678901234567890123456789012",
    GITEA_WEBHOOK_TARGET_URL: "http://127.0.0.1:4949/webhooks/gitea",
    DBZS_FEATURE_STARTER_EXECUTABLE: "C:\\Program Files\\DBZS\\DBZS.FeatureStarter.exe",
    DBZS_FEATURE_STARTER_ALLOW_HOOKS: "true",
  });
  assert.equal(configuration.webhookTargetUrl, "http://127.0.0.1:4949/webhooks/gitea");
  assert.equal(configuration.featureStarterAllowHooks, true);
  assert.throws(
    () => loadServerConfiguration({ ...base, GITEA_WEBHOOK_SECRET: "12345678901234567890123456789012" }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
  assert.throws(
    () => loadServerConfiguration({ ...base, GITEA_WEBHOOK_TARGET_URL: "https://attacker.invalid/webhooks/gitea", GITEA_WEBHOOK_SECRET: "12345678901234567890123456789012" }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
  assert.throws(
    () => loadServerConfiguration({ ...base, DBZS_FEATURE_STARTER_ALLOW_HOOKS: "true" }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
});

/**
 * Prüft Phase-3-Gitea-Endpunkte und die Entschärfung sensibler Hook-Felder.
 */
test("Phase-3-Gitea-Adapter verwendet Release-, Package- und Hook-Verträge ohne Secret-Rückgabe", async () => {
  const requests: Array<{ readonly url: string; readonly method: string; readonly body?: string }> = [];
  const client = createClient(async (input, init) => {
    const url = input.toString();
    requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    if (url.includes("/releases/4/assets")) {
      return new Response(JSON.stringify([{ id: 9, name: "DBZS.msi", size: 42 }]), { status: 200 });
    }
    if (url.includes("/releases")) {
      return new Response(JSON.stringify([{ id: 4, tag_name: "v0.3.0" }]), { status: 200 });
    }
    if (url.includes("/packages/")) {
      return new Response(JSON.stringify([{ id: 3, name: "dbzs", type: "npm", version: "0.3.0" }]), { status: 200 });
    }
    if (init?.method === "DELETE" && url.includes("/hooks/7")) {
      return new Response(null, { status: 204 });
    }
    if (init?.method === "POST" && url.includes("/hooks")) {
      return new Response(JSON.stringify({ id: 7, type: "gitea", config: { url: "http://127.0.0.1:4949/webhooks/gitea", secret: "never-return" } }), { status: 201 });
    }
    if (url.includes("/hooks")) {
      return new Response(JSON.stringify([{ id: 7, type: "gitea", config: { url: "http://127.0.0.1:4949/webhooks/gitea", secret: "never-return", authorization_header: "hidden" } }]), { status: 200 });
    }
    return new Response(null, { status: 204 });
  });

  assert.equal((await client.listReleases("devdbzemusic", "dbzs-gitea-mcp", 1, 20, false, true))[0]?.tag_name, "v0.3.0");
  assert.equal((await client.listReleaseAssets("devdbzemusic", "dbzs-gitea-mcp", 4))[0]?.name, "DBZS.msi");
  assert.equal((await client.listPackages("devdbzemusic", 1, 20, "npm", "dbzs"))[0]?.version, "0.3.0");
  assert.equal((await client.listPackageVersions("devdbzemusic", "npm", "dbzs", 1, 20))[0]?.name, "dbzs");
  const hooks = await client.listWebhooks("devdbzemusic", "dbzs-gitea-mcp", 1, 20);
  assert.equal(hooks[0]?.config?.secret, undefined);
  assert.equal(hooks[0]?.config?.authorization_header, undefined);
  const created = await client.createLocalWebhook("devdbzemusic", "dbzs-gitea-mcp", {
    targetUrl: "http://127.0.0.1:4949/webhooks/gitea",
    secret: "12345678901234567890123456789012",
    events: ["push"],
  });
  assert.equal(created.config?.secret, undefined);
  await client.deleteWebhook("devdbzemusic", "dbzs-gitea-mcp", 7);

  assert.ok(requests.some((request) => request.url.includes("/releases?page=1&limit=20&draft=false&pre-release=true")));
  assert.ok(requests.some((request) => request.url.includes("/packages/devdbzemusic?page=1&limit=20&type=npm&q=dbzs")));
  assert.ok(requests.some((request) => request.method === "POST" && request.body?.includes("never-return") === false && request.body?.includes("content_type")));
  assert.ok(requests.some((request) => request.method === "DELETE" && request.url.endsWith("/hooks/7")));
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
