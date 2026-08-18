import { Service } from "node-windows";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const svc = new Service({
  name: "DBZS.GiteaMCP",
  script: path.join(appRoot, "dist", "index.js"),
});

svc.on("uninstall", () => {
  console.log("DBZS.GiteaMCP wurde deinstalliert.");
});

svc.on("error", (err) => {
  console.error("Fehler bei der Dienst-Deinstallation:", err);
  process.exitCode = 1;
});

svc.uninstall();
