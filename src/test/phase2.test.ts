/**
 * DBZS — Division By Zeros
 * Datei: test/phase2.test.ts
 * Zweck: Phase-2-Konfiguration, Gitea-Read-Adapter und lokalen MCP-HTTP-Transport deterministisch validieren.
 * Version: 0.3.0
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadServerConfiguration } from "../core/config.js";
import { DbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { type FetchFunction, GiteaClient } from "../gitea/client.js";
import { LoopbackMcpHttpServer } from "../http/loopback-server.js";

/**
 * Erstellt einen Gitea-Client mit einem vollständig kontrollierten Request-Adapter für Vertragsprüfungen.
 *
 * Was: Zentralisiert Token, Owner-Policy und EventBus für Phase-2-Clienttests.
 * Warum: Jeder Test soll nur seinen erwarteten Gitea-Endpunkt und seine Datenform beschreiben.
 * Wofür: Für Read-Operationen ohne Abhängigkeit von einer realen Gitea-Instanz.
 * Woher: Aus dem vorhandenen testbaren GiteaClient-Konstruktor.
 * Wo: Innerhalb dieses Testmoduls.
 * Soll-Ergebnis: Reproduzierbare Adaptertests ohne Geheimnisse oder externen Netzwerkzugriff.
 *
 * @param fetchFunction Deterministischer Request-Adapter.
 * @returns Policy-geschützter GiteaClient für Tests.
 */
function createClient(fetchFunction: FetchFunction): GiteaClient {
  return new GiteaClient("http://gitea.local", "unit-test-token", "devdbzemusic", new DbzsEventBus(), fetchFunction);
}

/**
 * Prüft die sichere Phase-2-HTTP-Konfigurationsauflösung und den stdio-Standard.
 */
test("Phase-2-Konfiguration validiert HTTP-Transport und Port", () => {
  const httpConfiguration = loadServerConfiguration({
    DBZS_HOME_API_TOKEN: "dbzs-token",
    GITEA_BASE_URL: "http://127.0.0.1:3000",
    GITEA_ALLOWED_OWNER: "devdbzemusic",
    MCP_TRANSPORT: "http",
    MCP_HTTP_PORT: "4949",
  });
  const stdioConfiguration = loadServerConfiguration({
    DBZS_HOME_API_TOKEN: "dbzs-token",
    GITEA_BASE_URL: "http://127.0.0.1:3000",
    GITEA_ALLOWED_OWNER: "devdbzemusic",
  });

  assert.equal(httpConfiguration.transport, "http");
  assert.equal(httpConfiguration.httpPort, 4949);
  assert.equal(stdioConfiguration.transport, "stdio");
  assert.equal(stdioConfiguration.httpPort, 3939);
  assert.throws(
    () =>
      loadServerConfiguration({
        DBZS_HOME_API_TOKEN: "dbzs-token",
        GITEA_BASE_URL: "http://127.0.0.1:3000",
        GITEA_ALLOWED_OWNER: "devdbzemusic",
        MCP_TRANSPORT: "http",
        MCP_HTTP_PORT: "70000",
      }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
});

/**
 * Prüft alle neuen Gitea-Read-Endpunkte, deren sichere Query-Zusammensetzung und die lokale Log-Trunkierung.
 */
test("Phase-2-Gitea-Read-Operationen verwenden erwartete Endpunkte und begrenzen Logs", async () => {
  const requests: Array<{ readonly url: string; readonly accept: string }> = [];
  const client = createClient(async (input, init) => {
    const url = input.toString();
    requests.push({ url, accept: String((init?.headers as Record<string, string>).Accept) });

    if (url.endsWith("/logs")) {
      return new Response("0123456789", { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    if (url.includes("/jobs")) {
      return new Response(JSON.stringify({ jobs: [{ id: 81, status: "success" }] }), { status: 200 });
    }

    if (url.includes("/runners/7")) {
      return new Response(JSON.stringify({ id: 7, status: "online" }), { status: 200 });
    }

    if (url.includes("/runners")) {
      return new Response(JSON.stringify({ runners: [{ id: 7, status: "online" }] }), { status: 200 });
    }

    if (url.includes("/artifacts/5")) {
      return new Response(JSON.stringify({ id: 5, name: "report.zip", expired: false }), { status: 200 });
    }

    if (url.includes("/artifacts")) {
      return new Response(JSON.stringify({ artifacts: [{ id: 5, name: "report.zip" }] }), { status: 200 });
    }

    if (url.includes("/branches/")) {
      return new Response(JSON.stringify({ name: "main", protected: true }), { status: 200 });
    }

    if (url.includes("/branches")) {
      return new Response(JSON.stringify([{ name: "main", protected: true }]), { status: 200 });
    }

    if (url.includes("/git/commits/")) {
      return new Response(JSON.stringify({ sha: "abc123" }), { status: 200 });
    }

    if (url.includes("/commits")) {
      return new Response(JSON.stringify([{ sha: "abc123" }]), { status: 200 });
    }

    if (url.includes("/pulls/12")) {
      return new Response(JSON.stringify({ id: 12, number: 12, title: "Phase 2", state: "open" }), { status: 200 });
    }

    if (url.includes("/pulls")) {
      return new Response(JSON.stringify([{ id: 12, number: 12, title: "Phase 2", state: "open" }]), { status: 200 });
    }

    if (url.includes("/issues/9")) {
      return new Response(JSON.stringify({ id: 9, number: 9, title: "Bug", state: "open" }), { status: 200 });
    }

    return new Response(JSON.stringify([{ id: 9, number: 9, title: "Bug", state: "open" }]), { status: 200 });
  });

  assert.equal((await client.listBranches("devdbzemusic", "dbzs-gitea-mcp", 2, 20))[0]?.name, "main");
  assert.equal((await client.getBranch("devdbzemusic", "dbzs-gitea-mcp", "main")).protected, true);
  assert.equal((await client.listCommits("devdbzemusic", "dbzs-gitea-mcp", 1, 10, "main", "src/index.ts"))[0]?.sha, "abc123");
  assert.equal((await client.getCommit("devdbzemusic", "dbzs-gitea-mcp", "abc123")).sha, "abc123");
  assert.equal((await client.listPullRequests("devdbzemusic", "dbzs-gitea-mcp", 1, 10, "open", "main"))[0]?.number, 12);
  assert.equal((await client.getPullRequest("devdbzemusic", "dbzs-gitea-mcp", 12)).title, "Phase 2");
  assert.equal((await client.listIssues("devdbzemusic", "dbzs-gitea-mcp", 1, 10, "open", "runner"))[0]?.number, 9);
  assert.equal((await client.getIssue("devdbzemusic", "dbzs-gitea-mcp", 9)).title, "Bug");
  assert.equal((await client.listWorkflowJobs("devdbzemusic", "dbzs-gitea-mcp", 42, 1, 10)).jobs?.[0]?.id, 81);
  assert.equal((await client.getWorkflowJobLog("devdbzemusic", "dbzs-gitea-mcp", 81, 5)).content, "01234");
  assert.equal((await client.getWorkflowJobLog("devdbzemusic", "dbzs-gitea-mcp", 81, 5)).truncated, true);
  assert.equal((await client.listRunners("devdbzemusic", "dbzs-gitea-mcp", 1, 10)).runners?.[0]?.id, 7);
  assert.equal((await client.getRunner("devdbzemusic", "dbzs-gitea-mcp", 7)).status, "online");
  assert.equal((await client.listArtifacts("devdbzemusic", "dbzs-gitea-mcp", 42, "report")).artifacts?.[0]?.id, 5);
  assert.equal((await client.getArtifact("devdbzemusic", "dbzs-gitea-mcp", 5)).name, "report.zip");

  assert.ok(requests.some((request) => request.url.endsWith("/branches?page=2&limit=20")));
  assert.ok(requests.some((request) => request.url.includes("/commits?page=1&limit=10&sha=main&path=src%2Findex.ts&stat=false&verification=true&files=false")));
  assert.ok(requests.some((request) => request.url.includes("/pulls?page=1&limit=10&state=open&base_branch=main")));
  assert.ok(requests.some((request) => request.url.includes("/issues?page=1&limit=10&state=open&q=runner&type=issues")));
  assert.ok(requests.some((request) => request.url.endsWith("/actions/runs/42/jobs?page=1&limit=10")));
  assert.ok(requests.some((request) => request.url.endsWith("/actions/runs/42/artifacts?name=report")));
  assert.ok(requests.some((request) => request.url.endsWith("/actions/jobs/81/logs") && request.accept.includes("text/plain")));
});

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
