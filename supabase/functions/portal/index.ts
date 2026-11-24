// Funzione del portale: l'unico punto in cui il server vede l'email di una persona,
// e solo nell'istante in cui la trasforma in impronta o spedisce il codice. Non la scrive mai nei log.
// Non conosce la chiave di condivisione né il contenuto dei pacchetti (arrivano già cifrati).
import postgres from "npm:postgres@3";

const PEPPER = Deno.env.get("PORTAL_PEPPER") ?? "";
const BREVO_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "studio@opificiovocale.it";
const MAIL_NAME = Deno.env.get("MAIL_FROM_NAME") ?? "Studio.";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MAX_ATTEMPTS = 5;
const OTP_MINUTES = 10;
const MAX_CODES_PER_HOUR = 5;

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });
const enc = new TextEncoder();
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });
const fail = (code: string, message: string, status: number) => json({ error: code, message }, status);

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}
const hashEmail = (email: string) => hmac(`email:${email.trim().toLowerCase()}`);
const hashOtp = (code: string, shareId: string) => hmac(`otp:${shareId}:${code}`);
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function newOtp(): string {
  const limit = 4_294_967_296 - (4_294_967_296 % 100_000_000);
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
    if (n < limit) return String(n % 100_000_000).padStart(8, "0");
  }
}
const UUID = /^[0-9a-f-]{36}$/;
const EMAIL = /^\S+@\S+\.\S+$/;

async function userId(req: Request): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.id === "string" ? u.id : null;
}

async function sendCode(to: string, code: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: MAIL_FROM, name: MAIL_NAME },
      to: [{ email: to }],
      subject: "Il tuo codice di accesso",
      textContent: `Il tuo codice è ${code}\n\nVale 10 minuti e si usa una volta sola. Se non l'hai chiesto tu, ignora questo messaggio.`,
    }),
  });
  if (!r.ok) throw new Error(`mail ${r.status}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail("invalid", "Richiesta non valida.", 405);
  if (!PEPPER || PEPPER.length < 32) return fail("unavailable", "Servizio non ancora configurato.", 503);
  let b: Record<string, any>;
  try {
    b = await req.json();
  } catch {
    return fail("invalid", "Richiesta non valida.", 400);
  }
  const shareId = String(b.shareId ?? "");
  if (!UUID.test(shareId) && b.action !== "forget") return fail("invalid", "Dati non validi.", 400);

  try {
    switch (b.action) {
      case "publish": {
        const uid = await userId(req);
        if (!uid) return fail("unauthorized", "Accesso richiesto.", 401);
        const email = String(b.email ?? "");
        const iv = String(b.iv ?? "");
        const ct = String(b.ct ?? "");
        const rev = Number(b.rev);
        if (!EMAIL.test(email.trim()) || iv.length < 8 || iv.length > 64 || ct.length > 1_500_000 || !Number.isInteger(rev) || rev < 1) return fail("invalid", "Dati non validi.", 400);
        const emailHash = await hashEmail(email);
        const res = await sql.begin(async (tx) => {
          const [prev] = await tx`select professional_id, rev, revoked_at from public.portal_shares where id = ${shareId} for update`;
          if (prev && prev.professional_id !== uid) return "invalid";
          if (prev?.revoked_at) return "revoked";
          if (rev !== (prev?.rev ?? 0) + 1) return "conflict";
          if (prev) await tx`update public.portal_shares set email_hash = ${emailHash}, iv = ${iv}, ct = ${ct} where id = ${shareId}`;
          else await tx`insert into public.portal_shares (id, professional_id, email_hash, iv, ct, rev) values (${shareId}, ${uid}, ${emailHash}, ${iv}, ${ct}, 1)`;
          return "ok";
        });
        if (res === "revoked") return fail("revoked", "Condivisione interrotta.", 409);
        if (res === "conflict") return fail("conflict", "Versione non aggiornata.", 409);
        if (res !== "ok") return fail("invalid", "Dati non validi.", 400);
        return json({ ok: true });
      }
      case "revoke": {
        const uid = await userId(req);
        if (!uid) return fail("unauthorized", "Accesso richiesto.", 401);
        await sql.begin(async (tx) => {
          await tx`update public.portal_shares set revoked_at = now(), iv = '', ct = '' where id = ${shareId} and professional_id = ${uid} and revoked_at is null`;
          await tx`delete from private.portal_otps where share_id = ${shareId}`;
        });
        return json({ ok: true });
      }
      case "forget": {
        const uid = await userId(req);
        if (!uid) return fail("unauthorized", "Accesso richiesto.", 401);
        const ids = (Array.isArray(b.shareIds) ? b.shareIds : []).map(String).filter((s: string) => UUID.test(s));
        if (ids.length) await sql`delete from public.portal_shares where professional_id = ${uid} and id in ${sql(ids)}`;
        return json({ ok: true });
      }
      case "requestCode": {
        const email = String(b.email ?? "");
        if (!BREVO_KEY) return fail("unavailable", "Servizio non ancora configurato.", 503);
        const answer = json({ sent: true });
        if (!EMAIL.test(email.trim())) return answer;
        const [row] = await sql`select email_hash, revoked_at from public.portal_shares where id = ${shareId}`;
        const match = !!row && !row.revoked_at && same(row.email_hash, await hashEmail(email));
        if (!match) return answer;
        const [{ n }] = await sql`select count(*)::int as n from private.portal_otps where share_id = ${shareId} and created_at > now() - interval '1 hour'`;
        if (n >= MAX_CODES_PER_HOUR) return answer;
        const code = newOtp();
        const codeHash = await hashOtp(code, shareId);
        await sql.begin(async (tx) => {
          await tx`delete from private.portal_otps where created_at < now() - interval '1 day'`;
          await tx`update private.portal_otps set used_at = now() where share_id = ${shareId} and used_at is null`;
          await tx`insert into private.portal_otps (share_id, code_hash, expires_at) values (${shareId}, ${codeHash}, now() + ${OTP_MINUTES + " minutes"}::interval)`;
        });
        await sendCode(email.trim(), code);
        return answer;
      }
      case "verify": {
        const email = String(b.email ?? "");
        const code = String(b.code ?? "").replace(/\s/g, "");
        const [share] = await sql`select email_hash, iv, ct, rev, revoked_at from public.portal_shares where id = ${shareId}`;
        if (!share) return fail("not_found", "Questo link non è valido.", 404);
        if (share.revoked_at) return fail("revoked", "Questo link non è più attivo.", 410);
        const outcome = await sql.begin(async (tx) => {
          const [otp] = await tx`select id, code_hash, attempts from private.portal_otps where share_id = ${shareId} and used_at is null and expires_at > now() order by id desc limit 1 for update`;
          if (!otp) return "bad_code";
          if (otp.attempts >= MAX_ATTEMPTS) {
            await tx`update private.portal_otps set used_at = now() where id = ${otp.id}`;
            return "too_many";
          }
          await tx`update private.portal_otps set attempts = attempts + 1 where id = ${otp.id}`;
          const okCode = same(otp.code_hash, await hashOtp(code, shareId));
          const okEmail = same(share.email_hash, await hashEmail(email));
          if (!okCode || !okEmail) return "bad_code";
          await tx`update private.portal_otps set used_at = now() where id = ${otp.id}`;
          return "ok";
        });
        if (outcome === "too_many") return fail("too_many", "Troppi tentativi. Chiedi un codice nuovo.", 429);
        if (outcome !== "ok") return fail("bad_code", "Il codice non è corretto o è scaduto.", 401);
        return json({ iv: share.iv, ct: share.ct, rev: share.rev });
      }
      default:
        return fail("invalid", "Richiesta non valida.", 400);
    }
  } catch (e) {
    console.error("portal error", e instanceof Error ? e.message.replace(/\S+@\S+/g, "[email]") : "errore");
    return fail("unavailable", "Servizio momentaneamente non disponibile.", 503);
  }
});
