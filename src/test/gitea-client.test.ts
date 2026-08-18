/**
 * DBZS — Division By Zeros
 * Datei: test/gitea-client.test.ts
 * Zweck: Deterministische Tests für Konfiguration, Owner-Policy und Gitea-Request-Verhalten bereitstellen.
 * Version: 0.2.0
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadServerConfiguration } from "../core/config.js";
import { DbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { FetchFunction, GiteaClient } from "../gitea/client.js";

/**
 * Erstellt einen Gitea-Client mit testbarem Fetch-Adapter.
 *
 * Was: Zentralisiert die wiederkehrende Testkonfiguration.
 * Warum: Jeder Test soll nur sein spezifisches Verhalten beschreiben.
 * Wofür: Für alle GiteaClient-Unit-Tests.
 * Woher: Aus den Testdaten dieser Datei.
 * Wo: Innerhalb des Testmoduls.
 * Soll-Ergebnis: Ein Client mit festem Owner und vollständig kontrollierbarem Netzwerkadapter.
 *
 * @param fetchFunction Deterministische Fake-Implementierung von fetch.
 * @returns Konfigurierter Gitea-Client.
 */
function createClient(fetchFunction: FetchFunction): GiteaClient {
  return new GiteaClient("http://gitea.local", "unit-test-token", "devdbzemusic", new DbzsEventBus(), fetchFunction);
}

/**
 * Prüft die Priorität des DBZS-Tokens gegenüber dem Legacy-Fallback.
 */
test("Konfiguration priorisiert DBZS_HOME_API_TOKEN", () => {
  const configuration = loadServerConfiguration({
    DBZS_HOME_API_TOKEN: "dbzs-token",
    GITEA_TOKEN: "legacy-token",
    GITEA_BASE_URL: "http://127.0.0.1:3000/",
    GITEA_ALLOWED_OWNER: "devdbzemusic",
  });

  assert.equal(configuration.giteaToken, "dbzs-token");
  assert.equal(configuration.tokenSource, "DBZS_HOME_API_TOKEN");
  assert.equal(configuration.giteaBaseUrl, "http://127.0.0.1:3000");
});

/**
 * Prüft die Ablehnung einer Konfiguration ohne Token.
 */
test("Konfiguration lehnt fehlendes Token ab", () => {
  assert.throws(
    () =>
      loadServerConfiguration({
        GITEA_BASE_URL: "http://127.0.0.1:3000",
        GITEA_ALLOWED_OWNER: "devdbzemusic",
      }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
});

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
