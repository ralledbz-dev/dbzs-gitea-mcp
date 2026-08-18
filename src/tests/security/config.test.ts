/**
 * DBZS — Division By Zeros
 * Datei: tests/security/config.test.ts
 * Zweck: Deterministische Tests für die sicherheitsrelevante Runtime-Konfiguration (Token-Priorität, Transport,
 * Owner-Allowlist-Voraussetzungen, Webhook- und Feature-Starter-Hook-Freigaben) bereitstellen.
 * Version: 0.4.0
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DbzsError } from "../../core/errors.js";
import { loadServerConfiguration } from "../../security/config.js";

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
