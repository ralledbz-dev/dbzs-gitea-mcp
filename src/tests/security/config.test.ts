/**
 * DBZS — Division By Zeros
 * Datei: tests/security/config.test.ts
 * Zweck: Token-Priorität, Transport, Owner-Allowlist und lokale Webhook-Konfiguration absichern.
 * Version: 0.4.0
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DbzsError } from "../../core/errors.js";
import { loadServerConfiguration } from "../../security/config.js";

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

test("Konfiguration lehnt fehlendes Token ab", () => {
  assert.throws(
    () => loadServerConfiguration({
      GITEA_BASE_URL: "http://127.0.0.1:3000",
      GITEA_ALLOWED_OWNER: "devdbzemusic",
    }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
});

test("HTTP-Transport und Port werden validiert; stdio bleibt Standard", () => {
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
    () => loadServerConfiguration({
      DBZS_HOME_API_TOKEN: "dbzs-token",
      GITEA_BASE_URL: "http://127.0.0.1:3000",
      GITEA_ALLOWED_OWNER: "devdbzemusic",
      MCP_TRANSPORT: "http",
      MCP_HTTP_PORT: "70000",
    }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
});

test("Lokale Webhooks erfordern Secret und Zieladresse als gültiges Paar", () => {
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
  });

  assert.equal(configuration.webhookTargetUrl, "http://127.0.0.1:4949/webhooks/gitea");
  assert.throws(
    () => loadServerConfiguration({ ...base, GITEA_WEBHOOK_SECRET: "12345678901234567890123456789012" }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
  assert.throws(
    () => loadServerConfiguration({
      ...base,
      GITEA_WEBHOOK_TARGET_URL: "https://attacker.invalid/webhooks/gitea",
      GITEA_WEBHOOK_SECRET: "12345678901234567890123456789012",
    }),
    (error: unknown) => error instanceof DbzsError && error.code === "CONFIGURATION_ERROR",
  );
});

test("Workspace-Konfiguration bleibt standardmäßig deaktiviert",()=>{const base={DBZS_HOME_API_TOKEN:"token",GITEA_BASE_URL:"http://127.0.0.1:3000",GITEA_ALLOWED_OWNER:"owner"};const disabled=loadServerConfiguration(base);const enabled=loadServerConfiguration({...base,DBZS_WORKSPACE_ROOT:"D:\\Dev\\DBZS",DBZS_PROCESS_ALLOWLIST:"git,node"});assert.equal(disabled.workspaceRoot,undefined);assert.equal(enabled.workspaceRoot,"D:\\Dev\\DBZS");assert.deepEqual(enabled.processAllowlist,["git","node"]);});
