/**
 * DBZS — Division By Zeros
 * Datei: integrations/feature-starter-hook.ts
 * Zweck: Bestehende DBZS Feature Starter Update- und Installer-CLI-Hooks mit expliziter Freigabe und EventBus-Observability orchestrieren.
 * Version: 0.3.0
 */

import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import { isAbsolute, win32 } from "node:path";
import { DbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";

/**
 * Beschreibt die kompakte Statusantwort des bestehenden Feature-Starter-Update-CLI-Vertrags.
 */
export interface FeatureStarterUpdateStatus {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly installed: boolean;
  readonly updateAvailable: boolean;
  readonly commitsBehind: number;
  readonly localCommit?: string | null;
  readonly remoteCommit?: string | null;
  readonly checkedAt: string;
  readonly error?: string | null;
}

/**
 * Beschreibt ein kontrollierbares Ergebnis eines Feature-Starter-Hook-Prozesses.
 */
export interface FeatureStarterHookResult {
  readonly command: "check-updates" | "apply-updates" | "install-all";
  readonly exitCode: number;
  readonly statuses?: FeatureStarterUpdateStatus[];
  readonly output: string;
}

/**
 * Beschreibt die Sicherheits- und Prozessabhängigkeiten des Feature-Starter-Hook-Adapters.
 */
export interface FeatureStarterHookOptions {
  /** Ausdrücklich konfigurierter Pfad zur kanonischen DBZS.FeatureStarter.exe. */
  readonly executablePath: string;
  /** Der Prozessstart ist erst bei true zulässig. */
  readonly allowHooks: boolean;
  /** Zentraler DBZS-EventBus. */
  readonly eventBus: DbzsEventBus;
  /** Testbarer, shellfreier Spawn-Adapter. */
  readonly spawnFunction?: typeof spawn;
  /** Obergrenze für gemeinsam gepuffertes stdout und stderr. */
  readonly maxOutputBytes?: number;
}

/**
 * Prüft einen kanonischen Windows-Pfad zur DBZS Feature Starter Executable.
 *
 * Was: Akzeptiert ausschließlich absolute Pfade mit exakt dem erwarteten Dateinamen.
 * Warum: Ein MCP-Tool darf nicht durch Konfiguration zu einem allgemeinen lokalen Prozessstarter werden.
 * Wofür: Für DBZS Feature Starter Update- und Installer-Hooks.
 * Woher: Aus DBZS_FEATURE_STARTER_EXECUTABLE des lokalen Dienstprozesses.
 * Wo: Beim Aufbau des Hook-Adapters.
 * Soll-Ergebnis: Expliziter, enger Zielprozess oder ein sichtbarer Konfigurationsfehler.
 *
 * @param value Konfigurierter Executable-Pfad.
 * @returns Getrimmter, geprüfter Executable-Pfad.
 * @throws {DbzsError} Bei nicht absolutem Pfad oder falschem Programmnamen.
 */
export function normalizeFeatureStarterExecutablePath(value: string): string {
  const trimmed = value.trim();
  const absolute = isAbsolute(trimmed) || win32.isAbsolute(trimmed);
  if (!absolute || win32.basename(trimmed).toLowerCase() !== "dbzs.featurestarter.exe") {
    throw new DbzsError(
      "CONFIGURATION_ERROR",
      "DBZS_FEATURE_STARTER_EXECUTABLE muss auf eine absolute DBZS.FeatureStarter.exe zeigen.",
    );
  }
  return trimmed;
}

/**
 * Orchestriert die vorhandenen Feature Starter CLI-Einstiegspunkte ohne eigene Update- oder Installerlogik.
 *
 * Was: Startet nur die kanonischen `--check-updates`, `--apply-updates` und `--install-all --installer`-Verträge.
 * Warum: Feature Starter besitzt bereits Dirty-Worktree-Schutz, Verifikation, Rollback, Installerreihenfolge und Historie.
 * Wofür: Für explizit bestätigte MCP-Update- und Installer-Hooks in Phase 3.
 * Woher: Aus DBZS Feature Starter Program, UpdateCliRunner und InstallerCliRunner.
 * Wo: Zwischen MCP-Orchestrierung und dem vorhandenen Windows Lifecycle Controller.
 * Soll-Ergebnis: Beobachtbare Prozessdelegation ohne frei formbare Kommandos oder parallele Installationslogik.
 */
export class FeatureStarterHook {
  private readonly executablePath: string;
  private readonly spawnFunction: typeof spawn;
  private readonly maxOutputBytes: number;

  /**
   * Erstellt den kontrollierten Hook-Adapter.
   *
   * @param options Sicherheitskonfiguration und Prozessabhängigkeiten.
   */
  public constructor(private readonly options: FeatureStarterHookOptions) {
    this.executablePath = normalizeFeatureStarterExecutablePath(options.executablePath);
    this.spawnFunction = options.spawnFunction ?? spawn;
    this.maxOutputBytes = options.maxOutputBytes ?? 262_144;
  }

  /**
   * Fragt den vorhandenen Feature Starter nach Update-Status ab, ohne Änderungen auszulösen.
   *
   * @returns Versionierte Update-Statusliste des Feature Starters.
   */
  public async checkUpdates(): Promise<FeatureStarterHookResult> {
    return this.execute("check-updates", ["--check-updates", "--non-interactive"]);
  }

  /**
   * Delegiert explizit bestätigte Repository-Updates an den bestehenden Feature Starter.
   *
   * @returns Ergebnis der transaktionalen Update-Ausführung.
   */
  public async applyUpdates(): Promise<FeatureStarterHookResult> {
    this.assertHooksAllowed("apply-updates");
    return this.execute("apply-updates", ["--apply-updates", "--non-interactive"]);
  }

  /**
   * Delegiert explizit bestätigte Vollinstallation an den bestehenden Feature Starter Installer-CLI-Vertrag.
   *
   * @returns Ergebnis der vorhandenen Installer-Ausführung.
   */
  public async installAll(): Promise<FeatureStarterHookResult> {
    this.assertHooksAllowed("install-all");
    return this.execute("install-all", ["--install-all", "--installer"]);
  }

  /**
   * Prüft, ob mutierende Hooks explizit im lokalen Dienstprozess zugelassen wurden.
   *
   * Was: Fordert eine getrennte, positive Prozesskonfiguration vor Update oder Installation.
   * Warum: `confirm: true` im MCP-Aufruf allein soll keinen lokal konfigurationslosen Lifecycle-Eingriff ermöglichen.
   * Wofür: Für apply-updates und install-all.
   * Woher: Aus DBZS_FEATURE_STARTER_ALLOW_HOOKS.
   * Wo: Vor dem Spawn mutierender Feature-Starter-CLI-Aufrufe.
   * Soll-Ergebnis: Fail-closed bei nicht aktivierten Hooks.
   *
   * @param command Angeforderter mutierender Hook.
   * @throws {DbzsError} Wenn Hooks nicht erlaubt sind.
   */
  private assertHooksAllowed(command: "apply-updates" | "install-all"): void {
    if (!this.options.allowHooks) {
      this.options.eventBus.publish("featureStarter.hook.rejected", "warn", { command, reason: "hooks_not_enabled" });
      throw new DbzsError(
        "POLICY_VIOLATION",
        "Mutierende DBZS Feature Starter Hooks sind lokal nicht freigegeben. DBZS_FEATURE_STARTER_ALLOW_HOOKS muss ausdrücklich true sein.",
      );
    }
  }

  /**
   * Startet einen festen Feature-Starter-CLI-Vertrag shellfrei und begrenzt seine Ausgabe.
   *
   * Was: Erzeugt einen Prozess ohne Shell, sammelt stdout/stderr, publiziert Start/Ende und parst Update-JSON.
   * Warum: Es sind keine frei formbaren Kommandos, Umgebungsvariablen oder Argumente zulässig.
   * Wofür: Für die drei öffentlichen Hook-Methoden.
   * Woher: Aus der konfigurierten DBZS.FeatureStarter.exe und fest kodierten Argumentlisten.
   * Wo: Im lokalen Update-/Installer-Integrationsadapter.
   * Soll-Ergebnis: Deterministisches Prozessresultat oder sichtbarer DBZS-Fehler bei Spawn-, Größen- oder Exit-Code-Fehlern.
   *
   * @param command Semantische Hook-Bezeichnung.
   * @param arguments Fest kodierte CLI-Argumente.
   * @returns Kontrolliertes Hook-Ergebnis.
   */
  private async execute(
    command: "check-updates" | "apply-updates" | "install-all",
    cliArguments: readonly string[],
  ): Promise<FeatureStarterHookResult> {
    this.options.eventBus.publish("featureStarter.hook.started", "info", { command, executable: this.executablePath });
    const processOptions: SpawnOptionsWithoutStdio = { shell: false, windowsHide: true };

    const result = await new Promise<{ exitCode: number; output: string }>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = this.spawnFunction(this.executablePath, [...cliArguments], processOptions);
      } catch (error) {
        reject(error);
        return;
      }

      const outputChunks: Buffer[] = [];
      let outputSize = 0;
      let outputLimitExceeded = false;
      const append = (chunk: Buffer | string): void => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputSize += buffer.length;
        if (outputSize <= this.maxOutputBytes) {
          outputChunks.push(buffer);
        } else {
          outputLimitExceeded = true;
        }
      };

      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", reject);
      child.once("close", (exitCode) => {
        if (outputLimitExceeded) {
          reject(new DbzsError("GITEA_PROTOCOL_ERROR", "Der DBZS Feature Starter Hook hat die erlaubte Ausgabemenge überschritten.", { command }));
          return;
        }
        resolve({ exitCode: exitCode ?? 1, output: Buffer.concat(outputChunks).toString("utf8").trim() });
      });
    }).catch((error: unknown): never => {
      const reason = error instanceof Error ? error.message : "Unbekannter Prozessfehler";
      this.options.eventBus.publish("featureStarter.hook.failed", "error", { command, reason });
      if (error instanceof DbzsError) {
        throw error;
      }
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Der DBZS Feature Starter Hook konnte nicht gestartet werden.", { command, reason });
    });

    const statuses = command === "install-all" ? undefined : this.parseUpdateStatuses(result.output, command);
    const level = result.exitCode === 0 ? "info" : "error";
    this.options.eventBus.publish("featureStarter.hook.completed", level, {
      command,
      exitCode: result.exitCode,
      statusCount: statuses?.length,
    });
    if (result.exitCode !== 0) {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", `Der DBZS Feature Starter Hook '${command}' wurde mit Exit-Code ${result.exitCode} beendet.`, {
        command,
        exitCode: result.exitCode,
        output: result.output.slice(0, 2_000),
      });
    }

    return { command, exitCode: result.exitCode, statuses, output: result.output.slice(0, 2_000) };
  }

  /**
   * Parst die stabil dokumentierte JSON-Updateantwort des Feature Starters.
   *
   * Was: Liest ausschließlich ein JSON-Array mit den erwarteten Status-Kernfeldern.
   * Warum: Hook-Ausgabe darf nicht unstrukturiert als vertrauenswürdiger MCP-Status erscheinen.
   * Wofür: Für check-updates und apply-updates.
   * Woher: Aus dem ergänzten Feature-Starter-UpdateCliRunner-Vertrag.
   * Wo: Nach erfolgreichem Hook-Prozessabschluss.
   * Soll-Ergebnis: Validierte Statusliste oder sichtbarer Protokollfehler.
   *
   * @param output Begrenzte stdout/stderr-Gesamtausgabe des Hooks.
   * @param command Aktueller Update-Hook.
   * @returns Validierte Update-Statusliste.
   */
  private parseUpdateStatuses(output: string, command: "check-updates" | "apply-updates"): FeatureStarterUpdateStatus[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output) as unknown;
    } catch {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Der DBZS Feature Starter Update-Hook hat keine lesbare JSON-Statusantwort geliefert.", { command });
    }
    if (!Array.isArray(parsed)) {
      throw new DbzsError("GITEA_PROTOCOL_ERROR", "Der DBZS Feature Starter Update-Hook hat keine Statusliste geliefert.", { command });
    }

    return parsed.map((item, index) => {
      if (
        typeof item !== "object" ||
        item === null ||
        Array.isArray(item) ||
        typeof (item as Record<string, unknown>).serviceId !== "string" ||
        typeof (item as Record<string, unknown>).serviceName !== "string" ||
        typeof (item as Record<string, unknown>).installed !== "boolean" ||
        typeof (item as Record<string, unknown>).updateAvailable !== "boolean" ||
        typeof (item as Record<string, unknown>).commitsBehind !== "number" ||
        typeof (item as Record<string, unknown>).checkedAt !== "string"
      ) {
        throw new DbzsError("GITEA_PROTOCOL_ERROR", "Der DBZS Feature Starter Update-Hook enthält eine ungültige Statuszeile.", { command, index });
      }
      return item as FeatureStarterUpdateStatus;
    });
  }
}
