import { Service } from "node-windows";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const svc = new Service({
  name: "DBZS.GiteaMCP",
  description:
    "DBZS Gitea MCP Server (Loopback-HTTP-Transport, ausschliesslich 127.0.0.1)",
  script: path.join(appRoot, "dist", "index.js"),
  env: [{ name: "MCP_TRANSPORT", value: "http" }],
});

svc.on("install", () => {
  console.log("DBZS.GiteaMCP installiert. Starte Dienst...");
  svc.start();
});

svc.on("alreadyinstalled", () => {
  console.log("DBZS.GiteaMCP ist bereits installiert.");
});

svc.on("start", () => {
  console.log("DBZS.GiteaMCP gestartet.");
});

svc.on("error", (err) => {
  console.error("Fehler bei der Dienstinstallation:", err);
  process.exitCode = 1;
});

console.log(
  "Hinweis: DBZS_HOME_API_TOKEN, GITEA_BASE_URL und GITEA_ALLOWED_OWNER muessen als " +
    "Systemumgebungsvariablen gesetzt sein, bevor der Dienst startet. Der Installer setzt " +
    "ausschliesslich nicht-geheime Werte (GITEA_BASE_URL, GITEA_ALLOWED_OWNER); das Token wird " +
    "niemals automatisch gesetzt oder in einer Datei abgelegt.",
);

svc.install();
