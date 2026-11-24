import test from "node:test";
import assert from "node:assert/strict";
import { Studio, MemoryBackend } from "../dist/app/store.js";
import { addPerson, updatePerson, deletePerson, addPackage, saveMeeting, activePackage, nextMeeting } from "../dist/app/people.js";
import { packageProgress, nameKey, initials } from "../dist/app/model.js";

const FAST = 1000; // iterazioni ridotte: qui si prova la logica, non la forza della chiave
const PASS = "una frase lunga abbastanza";
const mk = async (backend = new MemoryBackend()) => ({ backend, ...(await Studio.create(backend, PASS, FAST)) });
const iso = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const days = (n) => iso(new Date(Date.now() + n * 86400000));

test("persona: crea, rilegge dopo riapertura, il server vede solo blob", async () => {
  const { backend, studio } = await mk();
  const p = await addPerson(studio, { name: "Giulia Rossi", remember: "allergia al polline, canta in coro" });
  const raw = JSON.stringify([...backend.rows.values()]);
  assert.ok(!raw.includes("Giulia") && !raw.includes("polline"), "niente testo in chiaro");
  const again = await Studio.unlock(backend, { passphrase: PASS });
  assert.equal(again.get(p.id).value.name, "Giulia Rossi");
});

test("niente doppioni, anche con maiuscole e accenti diversi", async () => {
  const { studio } = await mk();
  await addPerson(studio, { name: "Élodie  Bianchi" });
  await assert.rejects(addPerson(studio, { name: "elodie bianchi" }), /già tra le persone/);
  const b = await addPerson(studio, { name: "Marco Verdi" });
  await assert.rejects(updatePerson(studio, b.id, { name: "ELODIE BIANCHI" }), /già tra le persone/);
  await updatePerson(studio, b.id, { name: "Marco Verdi", goal: "estensione" }); // lo stesso nome su se stesso va bene
  assert.equal(studio.get(b.id).value.goal, "estensione");
  assert.equal(nameKey("Ça  va"), "ca va");
  assert.equal(initials("anna maria de luca"), "AL");
});

test("nome obbligatorio, il resto no", async () => {
  const { studio } = await mk();
  await assert.rejects(addPerson(studio, { name: "   " }), /nome/);
  const p = await addPerson(studio, { name: "Solo Nome" });
  assert.equal(p.value.email, "");
});

test("percorso: conteggio automatico e recuperi", async () => {
  const { studio } = await mk();
  const p = await addPerson(studio, { name: "Luca Neri" });
  const pk = await addPackage(studio, p.id, { title: "Dieci incontri", total: 5, startedAt: days(-40).slice(0, 10) });
  const m = (at, attendance) => saveMeeting(studio, p.id, { at, attendance, privateNote: "", sharedReport: "", packageId: pk.id });
  await m(days(-21), "present");
  await m(days(-14), "absent_paid");     // conta
  await m(days(-7), "absent_unpaid");    // non conta, da recuperare
  await m(days(-1), "none");             // passato, presenza non indicata: conta
  await m(days(3), "none");              // in programma
  const meetings = studio.list("meeting").map((e) => e.value);
  const pr = packageProgress(pk.value, meetings, pk.id, new Date());
  assert.deepEqual(pr, { total: 5, done: 3, planned: 1, left: 1, toRecover: 1 });
  assert.equal(activePackage(studio, p.id, new Date()).pkg.id, pk.id);
  assert.equal(nextMeeting(studio, p.id, new Date()).value.at, days(3));
});

test("percorso completo non è più attivo; incontri oltre il totale non vanno sotto zero", async () => {
  const { studio } = await mk();
  const p = await addPerson(studio, { name: "Sara Gallo" });
  const pk = await addPackage(studio, p.id, { title: "Breve", total: 2, startedAt: days(-30).slice(0, 10) });
  for (const d of [-10, -9, -8]) await saveMeeting(studio, p.id, { at: days(d), attendance: "present", privateNote: "", sharedReport: "", packageId: pk.id });
  const pr = packageProgress(pk.value, studio.list("meeting").map((e) => e.value), pk.id, new Date());
  assert.equal(pr.left, 0);
  assert.equal(activePackage(studio, p.id, new Date()), null);
});

test("si salva anche con note vuote; data non valida rifiutata; totale non valido rifiutato", async () => {
  const { studio } = await mk();
  const p = await addPerson(studio, { name: "Tina Blu" });
  await saveMeeting(studio, p.id, { at: days(1), attendance: "none", privateNote: "", sharedReport: "", packageId: null });
  await assert.rejects(saveMeeting(studio, p.id, { at: "domani", attendance: "none", privateNote: "", sharedReport: "", packageId: null }), /non valide/);
  await assert.rejects(addPackage(studio, p.id, { title: "x", total: 0, startedAt: "2026-01-01" }), /tra 1 e 200/);
  await assert.rejects(addPackage(studio, p.id, { title: "x", total: 2.5, startedAt: "2026-01-01" }), /tra 1 e 200/);
});

test("eliminare una persona porta via incontri e percorsi, non quelli degli altri", async () => {
  const { backend, studio } = await mk();
  const a = await addPerson(studio, { name: "A Uno" });
  const b = await addPerson(studio, { name: "B Due" });
  for (const x of [a, b]) {
    const pk = await addPackage(studio, x.id, { title: "P", total: 3, startedAt: "2026-01-01" });
    await saveMeeting(studio, x.id, { at: days(-2), attendance: "present", privateNote: "n", sharedReport: "", packageId: pk.id });
  }
  await deletePerson(studio, a.id);
  assert.equal(studio.list("person").length, 1);
  assert.equal(studio.list("meeting").length, 1);
  assert.equal(studio.list("package").length, 1);
  assert.equal(backend.rows.size, 3);
});

test("passphrase sbagliata e codice di recupero", async () => {
  const { backend, recoveryCode, studio } = await mk();
  const p = await addPerson(studio, { name: "Zeta" });
  await assert.rejects(Studio.unlock(backend, { passphrase: "tutt'altra frase lunga" }));
  const s2 = await Studio.unlock(backend, { recoveryCode });
  assert.equal(s2.get(p.id).value.name, "Zeta");
});

test("un record spostato di tipo o di id non si apre (AAD)", async () => {
  const { backend, studio } = await mk();
  const p = await addPerson(studio, { name: "Anna" });
  const row = backend.rows.get(p.id);
  backend.rows.set(p.id, { ...row, kind: "meeting" });
  await assert.rejects(Studio.unlock(backend, { passphrase: PASS }));
});
