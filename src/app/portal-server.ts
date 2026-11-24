// Il "server" del portale.
//
// Per ora gira nel browser (stesso dispositivo) e ha lo stesso comportamento che avrà la funzione
// edge su Supabase: conserva solo il pacchetto cifrato, l'impronta dell'email e quella dei codici.
// Non vede mai la chiave di condivisione né il contenuto.

import { constantTimeEqual, hashEmail, hashOtp, newOtp } from "../portal-auth.js";
import type { Sealed } from "../crypto.js";
import { storageWorks } from "./store.js";

export class PortalError extends Error {
  constructor(
    readonly code: "revoked" | "not_found" | "bad_code" | "too_many" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export interface PortalServer {
  /** Pubblica o aggiorna. `rev` deve essere quello attuale + 1 (1 la prima volta). */
  publish(shareId: string, input: { email: string; sealed: Sealed; rev: number }): Promise<void>;
  revoke(shareId: string): Promise<void>;
  /** Risponde sempre allo stesso modo, che l'email sia giusta o no. In prova restituisce il codice. */
  requestCode(shareId: string, email: string): Promise<{ sent: true; demoCode?: string }>;
  verify(shareId: string, email: string, code: string): Promise<{ sealed: Sealed; rev: number }>;
  /** Cancella tutto ciò che riguarda un professionista. */
  forget(shareIds: string[]): Promise<void>;
}

export interface KV {
  get(k: string): string | null;
  set(k: string, v: string): void;
  del(k: string): void;
}

export class MemoryKV implements KV {
  readonly m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
  del(k: string) {
    this.m.delete(k);
  }
}

/** localStorage, se c'è; altrimenti memoria. Stesso `ns` = stesso "server" per app e portale. */
export class LocalKV implements KV {
  private mem = new MemoryKV();
  private ok = storageWorks();
  constructor(private ns = "studio-portal") {}
  get(k: string) {
    return this.ok ? localStorage.getItem(`${this.ns}:${k}`) : this.mem.get(k);
  }
  set(k: string, v: string) {
    if (this.ok) localStorage.setItem(`${this.ns}:${k}`, v);
    else this.mem.set(k, v);
  }
  del(k: string) {
    if (this.ok) localStorage.removeItem(`${this.ns}:${k}`);
    else this.mem.del(k);
  }
}

interface ShareRow {
  emailHash: string;
  sealed: Sealed;
  rev: number;
  revoked: boolean;
}
interface OtpRow {
  hash: string;
  expiresAt: number;
  attempts: number;
}

const OTP_MINUTES = 10;
export const MAX_ATTEMPTS = 5;

export class LocalPortalServer implements PortalServer {
  constructor(
    private kv: KV,
    private now: () => number = () => Date.now(),
  ) {}

  private pepper(): string {
    let p = this.kv.get("pepper");
    if (!p) {
      p = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      this.kv.set("pepper", p);
    }
    return p;
  }
  private row(id: string): ShareRow | null {
    const raw = this.kv.get(`share:${id}`);
    return raw ? (JSON.parse(raw) as ShareRow) : null;
  }

  async publish(shareId: string, input: { email: string; sealed: Sealed; rev: number }) {
    if (!/^[0-9a-f-]{36}$/.test(shareId) || !/^\S+@\S+\.\S+$/.test(input.email.trim())) throw new PortalError("invalid", "Dati non validi.");
    const prev = this.row(shareId);
    if (prev?.revoked) throw new PortalError("revoked", "Condivisione interrotta.");
    if (input.rev !== (prev?.rev ?? 0) + 1) throw new PortalError("conflict", "Versione non aggiornata.");
    const row: ShareRow = { emailHash: await hashEmail(input.email, this.pepper()), sealed: input.sealed, rev: input.rev, revoked: false };
    this.kv.set(`share:${shareId}`, JSON.stringify(row));
  }

  async revoke(shareId: string) {
    const r = this.row(shareId);
    if (!r) return;
    this.kv.set(`share:${shareId}`, JSON.stringify({ ...r, sealed: { iv: "", ct: "" }, revoked: true } satisfies ShareRow));
    this.kv.del(`otp:${shareId}`);
  }

  async requestCode(shareId: string, email: string) {
    const r = this.row(shareId);
    const match = !!r && !r.revoked && constantTimeEqual(r.emailHash, await hashEmail(email, this.pepper()));
    if (!match) return { sent: true as const };
    const code = newOtp();
    const otp: OtpRow = { hash: await hashOtp(code, shareId, this.pepper()), expiresAt: this.now() + OTP_MINUTES * 60_000, attempts: 0 };
    this.kv.set(`otp:${shareId}`, JSON.stringify(otp));
    // Qui sul server vero parte l'email. In prova il codice si mostra a schermo.
    return { sent: true as const, demoCode: code };
  }

  async verify(shareId: string, email: string, code: string) {
    const r = this.row(shareId);
    if (!r) throw new PortalError("not_found", "Questo link non è valido.");
    if (r.revoked) throw new PortalError("revoked", "Questo link non è più attivo.");
    const raw = this.kv.get(`otp:${shareId}`);
    const otp = raw ? (JSON.parse(raw) as OtpRow) : null;
    if (!otp || otp.expiresAt < this.now()) throw new PortalError("bad_code", "Il codice non è corretto o è scaduto.");
    if (otp.attempts >= MAX_ATTEMPTS) {
      this.kv.del(`otp:${shareId}`);
      throw new PortalError("too_many", "Troppi tentativi. Chiedi un codice nuovo.");
    }
    otp.attempts += 1;
    this.kv.set(`otp:${shareId}`, JSON.stringify(otp));
    const okCode = constantTimeEqual(otp.hash, await hashOtp(code.trim(), shareId, this.pepper()));
    const okEmail = constantTimeEqual(r.emailHash, await hashEmail(email, this.pepper()));
    if (!okCode || !okEmail) throw new PortalError("bad_code", "Il codice non è corretto o è scaduto.");
    this.kv.del(`otp:${shareId}`); // monouso
    return { sealed: r.sealed, rev: r.rev };
  }

  async forget(shareIds: string[]) {
    for (const id of shareIds) {
      this.kv.del(`share:${id}`);
      this.kv.del(`otp:${id}`);
    }
  }
}
