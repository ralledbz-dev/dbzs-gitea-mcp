/**
 * DBZS — Division By Zeros
 * Datei: webhooks/gitea-webhook-receiver.ts
 * Zweck: Signierte lokale Gitea-Webhook-Zustellungen vor jeder Verarbeitung verifizieren und als sichere DBZS-Ereignisse veröffentlichen.
 * Version: 0.3.0
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DbzsEventBus } from "../core/observability.js";

/**
 * Beschreibt die kontrollierten Abhängigkeiten des lokalen Gitea-Webhook-Receivers.
 */
export interface GiteaWebhookReceiverOptions {
  /** HMAC-SHA256-Secret, das ausschließlich im Prozessspeicher verbleibt. */
  readonly secret: string;
  /** Genau ein akzeptierter Gitea-Owner. */
  readonly allowedOwner: string;
  /** Zentraler DBZS-EventBus für sichere Zustellungsmetadaten. */
  readonly eventBus: DbzsEventBus;
  /** Maximale Anzahl gemerkter Delivery-IDs zum lokalen Replay-Schutz. */
  readonly deliveryCacheSize?: number;
  /** Obergrenze für den unveränderten Payload vor JSON-Verarbeitung. */
  readonly maxBodyBytes?: number;
}

/**
 * Schreibt eine kleine, kontrollierte JSON-Antwort des Webhook-Receivers.
 *
 * Was: Setzt HTTP-Status und einen sicheren maschinenlesbaren Body.
 * Warum: Verifikationsfehler müssen klar erkennbar sein, ohne Secret-, Payload- oder Stackdetails preiszugeben.
 * Wofür: Für alle Ablehnungs- und Akzeptanzpfade des lokalen Gitea-Webhooks.
 * Woher: Aus der Webhook-HTTP-Grenze.
 * Wo: Ausschließlich im Receiver vor einer EventBus-Veröffentlichung.
 * Soll-Ergebnis: Deterministische HTTP-Antwort ohne Geheimnisleck.
 *
 * @param response Node-HTTP-Antwort.
 * @param statusCode HTTP-Statuscode.
 * @param body Sichere Antwortdaten.
 */
function writeWebhookResponse(response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/**
 * Liest den unveränderten Request-Body mit expliziter Größenbegrenzung.
 *
 * Was: Pufferte HTTP-Bytes bis zum Ende oder einer fest definierten Maximalgröße.
 * Warum: HMAC muss den exakten Raw-Body prüfen; unbegrenzte Bodies dürfen keinen Speicherangriff ermöglichen.
 * Wofür: Für die Gitea-Signaturprüfung vor JSON-Parsing.
 * Woher: Aus `IncomingMessage` der Node-HTTP-Runtime.
 * Wo: Am Anfang des Webhook-Verarbeitungspfads.
 * Soll-Ergebnis: Exakte, begrenzte Payloadbytes oder ein sichtbarer Größenfehler.
 *
 * @param request Eingehende HTTP-Anfrage.
 * @param maxBodyBytes Erlaubte Maximalgröße in Bytes.
 * @returns Unveränderter Request-Body.
 */
async function readRawBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new Error("WEBHOOK_BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

/**
 * Liefert einen einzelnen String-Header unabhängig von der Node-Headerdarstellung.
 *
 * Was: Vereinheitlicht fehlende, einzelne und mehrfach gesetzte Header.
 * Warum: Sicherheitskritische Header dürfen nicht über implizite Typkonvertierungen verarbeitet werden.
 * Wofür: Für Gitea-Signatur-, Delivery- und Event-Header.
 * Woher: Aus `IncomingMessage.headers`.
 * Wo: An der Webhook-HTTP-Grenze.
 * Soll-Ergebnis: Ein getrimmter Headerwert oder `undefined`.
 *
 * @param value Headerwert aus Node.
 * @returns Normalisierter Headerwert oder `undefined`.
 */
function getHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }
  return value?.trim() || undefined;
}

/**
 * Prüft, ob ein unbekannter Wert ein Record-Objekt ist.
 *
 * Was: Engt unbekannte JSON-Werte ohne Prototype-Annahmen ein.
 * Warum: Webhook-Payloads bleiben fremde Daten und dürfen erst nach Typprüfung gelesen werden.
 * Wofür: Für sichere Extraktion der minimal benötigten Repository-Metadaten.
 * Woher: Aus `JSON.parse`.
 * Wo: Nach erfolgreicher HMAC-Prüfung.
 * Soll-Ergebnis: Sichere Record-Narrowing-Basis.
 *
 * @param value Unbekannter JSON-Wert.
 * @returns Ob der Wert ein nicht-null Objekt ist.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extrahiert genau den Owner aus Giteas Repository-Payloadteil.
 *
 * Was: Liest den Owner aus `repository.owner.login` oder dem ersten Segment von `repository.full_name`.
 * Warum: Eine Signatur allein reicht nicht; die DBZS-Owner-Policy bleibt auch für eingehende Events verbindlich.
 * Wofür: Für die Namespace-Prüfung vor EventBus-Veröffentlichung.
 * Woher: Aus generischen Gitea-Webhook-Payloads.
 * Wo: Nach Raw-Body- und JSON-Verifikation.
 * Soll-Ergebnis: Ownername oder `undefined` bei unvollständiger Payload.
 *
 * @param repository Rohes Repositoryobjekt aus dem Webhook.
 * @returns Extrahierter Owner oder `undefined`.
 */
function extractOwner(repository: Record<string, unknown>): string | undefined {
  const owner = repository.owner;
  if (isRecord(owner)) {
    const login = owner.login;
    if (typeof login === "string" && login.trim()) {
      return login.trim();
    }
    const username = owner.username;
    if (typeof username === "string" && username.trim()) {
      return username.trim();
    }
  }

  const fullName = repository.full_name;
  if (typeof fullName === "string") {
    const [ownerName] = fullName.split("/", 1);
    return ownerName?.trim() || undefined;
  }

  return undefined;
}

/**
 * Normalisiert Giteas hexadezimale HMAC-SHA256-Signatur.
 *
 * Was: Akzeptiert den aktuellen nackten Hex-Wert sowie den GitHub-kompatiblen `sha256=`-Präfix.
 * Warum: Gitea-Versionen und Kompatibilitätsmodi dürfen keine inkonsistente Secret-Prüfung erzeugen.
 * Wofür: Für eine einheitliche, zeitkonstante HMAC-Prüfung.
 * Woher: Aus `X-Gitea-Signature` oder `X-Hub-Signature-256`.
 * Wo: Vor jeder Payload-Verarbeitung.
 * Soll-Ergebnis: Valider Hex-String oder `undefined`.
 *
 * @param signature Rohwert des Signaturheaders.
 * @returns Normalisierter HMAC-Digest oder `undefined`.
 */
function normalizeSignature(signature: string | undefined): string | undefined {
  const normalized = signature?.replace(/^sha256=/i, "").toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

/**
 * Empfängt und verifiziert Gitea-Zustellungen an einer ausschließlich lokalen HTTP-Grenze.
 *
 * Was: Prüft Methode, Content-Type, HMAC-SHA256, Delivery-ID, JSON-Struktur und Owner-Policy vor der EventBus-Veröffentlichung.
 * Warum: Webhook-Payloads sind extern eingehende Daten und dürfen weder ungeprüft noch wiederholt Geschäftsprozesse auslösen.
 * Wofür: Für lokale Release-, Package-, Workflow- und Repository-Ereignisse aus Gitea.
 * Woher: Aus Giteas Generic-Webhook-Vertrag und DBZS-Sicherheitsmodell.
 * Wo: Hinter dem Loopback-HTTP-Router unter `/webhooks/gitea`.
 * Soll-Ergebnis: Schnelle HTTP-Antworten und sichere, begrenzte DBZS-Ereignismetadaten ohne Raw-Payloadpersistenz.
 */
export class GiteaWebhookReceiver {
  private readonly deliveryCacheSize: number;
  private readonly maxBodyBytes: number;
  private readonly deliveryOrder: string[] = [];
  private readonly knownDeliveries = new Set<string>();

  /**
   * Erstellt einen Receiver mit einem expliziten, nicht persistierten HMAC-Secret.
   *
   * @param options Validierte Sicherheits- und Observability-Abhängigkeiten.
   */
  public constructor(private readonly options: GiteaWebhookReceiverOptions) {
    this.deliveryCacheSize = options.deliveryCacheSize ?? 500;
    this.maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  }

  /**
   * Verarbeitet eine einzelne Gitea-Webhook-Zustellung vollständig innerhalb der HTTP-Sicherheitsgrenze.
   *
   * Was: Prüft HMAC und Owner, dedupliziert Delivery-IDs und veröffentlicht nur sichere Kontextfelder.
   * Warum: Zustellungen müssen vor Geschäftslogik authentisch, namespacesicher und idempotent sein.
   * Wofür: Für `/webhooks/gitea` im lokalen HTTP-Transport.
   * Woher: Aus Gitea-Request-Headern und JSON-Payload.
   * Wo: Aufrufbar durch den zentralen Loopback-Router.
   * Soll-Ergebnis: HTTP 202 bei neuer oder doppelter gültiger Zustellung, klare 4xx-Ablehnung bei Sicherheitsfehlern.
   *
   * @param request Eingehende Node-HTTP-Anfrage.
   * @param response Node-HTTP-Antwort.
   */
  public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", { reason: "method_not_allowed", method: request.method ?? "UNKNOWN" });
      writeWebhookResponse(response, 405, { error: "Für den Gitea-Webhook ist ausschließlich POST erlaubt." });
      return;
    }

    const contentType = getHeader(request.headers["content-type"]);
    if (!contentType?.toLowerCase().startsWith("application/json")) {
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", { reason: "content_type_not_allowed", contentType: contentType ?? null });
      writeWebhookResponse(response, 415, { error: "Der Gitea-Webhook akzeptiert ausschließlich application/json." });
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(request, this.maxBodyBytes);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "WEBHOOK_BODY_READ_FAILED";
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", { reason });
      writeWebhookResponse(response, reason === "WEBHOOK_BODY_TOO_LARGE" ? 413 : 400, { error: "Die Webhook-Payload konnte nicht sicher gelesen werden." });
      return;
    }

    const signature = normalizeSignature(
      getHeader(request.headers["x-gitea-signature"]) ?? getHeader(request.headers["x-hub-signature-256"]),
    );
    const expectedSignature = createHmac("sha256", this.options.secret).update(rawBody).digest("hex");
    if (!signature || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex"))) {
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", { reason: "signature_invalid" });
      writeWebhookResponse(response, 401, { error: "Die Gitea-Webhook-Signatur ist ungültig." });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", { reason: "payload_json_invalid" });
      writeWebhookResponse(response, 400, { error: "Die Gitea-Webhook-Payload enthält kein gültiges JSON." });
      return;
    }

    if (!isRecord(payload) || !isRecord(payload.repository)) {
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", { reason: "repository_missing" });
      writeWebhookResponse(response, 422, { error: "Die Gitea-Webhook-Payload enthält kein gültiges Repository." });
      return;
    }

    const repository = payload.repository;
    const owner = extractOwner(repository);
    if (owner !== this.options.allowedOwner) {
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", {
        reason: "owner_not_allowed",
        requestedOwner: owner ?? null,
        allowedOwner: this.options.allowedOwner,
      });
      writeWebhookResponse(response, 403, { error: "Der Gitea-Webhook-Owner ist nicht freigegeben." });
      return;
    }

    const deliveryId = getHeader(request.headers["x-gitea-delivery"]);
    if (!deliveryId) {
      this.options.eventBus.publish("webhook.gitea.rejected", "warn", { reason: "delivery_id_missing" });
      writeWebhookResponse(response, 400, { error: "Die Gitea-Webhook-Delivery-ID fehlt." });
      return;
    }

    if (this.knownDeliveries.has(deliveryId)) {
      this.options.eventBus.publish("webhook.gitea.duplicate", "info", { deliveryId, owner, repository: repository.full_name ?? null });
      writeWebhookResponse(response, 202, { accepted: true, duplicate: true });
      return;
    }

    this.rememberDelivery(deliveryId);
    const event = getHeader(request.headers["x-gitea-event"]) ?? "unknown";
    const eventType = getHeader(request.headers["x-gitea-event-type"]) ?? "unknown";
    const release = isRecord(payload.release) ? payload.release : undefined;
    const packageRecord = isRecord(payload.package) ? payload.package : undefined;
    this.options.eventBus.publish("webhook.gitea.received", "info", {
      deliveryId,
      event,
      eventType,
      owner,
      repository: typeof repository.full_name === "string" ? repository.full_name : null,
      action: typeof payload.action === "string" ? payload.action : null,
      ref: typeof payload.ref === "string" ? payload.ref : null,
      releaseTag: typeof release?.tag_name === "string" ? release.tag_name : null,
      packageName: typeof packageRecord?.name === "string" ? packageRecord.name : null,
      packageType: typeof packageRecord?.type === "string" ? packageRecord.type : null,
    });
    writeWebhookResponse(response, 202, { accepted: true, duplicate: false });
  }

  /**
   * Merkt eine gültige Delivery-ID mit strikt begrenztem Speicherbedarf.
   *
   * Was: Fügt die ID ein und entfernt die älteste ID oberhalb der Cachegrenze.
   * Warum: Gitea kann Zustellungen erneut senden; der Prozess darf dadurch weder doppelt verarbeiten noch unbeschränkt wachsen.
   * Wofür: Für den lokalen Replay-Schutz innerhalb einer laufenden Runtime.
   * Woher: Aus `X-Gitea-Delivery`.
   * Wo: Nach erfolgreicher Authentifizierung und Owner-Policy.
   * Soll-Ergebnis: Begrenzte FIFO-Deduplizierung ohne Persistenzversprechen über Neustarts.
   *
   * @param deliveryId Verifizierte Gitea-Zustellungs-ID.
   */
  private rememberDelivery(deliveryId: string): void {
    this.knownDeliveries.add(deliveryId);
    this.deliveryOrder.push(deliveryId);
    while (this.deliveryOrder.length > this.deliveryCacheSize) {
      const oldestDelivery = this.deliveryOrder.shift();
      if (oldestDelivery) {
        this.knownDeliveries.delete(oldestDelivery);
      }
    }
  }
}
