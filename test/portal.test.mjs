import test from "node:test";
import assert from "node:assert/strict";
import { Studio, MemoryBackend } from "../dist/app/store.js";
import { addPerson, addPackage, saveMeeting } from "../dist/app/people.js";
import { setWorkData, addNotice, addMaterial, saveProfile } from "../dist/app/work.js";
import { buildPackage } from "../dist/app/portal.js";
import { Sharing } from "../dist/app/sharing.js";
import { LocalPortalServer, MemoryKV, PortalError, MAX_ATTEMPTS } from "../dist/app/portal-server.js";
import { parseInviteLink, openPackage } from "../dist/share.js";

const NOW = new Date("2026-11-24T12:00:00");
const BASE = "https://studio.example/";

async function setup() {
  const { studio } = await Studio.create(new MemoryBackend(), "una frase lunga e segreta", 1000);
  const kv = new MemoryKV();
  let clock = Date.now();
  const server = new LocalPortalServer(kv, () => clock);
  const sharing = new Sharing(studio, server, BASE, () => NOW);
  const p = await addPerson(studio, { name: "Anna Verdi", email: "anna@example.it", phone: "3331112222", goal: "Cantare in coro", remember: "SEGRETO-REMEMBER" });
  await setWorkData(studio, p.id, { city: "", subjects: "", structureId: null, rate: 777, driveUrl: "https://drive.example/cartella" });
  const pk = await addPackage(studio, p.id, { title: "Percorso base", total: 4, startedAt: "2026-11-01", price: 888 });
  await saveMeeting(studio, p.id, { at: "2026-11-03T10:00", attendance: "present", privateNote: "NOTA-PRIVATA", sharedReport: "Lavorato sul respiro", packageId: pk.id });
  await saveMeeting(studio, p.id, { at: "2026-11-30T10:00", attendance: "none", privateNote: "ALTRA-NOTA-PRIVATA", sharedReport: "", packageId: pk.id });
  await addNotice(studio, p.id, "Porta un quaderno");
  await addMaterial(studio, p.id, { title: "Scheda", url: "https://example.org/scheda.pdf" });
  await saveProfile(studio, { displayName: "Riccardo", bio: "Insegno canto", email: "r@example.it", phone: "3339998888", shareEmail: true, sharePhone: false });
  return { studio, kv, server, sharing, p, setClock: (t) => (clock = t), clock: () => clock };
}

test("il pacchetto non contiene mai note private, tariffe, prezzi, recapiti della persona", async () => {
  const { studio, p } = await setup();
  const json = JSON.stringify(buildPackage(studio, p.id, NOW));
  for (const banned of ["NOTA-PRIVATA", "ALTRA-NOTA-PRIVATA", "SEGRETO-REMEMBER", "777", "888", "anna@example.it", "3331112222", "3339998888"]) {
    assert.ok(!json.includes(banned), `non deve contenere ${banned}`);
  }
  assert.match(json, /Lavorato sul respiro/);
  assert.match(json, /r@example\.it/); // recapito di chi insegna, scelto
});

test("il pacchetto mostra percorso, prossimo incontro, avvisi, materiali, cartella", async () => {
  const { studio, p } = await setup();
  const pkg = buildPackage(studio, p.id, NOW);
  assert.deepEqual([pkg.path.done, pkg.path.planned, pkg.path.left, pkg.path.total], [1, 1, 2, 4]);
  assert.equal(pkg.nextMeeting, "2026-11-30T10:00");
  assert.equal(pkg.notices[0].text, "Porta un quaderno");
  assert.equal(pkg.materials[0].url, "https://example.org/scheda.pdf");
  assert.equal(pkg.driveUrl, "https://drive.example/cartella");
  assert.equal(pkg.history.length, 1); // solo gli incontri passati
});

test("giro completo: abilita, link, codice, apertura con la chiave del link", async () => {
  const { sharing, server, p } = await setup();
  const link = await sharing.enable(p.id);
  const { shareId, raw } = parseInviteLink(link);
  const { demoCode } = await server.requestCode(shareId, "Anna@Example.it ");
  assert.match(demoCode, /^\d{8}$/);
  const { sealed, rev } = await server.verify(shareId, "anna@example.it", demoCode);
  const pkg = await openPackage(raw, shareId, rev, sealed);
  assert.equal(pkg.name, "Anna Verdi");
});

test("il server non ha chiave, email in chiaro né contenuto", async () => {
  const { sharing, kv, p } = await setup();
  const link = await sharing.enable(p.id);
  const { raw } = parseInviteLink(link);
  const all = JSON.stringify([...kv.m]);
  for (const banned of ["anna@example.it", "Anna Verdi", "Lavorato sul respiro", Buffer.from(raw).toString("base64"), Buffer.from(raw).toString("hex")]) assert.ok(!all.includes(banned), banned);
});

test("email o codice sbagliati: nessuna informazione in più, tentativi limitati", async () => {
  const { sharing, server, p } = await setup();
  const { shareId } = parseInviteLink(await sharing.enable(p.id));
  const wrong = await server.requestCode(shareId, "altra@example.it");
  assert.deepEqual(Object.keys(wrong), ["sent"]); // stessa risposta, nessun codice
  await assert.rejects(server.verify(shareId, "altra@example.it", "00000000"), (e) => e instanceof PortalError && e.code === "bad_code");
  const { demoCode } = await server.requestCode(shareId, "anna@example.it");
  const bad = demoCode === "11111111" ? "22222222" : "11111111";
  for (let i = 0; i < MAX_ATTEMPTS; i++) await assert.rejects(server.verify(shareId, "anna@example.it", bad));
  await assert.rejects(server.verify(shareId, "anna@example.it", demoCode), (e) => e instanceof PortalError && e.code === "too_many");
});

test("il codice è monouso e scade", async () => {
  const { sharing, server, p, setClock, clock } = await setup();
  const { shareId } = parseInviteLink(await sharing.enable(p.id));
  let { demoCode } = await server.requestCode(shareId, "anna@example.it");
  await server.verify(shareId, "anna@example.it", demoCode);
  await assert.rejects(server.verify(shareId, "anna@example.it", demoCode)); // già usato
  ({ demoCode } = await server.requestCode(shareId, "anna@example.it"));
  setClock(clock() + 11 * 60_000);
  await assert.rejects(server.verify(shareId, "anna@example.it", demoCode)); // scaduto
});

test("interrompere la condivisione chiude subito il link; il nuovo link funziona", async () => {
  const { sharing, server, p } = await setup();
  const old = parseInviteLink(await sharing.enable(p.id));
  await sharing.disable(p.id);
  assert.equal(sharing.of(p.id), null);
  const { demoCode } = await server.requestCode(old.shareId, "anna@example.it");
  assert.equal(demoCode, undefined);
  await assert.rejects(server.verify(old.shareId, "anna@example.it", "12345678"), (e) => e.code === "revoked");
  const fresh = parseInviteLink(await sharing.enable(p.id));
  assert.notEqual(fresh.shareId, old.shareId);
});

test("serve l'email della persona per condividere", async () => {
  const { studio, sharing } = await setup();
  const q = await addPerson(studio, { name: "Senza Email" });
  await assert.rejects(sharing.enable(q.id));
  const r = await addPerson(studio, { name: "Email Rotta", email: "non-una-email" });
  await assert.rejects(sharing.enable(r.id));
});

test("aggiornamento automatico: pubblica quando cambia qualcosa, non ripubblica se non cambia nulla", async () => {
  const { studio, sharing, server, p } = await setup();
  const { shareId, raw } = parseInviteLink(await sharing.enable(p.id));
  assert.equal(sharing.of(p.id).value.rev, 1);
  await sharing.sync();
  assert.equal(sharing.of(p.id).value.rev, 1); // nessun cambiamento, nessuna nuova versione
  await addNotice(studio, p.id, "Nuovo avviso");
  await sharing.sync();
  assert.equal(sharing.of(p.id).value.rev, 2);
  const { demoCode } = await server.requestCode(shareId, "anna@example.it");
  const { sealed, rev } = await server.verify(shareId, "anna@example.it", demoCode);
  const pkg = await openPackage(raw, shareId, rev, sealed);
  assert.equal(pkg.notices[0].text, "Nuovo avviso");
});

test("una nota privata modificata non fa ripubblicare nulla", async () => {
  const { studio, sharing, p } = await setup();
  await sharing.enable(p.id);
  const m = studio.list("meeting").find((x) => x.value.privateNote === "NOTA-PRIVATA");
  await studio.save("meeting", { ...m.value, privateNote: "cambiata, sempre privata" }, m.id);
  await sharing.sync();
  assert.equal(sharing.of(p.id).value.rev, 1);
});

test("con la chiave sbagliata o la versione sbagliata il pacchetto non si apre", async () => {
  const { sharing, server, p } = await setup();
  const { shareId, raw } = parseInviteLink(await sharing.enable(p.id));
  const { demoCode } = await server.requestCode(shareId, "anna@example.it");
  const { sealed, rev } = await server.verify(shareId, "anna@example.it", demoCode);
  await assert.rejects(openPackage(new Uint8Array(32), shareId, rev, sealed));
  await assert.rejects(openPackage(raw, shareId, rev + 1, sealed));
  await assert.rejects(openPackage(raw, "00000000-0000-0000-0000-000000000000", rev, sealed));
});
