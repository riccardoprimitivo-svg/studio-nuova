import test from "node:test";
import assert from "node:assert/strict";
import { Studio, MemoryBackend } from "../dist/app/store.js";
import { addPerson, addPackage, saveMeeting, deletePerson } from "../dist/app/people.js";
import { summary, lines } from "../dist/app/admin.js";
import { getBook, saveStructure, deleteStructure, addPayment, setWorkData, setUsualSlots, addMaterial, addNotice, safeHttpsUrl, saveProfile, profileValue, saveCatalogItem, listCatalog } from "../dist/app/work.js";

const NOW = new Date("2026-11-24T12:00:00");
const mk = async () => (await Studio.create(new MemoryBackend(), "una frase lunga e segreta", 1000)).studio;
const meet = (s, pid, pk, at, att = "none", extra = {}) =>
  saveMeeting(s, pid, { at, attendance: att, privateNote: "", sharedReport: "", packageId: pk, ...extra });

test("percorso a pacchetto: prezzo diviso per gli incontri, assente non retribuito non vale", async () => {
  const s = await mk();
  const p = await addPerson(s, { name: "Anna" });
  const pk = await addPackage(s, p.id, { title: "", total: 4, startedAt: "2026-11-01", price: 200 });
  await meet(s, p.id, pk.id, "2026-11-03T10:00");
  await meet(s, p.id, pk.id, "2026-11-10T10:00", "absent_paid");
  await meet(s, p.id, pk.id, "2026-11-17T10:00", "absent_unpaid");
  await meet(s, p.id, pk.id, "2026-11-30T10:00"); // in programma
  const r = summary(getBook(s), NOW);
  assert.equal(r.registered, 100); // 2 x 50
  assert.equal(r.month.planned, 50);
  assert.equal(r.month.estimate, 150);
});

test("senza pacchetto vale la tariffa della persona", async () => {
  const s = await mk();
  const p = await addPerson(s, { name: "Luca" });
  await setWorkData(s, p.id, { city: "", subjects: "", structureId: null, rate: 40, driveUrl: "" });
  await meet(s, p.id, null, "2026-11-02T09:00");
  assert.equal(summary(getBook(s), NOW).registered, 40);
});

test("struttura a ora usa la durata dell'incontro, o quella abituale", async () => {
  const s = await mk();
  const st = await saveStructure(s, { name: "Scuola", mode: "per_hour", amount: 30, minutes: 45 });
  const p = await addPerson(s, { name: "Marta" });
  await setWorkData(s, p.id, { city: "", subjects: "", structureId: st.id, rate: 0, driveUrl: "" });
  await meet(s, p.id, null, "2026-11-02T09:00"); // 45 min -> 22.5
  await meet(s, p.id, null, "2026-11-09T09:00", "none", { minutes: 90 }); // 45
  assert.equal(summary(getBook(s), NOW).registered, 67.5);
});

test("struttura al mese: una quota per ogni mese con almeno un incontro", async () => {
  const s = await mk();
  const st = await saveStructure(s, { name: "Centro", mode: "per_month", amount: 300, minutes: 60 });
  const a = await addPerson(s, { name: "A" });
  const b = await addPerson(s, { name: "B" });
  for (const p of [a, b]) await setWorkData(s, p.id, { city: "", subjects: "", structureId: st.id, rate: 0, driveUrl: "" });
  await meet(s, a.id, null, "2026-10-05T10:00");
  await meet(s, b.id, null, "2026-10-12T10:00");
  await meet(s, a.id, null, "2026-11-05T10:00");
  await meet(s, a.id, null, "2026-12-05T10:00"); // futuro
  const r = summary(getBook(s), NOW);
  assert.equal(r.registered, 600); // ottobre e novembre
  assert.equal(r.month.estimate, 300);
});

test("incassato, residuo e anticipi", async () => {
  const s = await mk();
  const p = await addPerson(s, { name: "Anna" });
  await setWorkData(s, p.id, { city: "", subjects: "", structureId: null, rate: 50, driveUrl: "" });
  await meet(s, p.id, null, "2026-11-02T09:00");
  await meet(s, p.id, null, "2026-11-09T09:00");
  await addPayment(s, { ownerKind: "person", ownerId: p.id, amount: 30, at: "2026-11-10", note: "" });
  let r = summary(getBook(s), NOW);
  assert.deepEqual([r.registered, r.collected, r.residual], [100, 30, 70]);
  await addPayment(s, { ownerKind: "person", ownerId: p.id, amount: 100, at: "2026-11-11", note: "anticipo" });
  r = summary(getBook(s), NOW);
  assert.equal(r.residual, -30);
});

test("pagamenti: importo > 0, data valida, proprietario esistente", async () => {
  const s = await mk();
  const p = await addPerson(s, { name: "Anna" });
  const base = { ownerKind: "person", ownerId: p.id, amount: 10, at: "2026-11-10", note: "" };
  await assert.rejects(addPayment(s, { ...base, amount: 0 }));
  await assert.rejects(addPayment(s, { ...base, amount: -5 }));
  await assert.rejects(addPayment(s, { ...base, at: "ieri" }));
  await assert.rejects(addPayment(s, { ...base, ownerId: "inesistente" }));
});

test("eliminare una persona toglie anche i suoi pagamenti; eliminare una struttura libera le persone", async () => {
  const s = await mk();
  const st = await saveStructure(s, { name: "Scuola", mode: "per_meeting", amount: 25, minutes: 60 });
  const p = await addPerson(s, { name: "Anna" });
  await setWorkData(s, p.id, { city: "", subjects: "", structureId: st.id, rate: 0, driveUrl: "" });
  await addPayment(s, { ownerKind: "structure", ownerId: st.id, amount: 50, at: "2026-11-10", note: "" });
  await deleteStructure(s, st.id);
  assert.equal(s.list("payment").length, 0);
  assert.equal(s.get(p.id).value.structureId, null);
  await addPayment(s, { ownerKind: "person", ownerId: p.id, amount: 5, at: "2026-11-10", note: "" });
  await deletePerson(s, p.id);
  assert.equal(s.list("payment").length, 0);
});

test("strutture: niente doppioni, importi validi", async () => {
  const s = await mk();
  await saveStructure(s, { name: "Scuola Rossi", mode: "per_meeting", amount: 20, minutes: 60 });
  await assert.rejects(saveStructure(s, { name: "scuola  rossi", mode: "per_meeting", amount: 20, minutes: 60 }));
  await assert.rejects(saveStructure(s, { name: "Altra", mode: "per_meeting", amount: -1, minutes: 60 }));
  await assert.rejects(saveStructure(s, { name: "", mode: "per_meeting", amount: 1, minutes: 60 }));
});

test("orari abituali: massimo 14, niente doppi, orari validi", async () => {
  const s = await mk();
  const p = await addPerson(s, { name: "Anna" });
  const many = Array.from({ length: 15 }, (_, i) => ({ weekday: (i % 7) + 1, time: `${String(8 + Math.floor(i / 7)).padStart(2, "0")}:${i % 2 ? "30" : "00"}` }));
  await assert.rejects(setUsualSlots(s, p.id, many));
  await assert.rejects(setUsualSlots(s, p.id, [{ weekday: 8, time: "10:00" }]));
  await assert.rejects(setUsualSlots(s, p.id, [{ weekday: 1, time: "25:00" }]));
  await setUsualSlots(s, p.id, [{ weekday: 3, time: "16:00" }, { weekday: 1, time: "10:00" }, { weekday: 1, time: "10:00" }]);
  assert.deepEqual(s.get(p.id).value.usualSlots, [{ weekday: 1, time: "10:00" }, { weekday: 3, time: "16:00" }]);
});

test("collegamenti: solo https", async () => {
  assert.equal(safeHttpsUrl(""), "");
  assert.match(safeHttpsUrl("https://drive.google.com/x"), /^https:\/\//);
  for (const bad of ["http://a.it", "javascript:alert(1)", "ftp://a.it", "non un link", "data:text/html,x"]) assert.throws(() => safeHttpsUrl(bad), bad);
  const s = await mk();
  const p = await addPerson(s, { name: "Anna" });
  await assert.rejects(addMaterial(s, p.id, { title: "x", url: "http://a.it" }));
  await addMaterial(s, p.id, { title: "", url: "https://example.org/scheda.pdf" });
  assert.equal(s.get(p.id).value.materials[0].title, "example.org");
});

test("avvisi: testo obbligatorio", async () => {
  const s = await mk();
  const p = await addPerson(s, { name: "Anna" });
  await assert.rejects(addNotice(s, p.id, "   "));
  await addNotice(s, p.id, "Giovedì ci vediamo online");
  assert.equal(s.get(p.id).value.notices.length, 1);
});

test("profilo: recapiti condivisi solo se scelti e presenti", async () => {
  const s = await mk();
  await saveProfile(s, { displayName: "Riccardo", bio: "", email: "", phone: "333", shareEmail: true, sharePhone: true });
  const p = profileValue(s);
  assert.equal(p.shareEmail, false); // senza email non si condivide
  assert.equal(p.sharePhone, true);
  await saveProfile(s, { ...p, displayName: "Riccardo F." });
  assert.equal(s.list("setting").length, 1); // aggiorna, non duplica
});

test("catalogo dei percorsi: niente doppioni", async () => {
  const s = await mk();
  await saveCatalogItem(s, { title: "Check Vocale", total: 1, price: 60 });
  await assert.rejects(saveCatalogItem(s, { title: "check vocale", total: 1, price: 60 }));
  assert.equal(listCatalog(s).length, 1);
});

test("righe: persona eliminata o senza compenso non rompe i conti", async () => {
  const s = await mk();
  const p = await addPerson(s, { name: "Anna" });
  await meet(s, p.id, null, "2026-11-02T09:00");
  assert.equal(summary(getBook(s), NOW).registered, 0);
  assert.equal(lines(getBook(s), NOW).length, 1);
});
