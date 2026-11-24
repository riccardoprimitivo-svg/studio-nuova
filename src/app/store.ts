// Archivio dei record cifrati.
//
// `Backend` è la parte che sa dove stanno i byte (per ora il browser, poi Supabase).
// `Studio` sta sopra: tiene la chiave principale in memoria, cifra e decifra,
// e mantiene una copia in chiaro SOLO in memoria mentre l'app è sbloccata.

import {
  changePassphrase,
  createAccount,
  decryptRecord,
  encryptRecord,
  rotateRecoveryCode,
  unlockWithPassphrase,
  unlockWithRecovery,
  type Sealed,
  type Vault,
} from "../crypto.js";
import type { Acceptance } from "./legal.js";
import type { Entity } from "./model.js";

export type Kind = "person" | "meeting" | "package" | "structure" | "payment" | "setting" | "share_key";

export interface StoredRecord extends Sealed {
  id: string;
  kind: Kind;
  updatedAt: string;
}

export interface Meta {
  professionalId: string;
  vault: Vault;
  /** Ultima accettazione di condizioni, informativa e accordo sul trattamento dei dati. */
  acceptance?: Acceptance;
}

export interface Backend {
  getMeta(): Promise<Meta | null>;
  setMeta(m: Meta): Promise<void>;
  list(): Promise<StoredRecord[]>;
  put(r: StoredRecord): Promise<void>;
  del(id: string): Promise<void>;
  /** Cancella tutto, impostazioni comprese. */
  wipe(): Promise<void>;
  /** Con un account, l'identità del professionista è quella dell'account. */
  readonly fixedProfessionalId?: string;
}

/** Per i test e per le prove: niente persistenza. */
export class MemoryBackend implements Backend {
  meta: Meta | null = null;
  rows = new Map<string, StoredRecord>();
  async getMeta() {
    return this.meta;
  }
  async setMeta(m: Meta) {
    this.meta = m;
  }
  async list() {
    return [...this.rows.values()];
  }
  async put(r: StoredRecord) {
    this.rows.set(r.id, r);
  }
  async del(id: string) {
    this.rows.delete(id);
  }
  async wipe() {
    this.meta = null;
    this.rows.clear();
  }
}

/** Il browser lascia scrivere in localStorage? In certi contesti (anteprime, navigazione privata) no. */
export function storageWorks(): boolean {
  try {
    const k = "studio:probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dati nel browser (localStorage). Solo per la fase locale: i record sono comunque cifrati.
 * Se localStorage non è disponibile si lavora in memoria: tutto si perde alla chiusura.
 */
export class LocalBackend implements Backend {
  readonly persistent: boolean;
  private mem = new MemoryBackend();
  constructor(private ns = "studio") {
    this.persistent = storageWorks();
  }
  private k(s: string) {
    return `${this.ns}:${s}`;
  }
  async getMeta() {
    if (!this.persistent) return this.mem.getMeta();
    const raw = localStorage.getItem(this.k("meta"));
    return raw ? (JSON.parse(raw) as Meta) : null;
  }
  async setMeta(m: Meta) {
    if (!this.persistent) return this.mem.setMeta(m);
    localStorage.setItem(this.k("meta"), JSON.stringify(m));
  }
  private all(): Record<string, StoredRecord> {
    const raw = localStorage.getItem(this.k("records"));
    return raw ? (JSON.parse(raw) as Record<string, StoredRecord>) : {};
  }
  async list() {
    return this.persistent ? Object.values(this.all()) : this.mem.list();
  }
  async put(r: StoredRecord) {
    if (!this.persistent) return this.mem.put(r);
    const all = this.all();
    all[r.id] = r;
    localStorage.setItem(this.k("records"), JSON.stringify(all));
  }
  async del(id: string) {
    if (!this.persistent) return this.mem.del(id);
    const all = this.all();
    delete all[id];
    localStorage.setItem(this.k("records"), JSON.stringify(all));
  }
  async wipe() {
    if (!this.persistent) return this.mem.wipe();
    localStorage.removeItem(this.k("meta"));
    localStorage.removeItem(this.k("records"));
  }
}

export class StudioError extends Error {}

type Listener = () => void;

export class Studio {
  private cache = new Map<string, { kind: Kind; value: unknown }>();
  private listeners = new Set<Listener>();

  private constructor(
    private backend: Backend,
    readonly professionalId: string,
    private master: CryptoKey,
  ) {}

  static async exists(backend: Backend): Promise<boolean> {
    return (await backend.getMeta()) !== null;
  }

  /** Primo avvio. Restituisce anche il codice di recupero, da mostrare una volta sola. */
  static async create(
    backend: Backend,
    passphrase: string,
    iterations?: number,
    acceptance?: Acceptance,
  ): Promise<{ studio: Studio; recoveryCode: string }> {
    if (await backend.getMeta()) throw new StudioError("Esiste già un archivio su questo dispositivo.");
    const acc = await createAccount(passphrase, iterations);
    const professionalId = backend.fixedProfessionalId ?? globalThis.crypto.randomUUID();
    await backend.setMeta({ professionalId, vault: acc.vault, ...(acceptance ? { acceptance } : {}) });
    return { studio: new Studio(backend, professionalId, acc.master), recoveryCode: acc.recoveryCode };
  }

  static async unlock(backend: Backend, secret: { passphrase: string } | { recoveryCode: string }): Promise<Studio> {
    const meta = await backend.getMeta();
    if (!meta) throw new StudioError("Nessun archivio su questo dispositivo.");
    const master =
      "passphrase" in secret
        ? await unlockWithPassphrase(meta.vault, secret.passphrase)
        : await unlockWithRecovery(meta.vault, secret.recoveryCode);
    const s = new Studio(backend, meta.professionalId, master);
    await s.load();
    return s;
  }

  private async load() {
    this.cache.clear();
    for (const r of await this.backend.list()) {
      const value = await decryptRecord(this.master, { professionalId: this.professionalId, recordId: r.id, kind: r.kind }, r);
      this.cache.set(r.id, { kind: r.kind, value });
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  list<T>(kind: Kind): Entity<T>[] {
    const out: Entity<T>[] = [];
    for (const [id, e] of this.cache) if (e.kind === kind) out.push({ id, value: e.value as T });
    return out;
  }

  get<T>(id: string): Entity<T> | null {
    const e = this.cache.get(id);
    return e ? { id, value: e.value as T } : null;
  }

  /** Crea (id assente) o aggiorna. La copia in memoria cambia solo dopo che la scrittura è andata a buon fine. */
  async save<T>(kind: Kind, value: T, id?: string): Promise<Entity<T>> {
    const recordId = id ?? globalThis.crypto.randomUUID();
    const existing = this.cache.get(recordId);
    if (existing && existing.kind !== kind) throw new StudioError("Il tipo di un record non può cambiare.");
    const sealed = await encryptRecord(this.master, { professionalId: this.professionalId, recordId, kind }, value);
    await this.backend.put({ id: recordId, kind, ...sealed, updatedAt: new Date().toISOString() });
    this.cache.set(recordId, { kind, value });
    this.emit();
    return { id: recordId, value };
  }

  async remove(...ids: string[]): Promise<void> {
    for (const id of ids) await this.backend.del(id);
    for (const id of ids) this.cache.delete(id);
    this.emit();
  }

  // ---- Accettazione dei testi legali ---------------------------------------

  async acceptance(): Promise<Acceptance | null> {
    return (await this.backend.getMeta())?.acceptance ?? null;
  }

  async accept(a: Acceptance): Promise<void> {
    const meta = await this.backend.getMeta();
    if (!meta) throw new StudioError("Archivio non trovato.");
    await this.backend.setMeta({ ...meta, acceptance: a });
  }

  // ---- Diritti: passphrase, esportazione, cancellazione ---------------------

  /** Nuova passphrase. I record non si toccano: cambia solo l'avvolgimento della chiave principale. */
  async changePassphrase(oldPass: string, newPass: string): Promise<void> {
    const meta = await this.backend.getMeta();
    if (!meta) throw new StudioError("Archivio non trovato.");
    const vault = await changePassphrase(meta.vault, oldPass, newPass);
    await this.backend.setMeta({ ...meta, vault });
  }

  /** Nuovo codice di recupero: il vecchio smette di funzionare. Richiede la passphrase. */
  async newRecoveryCode(passphrase: string): Promise<string> {
    const meta = await this.backend.getMeta();
    if (!meta) throw new StudioError("Archivio non trovato.");
    const r = await rotateRecoveryCode(meta.vault, passphrase);
    await this.backend.setMeta({ ...meta, vault: r.vault });
    return r.recoveryCode;
  }

  /** Tutti i dati in chiaro, per chi li vuole portare altrove. */
  exportPlain(now: Date = new Date()): ExportFile {
    const records: ExportFile["records"] = [];
    for (const [id, e] of this.cache) records.push({ id, kind: e.kind, value: e.value });
    return { format: "studio-export", version: 1, exportedAt: now.toISOString(), records };
  }

  /** Copia cifrata, così com'è conservata: si riapre solo con passphrase o codice. */
  async exportEncrypted(now: Date = new Date()): Promise<EncryptedExportFile> {
    const meta = await this.backend.getMeta();
    if (!meta) throw new StudioError("Archivio non trovato.");
    return {
      format: "studio-export-encrypted",
      version: 1,
      exportedAt: now.toISOString(),
      professionalId: meta.professionalId,
      vault: meta.vault,
      records: await this.backend.list(),
    };
  }

  /** Cancella l'archivio da questo dispositivo: record, chiavi e impostazioni. Non si torna indietro. */
  async eraseEverything(): Promise<void> {
    await this.backend.wipe();
    this.cache.clear();
    this.emit();
  }
}

export interface ExportFile {
  format: "studio-export";
  version: 1;
  exportedAt: string;
  records: { id: string; kind: Kind; value: unknown }[];
}

export interface EncryptedExportFile {
  format: "studio-export-encrypted";
  version: 1;
  exportedAt: string;
  professionalId: string;
  vault: Vault;
  records: StoredRecord[];
}
