/**
 * DBZS — Division By Zeros
 * Datei: tests/tools/gitea-client.test.ts
 * Zweck: Deterministische Tests für Owner-Policy, Endpunktkontrakte und Log-Trunkierung des Gitea-REST-Clients
 * bereitstellen, der alle `tools/*`-Registrierungen mit Gitea-Daten versorgt.
 * Version: 0.4.0
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DbzsError } from "../../core/errors.js";
import { DbzsEventBus } from "../../core/observability.js";
import { FetchFunction, GiteaClient } from "../../gitea/client.js";

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
 * Prüft die Owner-Filterung für die globale Repositoryliste.
 */
test("Repositoryliste wird auf den freigegebenen Owner gefiltert", async () => {
  const client = createClient(async () =>
    new Response(
      JSON.stringify([
        { id: 1, name: "freigegeben", full_name: "devdbzemusic/freigegeben", owner: { login: "devdbzemusic" } },
        { id: 2, name: "fremd", full_name: "other/fremd", owner: { login: "other" } },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  const repositories = await client.listRepositories(30);
  assert.deepEqual(repositories.map((repository) => repository.full_name), ["devdbzemusic/freigegeben"]);
});

/**
 * Prüft, dass ein abgewiesener Owner keine Netzwerkanfrage auslösen kann.
 */
test("Fremder Owner wird vor dem Netzwerkaufruf abgewiesen", async () => {
  let fetchWasCalled = false;
  const client = createClient(async () => {
    fetchWasCalled = true;
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  await assert.rejects(
    () => client.getRepository("other", "repository"),
    (error: unknown) => error instanceof DbzsError && error.code === "POLICY_VIOLATION",
  );
  assert.equal(fetchWasCalled, false);
});

/**
 * Prüft Pfad, Header und Nutzlast des Dispatch-Aufrufs.
 */
test("Workflow-Dispatch verwendet Run-Details, Token-Header und JSON-Nutzlast", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const client = createClient(async (input, init) => {
    capturedUrl = input.toString();
    capturedInit = init;
    return new Response(
      JSON.stringify({ workflow_run_id: 42, run_url: "http://gitea.local/api/v1/runs/42" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const result = await client.dispatchWorkflow(
    "devdbzemusic",
    "dbzs-gitea-mcp",
    "build.yml",
    "refs/heads/main",
    { target: "windows" },
  );

  assert.equal(result.workflow_run_id, 42);
  assert.equal(
    capturedUrl,
    "http://gitea.local/api/v1/repos/devdbzemusic/dbzs-gitea-mcp/actions/workflows/build.yml/dispatches?return_run_details=true",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "token unit-test-token");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    ref: "refs/heads/main",
    inputs: { target: "windows" },
  });
});

/**
 * Prüft Pfad und Methode des Workflow-Reruns.
 */
test("Workflow-Rerun verwendet den vollständigen Rerun-Endpunkt", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  const client = createClient(async (input, init) => {
    capturedUrl = input.toString();
    capturedMethod = init?.method ?? "";
    return new Response(JSON.stringify({ id: 77, status: "queued" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });

  const result = await client.rerunWorkflow("devdbzemusic", "dbzs-gitea-mcp", 77);
  assert.equal(result.id, 77);
  assert.equal(
    capturedUrl,
    "http://gitea.local/api/v1/repos/devdbzemusic/dbzs-gitea-mcp/actions/runs/77/rerun",
  );
  assert.equal(capturedMethod, "POST");
});

/**
 * Prüft alle Phase-2-Gitea-Read-Endpunkte, deren sichere Query-Zusammensetzung und die lokale Log-Trunkierung.
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
