import test from "node:test";
import assert from "node:assert/strict";
import { Studio, MemoryBackend } from "../dist/app/store.js";
import { VERSIONS, currentAcceptance, needsAcceptance, changedDocuments, documents, personNotice, placeholdersLeft } from "../dist/app/legal.js";

const PASS = "una frase lunga e segreta";
const FAST = 1000;

test("senza accettazione si deve accettare", () => {
  assert.equal(needsAcceptance(null), true);
  assert.equal(needsAcceptance(currentAcceptance(new Date())), false);
});

test("se cambia un testo si riaccetta e si sa quale", () => {
  const old = { ...currentAcceptance(new Date()), privacyVersion: "2020-01-01" };
  assert.equal(needsAcceptance(old), true);
  assert.deepEqual(changedDocuments(old), ["privacy"]);
});

test("senza le dichiarazioni (maggiorenni, niente dati sanitari) non vale", () => {
  assert.equal(needsAcceptance({ ...currentAcceptance(new Date()), adultOnly: false }), true);
  assert.equal(needsAcceptance({ ...currentAcceptance(new Date()), healthDataExcluded: false }), true);
});

test("l'accettazione sta con l'archivio e sopravvive allo sblocco", async () => {
  const b = new MemoryBackend();
  const { studio } = await Studio.create(b, PASS, FAST, currentAcceptance(new Date("2026-11-24T10:00:00Z")));
  const again = await Studio.unlock(b, { passphrase: PASS });
  assert.equal((await again.acceptance())?.termsVersion, VERSIONS.terms);
  assert.equal(needsAcceptance(await studio.acceptance()), false);
});

test("un archivio creato senza accettazione la richiede", async () => {
  const b = new MemoryBackend();
  const { studio } = await Studio.create(b, PASS, FAST);
  assert.equal(needsAcceptance(await studio.acceptance()), true);
  await studio.accept(currentAcceptance(new Date()));
  assert.equal(needsAcceptance(await studio.acceptance()), false);
});

test("i tre testi esistono, hanno versione e nessuna sezione vuota", () => {
  const docs = documents();
  assert.deepEqual(docs.map((d) => d.key), ["terms", "privacy", "dpa"]);
  for (const d of docs) {
    assert.ok(d.version && d.sections.length >= 4, d.key);
    for (const s of d.sections) assert.ok(s.title && s.paragraphs.every((p) => p.length > 20), d.key + ": " + s.title);
  }
});

test("i segnaposto da compilare sono segnalati", () => {
  assert.deepEqual(placeholdersLeft(), []);
  assert.deepEqual(placeholdersLeft({ operatorName: "x", operatorPlace: "y", vatNumber: "[partita IVA: da compilare]", contactEmail: "[email: da compilare]", region: "UE" }).sort(), ["contactEmail", "vatNumber"]);
  assert.deepEqual(placeholdersLeft({ operatorName: "x", operatorPlace: "y", vatNumber: "IT123", contactEmail: "a@b.it", region: "UE" }), []);
});

test("l'informativa per le persone usa il nome di chi insegna e il contatto", () => {
  const t = personNotice("Giulia Rossi", "giulia@example.it");
  const text = JSON.stringify(t);
  assert.match(text, /Giulia Rossi/);
  assert.match(text, /giulia@example\.it/);
  assert.match(JSON.stringify(personNotice("", "")), /chi ti segue/);
});

test("nuova passphrase: la vecchia non apre più, i dati restano", async () => {
  const b = new MemoryBackend();
  const { studio } = await Studio.create(b, PASS, FAST);
  const p = await studio.save("person", { name: "Anna" });
  await studio.changePassphrase(PASS, "un'altra frase molto lunga");
  await assert.rejects(Studio.unlock(b, { passphrase: PASS }));
  const s2 = await Studio.unlock(b, { passphrase: "un'altra frase molto lunga" });
  assert.equal(s2.get(p.id)?.value.name, "Anna");
});

test("nuovo codice di recupero: il vecchio smette di funzionare", async () => {
  const b = new MemoryBackend();
  const { studio, recoveryCode } = await Studio.create(b, PASS, FAST);
  const fresh = await studio.newRecoveryCode(PASS);
  assert.notEqual(fresh, recoveryCode);
  await assert.rejects(Studio.unlock(b, { recoveryCode }));
  await Studio.unlock(b, { recoveryCode: fresh });
});

test("esportazione in chiaro contiene i dati; quella cifrata no", async () => {
  const b = new MemoryBackend();
  const { studio } = await Studio.create(b, PASS, FAST);
  await studio.save("person", { name: "Marta Segreta" });
  assert.match(JSON.stringify(studio.exportPlain()), /Marta Segreta/);
  const enc = await studio.exportEncrypted();
  assert.doesNotMatch(JSON.stringify(enc), /Marta Segreta/);
  assert.equal(enc.records.length, 1);
});

test("cancellazione totale: niente archivio, niente record", async () => {
  const b = new MemoryBackend();
  const { studio } = await Studio.create(b, PASS, FAST);
  await studio.save("person", { name: "Anna" });
  await studio.eraseEverything();
  assert.equal(await Studio.exists(b), false);
  assert.equal((await b.list()).length, 0);
  assert.equal(studio.list("person").length, 0);
});
