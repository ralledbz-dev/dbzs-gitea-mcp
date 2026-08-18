/**
 * DBZS — Division By Zeros
 * Datei: webhooks/local-webhook-service.ts
 * Zweck: Die sichere Registrierung und Entfernung von Gitea-Webhooks für den exakt konfigurierten lokalen DBZS-Receiver orchestrieren.
 * Version: 0.3.0
 */

import { DbzsError } from "../core/errors.js";
import { DbzsEventBus } from "../core/observability.js";
import { type GiteaWebhook, GiteaClient } from "../gitea/client.js";

/**
 * Beschreibt die feste, geheimnisfreie Zielkonfiguration des lokalen Webhook-Receivers.
 */
export interface LocalWebhookServiceOptions {
  /** Ausschließlich lokale, vorvalidierte Receiver-Zieladresse. */
  readonly targetUrl: string;
  /** Ausschließlich im Arbeitsspeicher gehaltenes HMAC-Secret. */
  readonly secret: string;
  /** Policy-geschützter Gitea-REST-Adapter. */
  readonly giteaClient: GiteaClient;
  /** Zentraler DBZS-EventBus. */
  readonly eventBus: DbzsEventBus;
}

/**
 * Orchestriert Gitea-Hooks ausschließlich für die vorgegebene lokale DBZS-Receiver-URL.
 *
 * Was: Delegiert Erstellen, Listen und Löschen an den Gitea-Client, ohne Ziel-URL oder Secret an MCP überzugeben.
 * Warum: Ein MCP-Client darf keinen Webhook als allgemeinen Datenabfluss zu frei wählbaren URLs konfigurieren.
 * Wofür: Für lokale, HMAC-verifizierte Gitea-Ereignisse in Phase 3.
 * Woher: Aus der validierten Runtime-Konfiguration und dem Gitea-Webhook-API-Vertrag.
 * Wo: Zwischen MCP-Orchestrierung und Gitea-Client.
 * Soll-Ergebnis: Prüffähige lokale Hooks, die nur auf den vorgesehenen DBZS-Receiver zeigen.
 */
export class LocalWebhookService {
  /**
   * Erstellt den Webhook-Orchestrator mit festem Ziel und nicht persistiertem HMAC-Secret.
   *
   * @param options Validierte lokale Webhook- und Serviceabhängigkeiten.
   */
  public constructor(private readonly options: LocalWebhookServiceOptions) {}

  /**
   * Erstellt einen Gitea-Hook für den lokalen Receiver und eine explizite Eventliste.
   *
   * Was: Übergibt immer die konfigurierten Ziel- und Secretwerte an den Gitea-Client.
   * Warum: Aufrufer können weder Secret noch Zieladresse substituieren.
   * Wofür: Für `gitea_create_local_webhook` nach expliziter Bestätigung.
   * Woher: Aus lokaler Runtime-Konfiguration und MCP-validierter Event- bzw. Branch-Auswahl.
   * Wo: Im Webhook-Service über dem Gitea-Client.
   * Soll-Ergebnis: Gesäuberte Gitea-Hook-Metadaten.
   *
   * @param owner Freigegebener Gitea-Owner.
   * @param repositoryName Repositoryname.
   * @param events Benötigte Gitea-Events.
   * @param branchFilter Optionaler Branchfilter.
   * @returns Gesäuberte Hook-Metadaten.
   */
  public async create(owner: string, repositoryName: string, events: string[], branchFilter?: string): Promise<GiteaWebhook> {
    this.options.eventBus.publish("webhook.gitea.registration.started", "info", {
      owner,
      repository: repositoryName,
      eventCount: events.length,
      targetUrl: this.options.targetUrl,
    });
    const webhook = await this.options.giteaClient.createLocalWebhook(owner, repositoryName, {
      targetUrl: this.options.targetUrl,
      secret: this.options.secret,
      events,
      branchFilter,
    });
    this.options.eventBus.publish("webhook.gitea.registration.completed", "info", {
      owner,
      repository: repositoryName,
      webhookId: webhook.id,
      eventCount: events.length,
    });
    return webhook;
  }

  /**
   * Verifiziert, dass eine angegebene Hook-Metadatenzieladresse der konfigurierten lokalen Zieladresse entspricht.
   *
   * Was: Prüft `config.url`, sofern Gitea dieses sichere Feld in einer gesäuberten Antwort zurückliefert.
   * Warum: Löschoperationen sollen nicht versehentlich einen fremden Hook treffen, wenn ihre Zieladresse sichtbar ist.
   * Wofür: Für die zusätzliche Sicherheitsprüfung von Hook-Löschungen.
   * Woher: Aus der Gitea-Hook-Liste.
   * Wo: Vor dem mutierenden Delete-Aufruf.
   * Soll-Ergebnis: Löschungen sind auf DBZS-lokale Hooks begrenzt, soweit Gitea URL-Metadaten liefert.
   *
   * @param webhook Gesäuberte Hook-Metadaten.
   * @throws {DbzsError} Wenn eine sichtbare URL nicht dem lokalen Receiver entspricht.
   */
  public assertLocalTarget(webhook: GiteaWebhook): void {
    const targetUrl = webhook.config?.url;
    if (targetUrl && targetUrl !== this.options.targetUrl) {
      throw new DbzsError("POLICY_VIOLATION", "Der ausgewählte Gitea-Webhook zeigt nicht auf den konfigurierten lokalen DBZS-Receiver.");
    }
  }

  /**
   * Entfernt einen zuvor geprüften lokalen Gitea-Hook.
   *
   * Was: Delegiert die Löschung und publiziert sichere Metadaten.
   * Warum: Die Löschoperation bleibt im Service statt im MCP-Handler und ist beobachtbar.
   * Wofür: Für `gitea_delete_local_webhook` nach Bestätigung und Local-Target-Prüfung.
   * Woher: Aus der Gitea-Hook-API.
   * Wo: Im lokalen Webhook-Service.
   * Soll-Ergebnis: Erfolgreiche Remote-Löschung ohne lokale Schattenzustände.
   *
   * @param owner Freigegebener Gitea-Owner.
   * @param repositoryName Repositoryname.
   * @param webhookId Hook-ID.
   */
  public async remove(owner: string, repositoryName: string, webhookId: number): Promise<void> {
    this.options.eventBus.publish("webhook.gitea.removal.started", "info", { owner, repository: repositoryName, webhookId });
    await this.options.giteaClient.deleteWebhook(owner, repositoryName, webhookId);
    this.options.eventBus.publish("webhook.gitea.removal.completed", "info", { owner, repository: repositoryName, webhookId });
  }
}
