// Collegamento a Supabase: accesso del professionista e archivio dei record cifrati.
// Parla con le interfacce REST del progetto, senza librerie. Sul server arrivano solo dati già cifrati.

import type { Vault } from "../crypto.js";
import type { Acceptance } from "./legal.js";
import { storageWorks, type Backend, type Meta, type StoredRecord } from "./store.js";

export interface CloudConfig {
  url: string;
  publishableKey: string;
}

/** La configurazione sta in config.js; se manca o è vuota l'app lavora in locale. */
export function cloudConfig(g: { STUDIO_CONFIG?: Partial<CloudConfig> } = globalThis as never): CloudConfig | null {
  const c = g.STUDIO_CONFIG;
  return c?.url && c.publishableKey ? { url: c.url.replace(/\/$/, ""), publishableKey: c.publishableKey } : null;
}

export class CloudError extends Error {
  constructor(
    readonly code: "credentials" | "exists" | "weak" | "network" | "unconfirmed" | "rate" | "denied" | "other",
    message: string,
  ) {
    super(message);
  }
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** Secondi dall'epoca. */
  expiresAt: number;
  userId: string;
  email: string;
}

type Fetch = typeof fetch;

export class Auth {
  private session: Session | null = null;
  private mem = new Map<string, string>();
  private persistent = storageWorks();
  constructor(
    private cfg: CloudConfig,
    private fetchFn: Fetch = (...a) => fetch(...a),
    private now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    const raw = this.read("session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
      } catch {
        this.session = null;
      }
    }
  }

  private read(k: string) {
    return this.persistent ? localStorage.getItem(`studio-auth:${k}`) : (this.mem.get(k) ?? null);
  }
  private write(k: string, v: string | null) {
    if (this.persistent) v === null ? localStorage.removeItem(`studio-auth:${k}`) : localStorage.setItem(`studio-auth:${k}`, v);
    else v === null ? this.mem.delete(k) : this.mem.set(k, v);
  }

  get userId(): string | null {
    return this.session?.userId ?? null;
  }
  get email(): string | null {
    return this.session?.email ?? null;
  }
  get signedIn(): boolean {
    return this.session !== null;
  }
  get publishableKey(): string {
    return this.cfg.publishableKey;
  }
  get url(): string {
    return this.cfg.url;
  }

  private async post(path: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; data: any }> {
    try {
      const res = await this.fetchFn(`${this.cfg.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: this.cfg.publishableKey, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    } catch {
      throw new CloudError("network", "Non riesco a collegarmi. Controlla la connessione e riprova.");
    }
  }

  private fromTokenResponse(d: any): Session {
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt: d.expires_at ?? this.now() + (d.expires_in ?? 3600),
      userId: d.user.id,
      email: d.user.email,
    };
  }
  private keep(s: Session) {
    this.session = s;
    this.write("session", JSON.stringify(s));
  }

  private explain(r: { status: number; data: any }): CloudError {
    const code = String(r.data?.error_code ?? r.data?.code ?? "");
    if (r.status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return new CloudError("rate", "Troppi tentativi ravvicinati. Aspetta qualche minuto e riprova.");
    if (code === "email_not_confirmed") return new CloudError("unconfirmed", "Devi ancora confermare l'email: apri il messaggio che ti ho mandato.");
    if (code === "invalid_credentials") return new CloudError("credentials", "Email o password non corrette.");
    if (code === "user_already_exists" || code === "email_exists") return new CloudError("exists", "Con questa email esiste già un account. Prova ad accedere.");
    if (code === "weak_password") return new CloudError("weak", "La password è troppo debole: usane una più lunga.");
    if (code === "email_address_invalid" || code === "validation_failed") return new CloudError("other", "Controlla l'indirizzo email.");
    return new CloudError("other", "Qualcosa non ha funzionato. Riprova tra poco.");
  }

  async signIn(email: string, password: string): Promise<void> {
    const r = await this.post("/auth/v1/token?grant_type=password", { email: email.trim(), password });
    if (!r.ok) throw this.explain(r);
    this.keep(this.fromTokenResponse(r.data));
  }

  /** Restituisce "confirm" se prima di entrare va confermata l'email. */
  async signUp(email: string, password: string): Promise<"in" | "confirm"> {
    const r = await this.post("/auth/v1/signup", { email: email.trim(), password });
    if (!r.ok) throw this.explain(r);
    if (r.data?.access_token) {
      this.keep(this.fromTokenResponse(r.data));
      return "in";
    }
    // Con la conferma attiva, un'email già registrata risponde come una nuova: non si può distinguere.
    return "confirm";
  }

  async signOut(): Promise<void> {
    const token = this.session?.accessToken;
    this.session = null;
    this.write("session", null);
    if (token) await this.post("/auth/v1/logout", {}, token).catch(() => {});
  }

  /** Token valido per le chiamate; lo rinnova poco prima della scadenza. */
  async accessToken(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expiresAt - 60 > this.now()) return s.accessToken;
    const r = await this.post("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refreshToken });
    if (!r.ok) {
      if (r.status === 400 || r.status === 401) {
        this.session = null;
        this.write("session", null);
      }
      return null;
    }
    const next = this.fromTokenResponse(r.data);
    this.keep(next);
    return next.accessToken;
  }
}

/** I record cifrati e la chiave avvolta stanno su Supabase; ognuno vede solo le proprie righe. */
export class SupabaseBackend implements Backend {
  readonly persistent = true;
  readonly fixedProfessionalId: string;
  private meta: Meta | null | undefined;
  constructor(
    private auth: Auth,
    private fetchFn: Fetch = (...a) => fetch(...a),
  ) {
    const id = auth.userId;
    if (!id) throw new CloudError("denied", "Accedi per continuare.");
    this.fixedProfessionalId = id;
  }

  private async rest(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
    const token = await this.auth.accessToken();
    if (!token) throw new CloudError("denied", "La sessione è scaduta: accedi di nuovo.");
    let res: Response;
    try {
      res = await this.fetchFn(`${this.auth.url}/rest/v1/${path}`, {
        method: init.method ?? "GET",
        headers: {
          apikey: this.auth.publishableKey,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init.prefer ? { prefer: init.prefer } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new CloudError("network", "Non riesco a collegarmi. Le modifiche non sono state salvate.");
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new CloudError("denied", "La sessione è scaduta: accedi di nuovo.");
      throw new CloudError("other", "Il salvataggio non è riuscito. Riprova.");
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  async getMeta(): Promise<Meta | null> {
    if (this.meta !== undefined) return this.meta;
    const id = this.fixedProfessionalId;
    const pro = await this.rest(`professionals?id=eq.${id}&select=acceptance`);
    const vault = await this.rest(`vaults?professional_id=eq.${id}&select=kdf,by_passphrase,by_recovery`);
    if (!Array.isArray(vault) || !vault[0]) {
      this.meta = null;
      return null;
    }
    const v = vault[0];
    const acceptance = pro?.[0]?.acceptance as Acceptance | null | undefined;
    this.meta = {
      professionalId: id,
      vault: { version: 1, kdf: v.kdf, byPassphrase: v.by_passphrase, byRecovery: v.by_recovery } as Vault,
      ...(acceptance ? { acceptance } : {}),
    };
    return this.meta;
  }

  async setMeta(m: Meta): Promise<void> {
    if (m.professionalId !== this.fixedProfessionalId) throw new CloudError("denied", "Archivio di un altro account.");
    const a = m.acceptance;
    await this.rest("professionals?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        id: m.professionalId,
        ...(a
          ? {
              terms_version: a.termsVersion,
              terms_accepted_at: a.at,
              privacy_version: a.privacyVersion,
              privacy_accepted_at: a.at,
              dpa_version: a.dpaVersion,
              dpa_accepted_at: a.at,
              acceptance: a,
            }
          : {}),
      },
    });
    await this.rest("vaults?on_conflict=professional_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { professional_id: m.professionalId, kdf: m.vault.kdf, by_passphrase: m.vault.byPassphrase, by_recovery: m.vault.byRecovery, updated_at: new Date().toISOString() },
    });
    this.meta = m;
  }

  async list(): Promise<StoredRecord[]> {
    const rows = await this.rest(`records?professional_id=eq.${this.fixedProfessionalId}&deleted_at=is.null&select=id,kind,iv,ct,updated_at&limit=100000`);
    return (rows as any[]).map((r) => ({ id: r.id, kind: r.kind, iv: r.iv, ct: r.ct, updatedAt: r.updated_at }));
  }

  async put(r: StoredRecord): Promise<void> {
    await this.rest("records?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { id: r.id, professional_id: this.fixedProfessionalId, kind: r.kind, iv: r.iv, ct: r.ct },
    });
  }

  async del(id: string): Promise<void> {
    await this.rest(`records?id=eq.${id}&professional_id=eq.${this.fixedProfessionalId}`, { method: "DELETE", prefer: "return=minimal" });
  }

  /** Cancella tutto ciò che riguarda questo professionista (record, chiave, condivisioni a cascata). */
  async wipe(): Promise<void> {
    await this.rest(`professionals?id=eq.${this.fixedProfessionalId}`, { method: "DELETE", prefer: "return=minimal" });
    this.meta = null;
  }
}
