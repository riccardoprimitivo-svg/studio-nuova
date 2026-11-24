import test from "node:test";
import assert from "node:assert/strict";
import { Auth, SupabaseBackend, CloudError, cloudConfig } from "../dist/app/cloud.js";
import { Studio } from "../dist/app/store.js";

globalThis.localStorage ??= (() => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
})();

const clean = () => localStorage.removeItem("studio-auth:session");
const cfg = { url: "https://x.supabase.co", publishableKey: "pub" };
const UID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Un Supabase finto: auth + tabelle in memoria, con il controllo "ognuno vede le sue righe". */
function fake() {
  const db = { professionals: new Map(), vaults: new Map(), records: new Map() };
  const calls = [];
  clean();
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname + u.search, init, body });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (u.pathname === "/auth/v1/token") {
      if (u.searchParams.get("grant_type") === "password") {
        if (body.password !== "password-lunga") return reply(400, { error_code: "invalid_credentials" });
        return reply(200, { access_token: "A1", refresh_token: "R1", expires_in: 3600, user: { id: UID, email: body.email } });
      }
      return reply(200, { access_token: "A2", refresh_token: "R2", expires_in: 3600, user: { id: UID, email: "a@b.it" } });
    }
    if (u.pathname === "/auth/v1/signup") return reply(200, { id: UID, email: body.email });
    if (u.pathname === "/auth/v1/logout") return reply(204, {});
    if (u.pathname === "/auth/v1/recover") return reply(200, {});
    if (u.pathname === "/auth/v1/user") {
      if (!init.headers.authorization?.startsWith("Bearer L")) return reply(401, {});
      if (init.method === "PUT") return reply(body.password === "uguale-alla-vecchia" ? 422 : body.password.length < 10 ? 422 : 200, body.password === "uguale-alla-vecchia" ? { error_code: "same_password" } : body.password.length < 10 ? { error_code: "weak_password" } : { id: UID, email: "a@b.it" });
      return reply(200, { id: UID, email: "a@b.it" });
    }
    if (!init.headers.authorization?.startsWith("Bearer A")) return reply(401, {});
    const table = u.pathname.replace("/rest/v1/", "");
    const t = db[table];
    const key = table === "vaults" ? "professional_id" : "id";
    if (init.method === "POST") {
      const prev = t.get(body[key]) ?? {};
      t.set(body[key], { ...prev, ...body, updated_at: "2026-11-24T10:00:00Z" });
      return reply(201, null);
    }
    if (init.method === "DELETE") {
      const id = u.searchParams.get("id")?.replace("eq.", "");
      t.delete(id);
      if (table === "professionals") {
        db.vaults.delete(id);
        for (const [k, r] of db.records) if (r.professional_id === id) db.records.delete(k);
      }
      return reply(204, null);
    }
    const rows = [...t.values()].filter((r) => (r.professional_id ?? r.id) === UID);
    return reply(200, rows);
  };
  return { db, calls, fetchFn };
}

test("la configurazione manca o è completa", () => {
  assert.equal(cloudConfig({}), null);
  assert.equal(cloudConfig({ STUDIO_CONFIG: { url: "https://x.co/" } }), null);
  assert.deepEqual(cloudConfig({ STUDIO_CONFIG: { url: "https://x.co/", publishableKey: "k" } }), { url: "https://x.co", publishableKey: "k" });
});

test("accesso, errore chiaro e uscita", async () => {
  const { fetchFn } = fake();
  const auth = new Auth(cfg, fetchFn);
  await assert.rejects(() => auth.signIn("a@b.it", "sbagliata"), (e) => e instanceof CloudError && e.code === "credentials");
  assert.equal(auth.signedIn, false);
  await auth.signIn(" a@b.it ", "password-lunga");
  assert.equal(auth.userId, UID);
  assert.equal(await auth.accessToken(), "A1");
  await auth.signOut();
  assert.equal(auth.signedIn, false);
  assert.equal(await auth.accessToken(), null);
});

test("il token si rinnova quando sta per scadere", async () => {
  const { fetchFn } = fake();
  let t = 1000;
  const auth = new Auth(cfg, fetchFn, () => t);
  await auth.signIn("a@b.it", "password-lunga");
  assert.equal(await auth.accessToken(), "A1");
  t += 3600;
  assert.equal(await auth.accessToken(), "A2");
});

test("iscrizione con conferma via email", async () => {
  const { fetchFn } = fake();
  assert.equal(await new Auth(cfg, fetchFn).signUp("a@b.it", "password-lunga"), "confirm");
});

test("senza account non si apre l'archivio", async () => {
  const { fetchFn } = fake();
  assert.throws(() => new SupabaseBackend(new Auth(cfg, fetchFn), fetchFn), CloudError);
});

test("crea, salva, riapre da un altro dispositivo e cancella: sul server solo dati cifrati", async () => {
  const { db, fetchFn } = fake();
  const auth = new Auth(cfg, fetchFn);
  await auth.signIn("a@b.it", "password-lunga");
  const backend = new SupabaseBackend(auth, fetchFn);
  assert.equal(await Studio.exists(backend), false);
  const { studio } = await Studio.create(backend, "una passphrase lunga", 1000, { termsVersion: "t", privacyVersion: "p", dpaVersion: "d", adultOnly: true, healthDataExcluded: true, at: "2026-11-24T10:00:00Z" });
  assert.equal(studio.professionalId, UID, "l'identità è quella dell'account");
  const p = await studio.save("person", { name: "Marta", remember: "nota segreta" });
  const raw = JSON.stringify([...db.records.values()]);
  assert.ok(!raw.includes("Marta") && !raw.includes("nota segreta"), "il server non vede il contenuto");
  assert.equal(db.professionals.get(UID).terms_version, "t");

  // altro dispositivo: backend nuovo, stessa sessione
  const second = new SupabaseBackend(auth, fetchFn);
  assert.equal(await Studio.exists(second), true);
  await assert.rejects(() => Studio.unlock(second, { passphrase: "sbagliata sbagliata" }));
  const again = await Studio.unlock(second, { passphrase: "una passphrase lunga" });
  assert.equal(again.get(p.id).value.name, "Marta");
  assert.equal((await again.acceptance()).termsVersion, "t");

  await again.remove(p.id);
  assert.equal(db.records.size, 0);
  await again.eraseEverything();
  assert.equal(db.professionals.size + db.vaults.size, 0);
  assert.equal(await Studio.exists(new SupabaseBackend(auth, fetchFn)), false);
});

test("con la sessione scaduta il salvataggio fallisce con un messaggio chiaro", async () => {
  const { fetchFn } = fake();
  const auth = new Auth(cfg, fetchFn);
  await auth.signIn("a@b.it", "password-lunga");
  const backend = new SupabaseBackend(auth, fetchFn);
  await auth.signOut();
  await assert.rejects(() => backend.list(), (e) => e instanceof CloudError && e.code === "denied");
});

test("il link dell'email: lettura dell'indirizzo ed ingresso", async () => {
  const t = Auth.readHash("#access_token=Lx&refresh_token=Ry&expires_in=3600&token_type=bearer&type=recovery");
  assert.deepEqual(t, { type: "recovery", accessToken: "Lx", refreshToken: "Ry", expiresIn: 3600 });
  assert.equal(Auth.readHash("#error=access_denied&error_code=otp_expired&error_description=x").error, "otp_expired");
  assert.deepEqual(Auth.readHash(""), {});
  const { fetchFn } = fake();
  const auth = new Auth(cfg, fetchFn);
  await auth.adopt({ accessToken: "Lx", refreshToken: "Ry", expiresIn: 3600 });
  assert.equal(auth.userId, UID);
  assert.equal(await auth.accessToken(), "Lx");
  const bad = new Auth(cfg, fetchFn);
  await bad.signOut();
  await assert.rejects(() => bad.adopt({ accessToken: "zzz", refreshToken: "r" }), CloudError);
});

test("password dimenticata: la richiesta non rivela nulla; la nuova password va rispettata", async () => {
  const { fetchFn, calls } = fake();
  const auth = new Auth(cfg, fetchFn);
  await auth.requestReset("qualcuno@esempio.it");
  assert.ok(calls.some((c) => c.path === "/auth/v1/recover"));
  await auth.adopt({ accessToken: "Lx", refreshToken: "Ry" });
  await assert.rejects(() => auth.changePassword("corta"), (e) => e.code === "weak");
  await auth.changePassword("una-password-lunga");
  await auth.changePassword("uguale-alla-vecchia"); // stessa password: non è un errore
  assert.ok(calls.some((c) => c.init.method === "PUT"));
});
