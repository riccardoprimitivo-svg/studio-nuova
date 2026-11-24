import test from "node:test";
import assert from "node:assert/strict";
import { RemotePortalServer } from "../dist/app/portal-remote.js";
import { PortalError } from "../dist/app/portal-server.js";

const id = "11111111-2222-3333-4444-555555555555";
function server(reply, token = "tok") {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  };
  return { calls, s: new RemotePortalServer({ url: "https://x.supabase.co/", publicKey: "pub", accessToken: async () => token, fetchFn }) };
}

test("pubblica con la sessione del professionista", async () => {
  const { s, calls } = server({ status: 200, body: { ok: true } });
  await s.publish(id, { email: "a@b.it", sealed: { iv: "iviviviv", ct: "ct" }, rev: 1 });
  assert.equal(calls[0].url, "https://x.supabase.co/functions/v1/portal");
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  assert.equal(calls[0].body.action, "publish");
});

test("il portale della persona usa solo la chiave pubblica", async () => {
  const { s, calls } = server({ status: 200, body: { sent: true } });
  const r = await s.requestCode(id, "a@b.it");
  assert.equal(r.sent, true);
  assert.equal(r.demoCode, undefined);
  assert.equal(calls[0].init.headers.authorization, "Bearer pub");
});

test("verify restituisce il pacchetto", async () => {
  const { s } = server({ status: 200, body: { iv: "i", ct: "c", rev: 3 } });
  assert.deepEqual(await s.verify(id, "a@b.it", "12345678"), { sealed: { iv: "i", ct: "c" }, rev: 3 });
});

test("gli errori del server diventano PortalError con il codice giusto", async () => {
  const { s } = server({ status: 401, body: { error: "bad_code", message: "Il codice non è corretto o è scaduto." } });
  await assert.rejects(() => s.verify(id, "a@b.it", "1"), (e) => e instanceof PortalError && e.code === "bad_code");
  const { s: s2 } = server({ status: 409, body: { error: "conflict", message: "x" } });
  await assert.rejects(() => s2.publish(id, { email: "a@b.it", sealed: { iv: "iviviviv", ct: "c" }, rev: 2 }), (e) => e.code === "conflict");
});

test("senza sessione il professionista non pubblica", async () => {
  const { s, calls } = server({ status: 200, body: {} }, null);
  await assert.rejects(() => s.publish(id, { email: "a@b.it", sealed: { iv: "iviviviv", ct: "c" }, rev: 1 }), (e) => e instanceof PortalError);
  assert.equal(calls.length, 0);
});
