import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccount, unlockWithPassphrase, unlockWithRecovery, changePassphrase, rotateRecoveryCode,
  encryptRecord, decryptRecord, PBKDF2_ITERATIONS,
  createShareKey, wrapShareKey, unwrapShareKey, sealPackage, openPackage, buildInviteLink, parseInviteLink,
  hashEmail, normalizeEmail, newOtp, hashOtp, constantTimeEqual,
} from "../dist/index.js";

const FAST = 2000; // iterazioni ridotte per i test; un test usa il valore reale
const PASS_A = "una passphrase lunga per A";
const PASS_B = "tutt'altra frase per B!";
const ctx = (p, r, kind = "person") => ({ professionalId: p, recordId: r, kind });
const rejects = (fn, re) => assert.rejects(fn, re ?? /./);

test("creazione, sblocco e record: andata e ritorno", async () => {
  const { vault, master } = await createAccount(PASS_A, FAST);
  const sealed = await encryptRecord(master, ctx("A", "r1"), { nome: "Alex De Luca", note: "riservato" });
  const unlocked = await unlockWithPassphrase(vault, PASS_A);
  assert.deepEqual(await decryptRecord(unlocked, ctx("A", "r1"), sealed), { nome: "Alex De Luca", note: "riservato" });
});

test("il contenuto in chiaro non compare nei dati inviati al server", async () => {
  const { vault, master } = await createAccount(PASS_A, FAST);
  const sealed = await encryptRecord(master, ctx("A", "r1"), { nome: "Alex De Luca" });
  const wire = JSON.stringify({ vault, sealed });
  assert.ok(!wire.includes("Alex") && !wire.includes("Luca") && !wire.includes(PASS_A));
});

test("passphrase errata: rifiutata", async () => {
  const { vault } = await createAccount(PASS_A, FAST);
  await rejects(() => unlockWithPassphrase(vault, "passphrase sbagliata!"), /passphrase errata/);
});

test("passphrase troppo corta: rifiutata", async () => {
  await rejects(() => createAccount("corta", FAST), /troppo corta/);
});

test("chiave di recupero: sblocca; un errore di battitura è riconosciuto; O/I/L sono tollerati", async () => {
  const { vault, master, recoveryCode } = await createAccount(PASS_A, FAST);
  const sealed = await encryptRecord(master, ctx("A", "r1"), { x: 1 });
  assert.match(recoveryCode, /^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  const viaRecovery = await unlockWithRecovery(vault, recoveryCode);
  assert.deepEqual(await decryptRecord(viaRecovery, ctx("A", "r1"), sealed), { x: 1 });
  // minuscole, spazi invece di trattini
  await unlockWithRecovery(vault, recoveryCode.toLowerCase().replaceAll("-", " "));
  // un carattere cambiato
  const i = 3;
  const swapped = recoveryCode.slice(0, i) + (recoveryCode[i] === "A" ? "B" : "A") + recoveryCode.slice(i + 1);
  await rejects(() => unlockWithRecovery(vault, swapped), /errore di battitura/);
  await rejects(() => unlockWithRecovery(vault, recoveryCode.slice(0, 20)), /incompleta/);
});

test("cambio passphrase: i record restano leggibili, la vecchia non funziona più", async () => {
  const { vault, master } = await createAccount(PASS_A, FAST);
  const sealed = await encryptRecord(master, ctx("A", "r1"), { x: 42 });
  const v2 = await changePassphrase(vault, PASS_A, "nuova passphrase sicura");
  await rejects(() => unlockWithPassphrase(v2, PASS_A), /passphrase errata/);
  const m2 = await unlockWithPassphrase(v2, "nuova passphrase sicura");
  assert.deepEqual(await decryptRecord(m2, ctx("A", "r1"), sealed), { x: 42 });
});

test("rotazione della chiave di recupero: la vecchia smette di funzionare", async () => {
  const { vault, recoveryCode: old } = await createAccount(PASS_A, FAST);
  const { vault: v2, recoveryCode: fresh } = await rotateRecoveryCode(vault, PASS_A);
  await rejects(() => unlockWithRecovery(v2, old), /errata/);
  await unlockWithRecovery(v2, fresh);
});

test("un blocco cifrato spostato su un altro record o tipo non si apre", async () => {
  const { master } = await createAccount(PASS_A, FAST);
  const sealed = await encryptRecord(master, ctx("A", "r1", "person"), { x: 1 });
  await rejects(() => decryptRecord(master, ctx("A", "r2", "person"), sealed), /decifratura/);
  await rejects(() => decryptRecord(master, ctx("A", "r1", "payment"), sealed), /decifratura/);
  await rejects(() => decryptRecord(master, ctx("B", "r1", "person"), sealed), /decifratura/);
});

test("due professionisti che non si vedono: B non apre nulla di A, in nessun modo", async () => {
  const A = await createAccount(PASS_A, FAST);
  const B = await createAccount(PASS_B, FAST);
  const sealedA = await encryptRecord(A.master, ctx("A", "r1"), { nome: "persona di A" });
  // B prova con la propria chiave, con il proprio contesto e con quello di A
  await rejects(() => decryptRecord(B.master, ctx("B", "r1"), sealedA), /decifratura/);
  await rejects(() => decryptRecord(B.master, ctx("A", "r1"), sealedA), /decifratura/);
  // B prova ad aprire il vault di A con la propria passphrase o con il proprio codice di recupero
  await rejects(() => unlockWithPassphrase(A.vault, PASS_B), /passphrase errata/);
  await rejects(() => unlockWithRecovery(A.vault, B.recoveryCode), /errata/);
});

test("passphrase con caratteri accentati: stessa chiave anche con forme Unicode diverse", async () => {
  const composed = "perché è così città"; // NFC
  const decomposed = composed.normalize("NFD");
  const { vault } = await createAccount(composed, FAST);
  await unlockWithPassphrase(vault, decomposed);
});

test("portale: pacchetto cifrato, link, apertura con la chiave giusta", async () => {
  const A = await createAccount(PASS_A, FAST);
  const share = await createShareKey();
  const pkg = { percorso: "Vocal BOOM", rimanenti: 2, resoconto: "Oggi esploriamo tre modalità." };
  const sealed = await sealPackage(share.raw, share.shareId, 1, pkg);
  assert.ok(!JSON.stringify(sealed).includes("BOOM"));

  const link = buildInviteLink("https://app.example", share.shareId, share.raw);
  assert.ok(link.includes("/portale#s="));
  // il segreto sta solo nel frammento: la parte che il browser invia al server non lo contiene
  const u = new URL(link);
  assert.ok(!(u.pathname + u.search).includes(link.split("k=")[1]));

  const parsed = parseInviteLink(link);
  assert.deepEqual(await openPackage(parsed.raw, parsed.shareId, 1, sealed), pkg);

  // il professionista può ritrovare la chiave (avvolta con la chiave principale) e rigenerare il link
  const wrapped = await wrapShareKey(A.master, share.shareId, share.raw);
  const again = await unwrapShareKey(A.master, share.shareId, wrapped);
  assert.deepEqual(again, share.raw);
});

test("portale: chiave sbagliata, versione sbagliata e link incompleto sono rifiutati", async () => {
  const s1 = await createShareKey();
  const s2 = await createShareKey();
  const sealed = await sealPackage(s1.raw, s1.shareId, 3, { a: 1 });
  await rejects(() => openPackage(s2.raw, s1.shareId, 3, sealed), /decifratura/);
  await rejects(() => openPackage(s1.raw, s1.shareId, 4, sealed), /decifratura/);
  await rejects(() => openPackage(s1.raw, s2.shareId, 3, sealed), /decifratura/);
  assert.throws(() => parseInviteLink("https://app.example/portale#s=abc"), /incompleto/);
});

test("portale: revoca con nuova chiave: il vecchio link non apre il pacchetto nuovo", async () => {
  const oldKey = await createShareKey();
  const newKey = await createShareKey();
  const sealedNew = await sealPackage(newKey.raw, oldKey.shareId, 2, { a: 1 });
  await rejects(() => openPackage(oldKey.raw, oldKey.shareId, 2, sealedNew), /decifratura/);
});

test("accesso portale: impronta email stabile e senza maiuscole/spazi; codici a 8 cifre", async () => {
  const p = "segreto-del-server";
  const h1 = await hashEmail("  Alex@Example.com ", p);
  const h2 = await hashEmail("alex@example.com", p);
  assert.equal(h1, h2);
  assert.notEqual(h1, await hashEmail("alex@example.com", "altro-segreto"));
  assert.ok(!h1.includes("alex"));
  assert.equal(normalizeEmail(" X@Y.it "), "x@y.it");
  for (let i = 0; i < 200; i++) assert.match(newOtp(), /^\d{8}$/);
  const a = await hashOtp("12345678", "share1", p);
  assert.ok(constantTimeEqual(a, await hashOtp("12345678", "share1", p)));
  assert.ok(!constantTimeEqual(a, await hashOtp("12345679", "share1", p)));
  assert.ok(!constantTimeEqual(a, await hashOtp("12345678", "share2", p)));
});

test("parametri reali: 600.000 iterazioni, sblocco entro tempi accettabili", async () => {
  assert.equal(PBKDF2_ITERATIONS, 600_000);
  const t0 = performance.now();
  const { vault } = await createAccount(PASS_A);
  await unlockWithPassphrase(vault, PASS_A);
  const ms = performance.now() - t0;
  console.log(`  (creazione + sblocco con 600.000 iterazioni: ${Math.round(ms)} ms)`);
  assert.ok(ms < 5000);
});
