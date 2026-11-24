// Il portale vero: parla con la funzione "portal" su Supabase.
// Stessa interfaccia del server di prova, così app e portale non cambiano.

import type { Sealed } from "../crypto.js";
import { PortalError, type PortalServer } from "./portal-server.js";

export interface RemoteConfig {
  /** Es. https://xxxx.supabase.co */
  url: string;
  /** Chiave pubblica del progetto (serve solo a raggiungere la funzione). */
  publicKey: string;
  /** Sessione del professionista; assente nel portale della persona. */
  accessToken?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
}

const CODES: PortalError["code"][] = ["revoked", "not_found", "bad_code", "too_many", "conflict", "invalid"];

export class RemotePortalServer implements PortalServer {
  constructor(private cfg: RemoteConfig) {}

  private async call(body: Record<string, unknown>, asProfessional: boolean): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json", apikey: this.cfg.publicKey };
    if (asProfessional) {
      const token = await this.cfg.accessToken?.();
      if (!token) throw new PortalError("invalid", "Accedi di nuovo per aggiornare il portale.");
      headers.authorization = `Bearer ${token}`;
    } else headers.authorization = `Bearer ${this.cfg.publicKey}`;
    let res: Response;
    try {
      res = await (this.cfg.fetchFn ?? fetch)(`${this.cfg.url.replace(/\/$/, "")}/functions/v1/portal`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      throw new PortalError("invalid", "Non riesco a collegarmi. Controlla la connessione e riprova.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const code = CODES.includes(data?.error) ? (data.error as PortalError["code"]) : "invalid";
    throw new PortalError(code, typeof data?.message === "string" ? data.message : "Qualcosa non ha funzionato. Riprova tra poco.");
  }

  async publish(shareId: string, input: { email: string; sealed: Sealed; rev: number }) {
    await this.call({ action: "publish", shareId, email: input.email, iv: input.sealed.iv, ct: input.sealed.ct, rev: input.rev }, true);
  }
  async revoke(shareId: string) {
    await this.call({ action: "revoke", shareId }, true);
  }
  async requestCode(shareId: string, email: string) {
    await this.call({ action: "requestCode", shareId, email }, false);
    return { sent: true as const };
  }
  async verify(shareId: string, email: string, code: string) {
    const r = await this.call({ action: "verify", shareId, email, code }, false);
    return { sealed: { iv: r.iv, ct: r.ct } as Sealed, rev: r.rev as number };
  }
  async forget(shareIds: string[]) {
    await this.call({ action: "forget", shareId: "", shareIds }, true);
  }
}
