// Condivisione con le persone: chiavi, link d'invito e aggiornamento automatico del portale.

import { fromB64, toB64 } from "../encoding.js";
import { buildInviteLink, createShareKey, sealPackage } from "../share.js";
import { buildPackage } from "./portal.js";
import { PortalError, type PortalServer } from "./portal-server.js";
import type { Entity, Person } from "./model.js";
import { Studio, StudioError } from "./store.js";

/** Cosa si conserva (cifrato con la chiave principale) per ogni condivisione. */
export interface ShareRecord {
  personId: string;
  shareId: string;
  /** Chiave di condivisione, base64. Sta dentro un record già cifrato. */
  key: string;
  email: string;
  rev: number;
  active: boolean;
  createdAt: string;
}

const EMAIL = /^\S+@\S+\.\S+$/;

export class Sharing {
  private last = new Map<string, string>(); // shareId -> ultimo pacchetto pubblicato (JSON)
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private stop: (() => void) | undefined;
  /** Chi vuole sapere quando un aggiornamento fallisce (rete assente, ecc.). */
  onError: (e: unknown) => void = () => {};

  constructor(
    private studio: Studio,
    private server: PortalServer,
    /** Cartella dove stanno app e portale, es. "https://studio.example/" */
    private base: string,
    private now: () => Date = () => new Date(),
    private page = "portale.html",
  ) {}

  list(): Entity<ShareRecord>[] {
    return this.studio.list<ShareRecord>("share_key");
  }

  of(personId: string): Entity<ShareRecord> | null {
    return this.list().find((s) => s.value.personId === personId && s.value.active) ?? null;
  }

  linkFor(personId: string): string | null {
    const s = this.of(personId);
    return s ? buildInviteLink(this.base, s.value.shareId, fromB64(s.value.key), this.page.replace(/^\//, "")) : null;
  }

  /** Attiva la condivisione e pubblica il pacchetto. Serve l'email della persona: ci arriva il codice di accesso. */
  async enable(personId: string): Promise<string> {
    const person = this.studio.get<Person>(personId);
    if (!person) throw new StudioError("Persona non trovata.");
    if (!EMAIL.test(person.value.email.trim())) throw new StudioError("Per condividere serve l'email della persona: il codice di accesso arriva lì.");
    const existing = this.of(personId);
    if (existing) return this.linkFor(personId)!;
    const k = await createShareKey();
    const rec: ShareRecord = {
      personId,
      shareId: k.shareId,
      key: toB64(k.raw),
      email: person.value.email.trim(),
      rev: 0,
      active: true,
      createdAt: this.now().toISOString(),
    };
    const saved = await this.studio.save<ShareRecord>("share_key", rec);
    await this.publish(saved.id);
    return this.linkFor(personId)!;
  }

  /** Interrompe la condivisione: il link smette di funzionare subito. */
  async disable(personId: string): Promise<void> {
    for (const s of this.list().filter((x) => x.value.personId === personId && x.value.active)) {
      await this.server.revoke(s.value.shareId);
      await this.studio.save<ShareRecord>("share_key", { ...s.value, active: false }, s.id);
      this.last.delete(s.value.shareId);
    }
  }

  /** Nuovo link: il vecchio smette di funzionare. */
  async renew(personId: string): Promise<string> {
    await this.disable(personId);
    return this.enable(personId);
  }

  private async publish(recordId: string): Promise<void> {
    const rec = this.studio.get<ShareRecord>(recordId);
    if (!rec || !rec.value.active) return;
    const person = this.studio.get<Person>(rec.value.personId);
    if (!person) return;
    const pkg = buildPackage(this.studio, rec.value.personId, this.now());
    if (!pkg) return;
    const email = person.value.email.trim();
    const json = JSON.stringify(pkg) + "|" + email;
    if (this.last.get(rec.value.shareId) === json) return; // nulla di nuovo
    if (!EMAIL.test(email)) return; // email tolta: si tiene l'ultimo pacchetto, ma non si aggiorna
    const rev = rec.value.rev + 1;
    const sealed = await sealPackage(fromB64(rec.value.key), rec.value.shareId, rev, pkg);
    try {
      await this.server.publish(rec.value.shareId, { email, sealed, rev });
    } catch (e) {
      if (e instanceof PortalError && e.code === "revoked") {
        await this.studio.save<ShareRecord>("share_key", { ...rec.value, active: false }, recordId);
        return;
      }
      throw e;
    }
    this.last.set(rec.value.shareId, json);
    await this.studio.save<ShareRecord>("share_key", { ...rec.value, rev, email }, recordId);
  }

  /** Riallinea tutte le condivisioni attive: pubblica solo quelle cambiate. */
  async sync(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const s of this.list().filter((x) => x.value.active)) await this.publish(s.id);
    } finally {
      this.busy = false;
    }
  }

  /** Aggiorna il portale poco dopo ogni modifica. */
  start(delayMs = 700): void {
    this.stop?.();
    this.stop = this.studio.subscribe(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync().catch((e) => this.onError(e)), delayMs);
    });
  }

  halt(): void {
    clearTimeout(this.timer);
    this.stop?.();
    this.stop = undefined;
  }

  /** Per la cancellazione dell'archivio: revoca tutto lato server. */
  async revokeAll(): Promise<void> {
    const ids = this.list().map((s) => s.value.shareId);
    for (const id of ids) await this.server.revoke(id);
    await this.server.forget(ids);
  }
}
