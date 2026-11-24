// Cifratura end-to-end per il professionista.
//
// Schema delle chiavi:
//   passphrase --PBKDF2--> KEK ---\
//                                  >-- avvolgono (AES-GCM) --> chiave principale (master)
//   chiave di recupero (256 bit) -/
//
// La chiave principale cifra ogni record. Il server vede solo il "vault"
// (chiave principale avvolta, due volte) e i record cifrati: non può aprire nulla.

import { Bytes, bs, fromB32, fromB64, normalizeB32, toB32, toB64, utf8 } from "./encoding.js";

const subtle = globalThis.crypto.subtle;

export const PBKDF2_ITERATIONS = 600_000;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

/** Un blocco cifrato: iv e testo cifrato (con tag di autenticazione), in base64url. */
export interface Sealed {
  iv: string;
  ct: string;
}

export interface Vault {
  version: 1;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  byPassphrase: Sealed;
  byRecovery: Sealed;
}

export interface RecordContext {
  professionalId: string;
  recordId: string;
  kind: string;
}

function randomBytes(n: number): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

async function aesEncrypt(key: CryptoKey, plain: Bytes, aad: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: bs(iv), additionalData: bs(utf8.enc(aad)) }, key, bs(plain)),
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function aesDecrypt(key: CryptoKey, sealed: Sealed, aad: string): Promise<Bytes> {
  try {
    return new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv: bs(fromB64(sealed.iv)), additionalData: bs(utf8.enc(aad)) },
        key,
        bs(fromB64(sealed.ct)),
      ),
    );
  } catch {
    throw new CryptoError("decifratura non riuscita");
  }
}

function importAes(raw: Bytes, extractable: boolean): Promise<CryptoKey> {
  return subtle.importKey("raw", bs(raw), { name: "AES-GCM" }, extractable, ["encrypt", "decrypt"]);
}

async function deriveKek(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", bs(utf8.enc(passphrase.normalize("NFKC"))), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---- Chiave di recupero -------------------------------------------------

async function checksum(bytes: Bytes): Promise<string> {
  const h = new Uint8Array(await subtle.digest("SHA-256", bs(bytes)));
  return toB32(h.slice(0, 3)).slice(0, 4);
}

/** 52 caratteri di chiave + 4 di controllo, in gruppi da 4: XXXX-XXXX-... */
export async function formatRecoveryCode(raw: Bytes): Promise<string> {
  const text = toB32(raw) + (await checksum(raw));
  return text.match(/.{1,4}/g)!.join("-");
}

export async function parseRecoveryCode(code: string): Promise<Bytes> {
  const clean = normalizeB32(code);
  if (clean.length !== 56) throw new CryptoError("chiave di recupero incompleta");
  const raw = fromB32(clean.slice(0, 52)).slice(0, 32);
  if ((await checksum(raw)) !== clean.slice(52)) {
    throw new CryptoError("chiave di recupero con un errore di battitura");
  }
  return raw;
}

// ---- Creazione e sblocco del vault -------------------------------------

export interface NewAccount {
  vault: Vault;
  /** Da mostrare una volta sola al professionista, da conservare fuori dall'app. */
  recoveryCode: string;
  master: CryptoKey;
}

export async function createAccount(
  passphrase: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<NewAccount> {
  if (passphrase.length < 10) throw new CryptoError("passphrase troppo corta (minimo 10 caratteri)");
  const masterRaw = randomBytes(32);
  const salt = randomBytes(16);
  const recoveryRaw = randomBytes(32);

  const kek = await deriveKek(passphrase, salt, iterations);
  const recoveryKey = await importAes(recoveryRaw, false);

  const vault: Vault = {
    version: 1,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: toB64(salt) },
    byPassphrase: await aesEncrypt(kek, masterRaw, "vault:passphrase"),
    byRecovery: await aesEncrypt(recoveryKey, masterRaw, "vault:recovery"),
  };
  return { vault, recoveryCode: await formatRecoveryCode(recoveryRaw), master: await importAes(masterRaw, false) };
}

async function masterRawFromPassphrase(vault: Vault, passphrase: string): Promise<Bytes> {
  const kek = await deriveKek(passphrase.normalize("NFKC"), fromB64(vault.kdf.salt), vault.kdf.iterations);
  try {
    return await aesDecrypt(kek, vault.byPassphrase, "vault:passphrase");
  } catch {
    throw new CryptoError("passphrase errata");
  }
}

export async function unlockWithPassphrase(vault: Vault, passphrase: string): Promise<CryptoKey> {
  return importAes(await masterRawFromPassphrase(vault, passphrase), false);
}

export async function unlockWithRecovery(vault: Vault, recoveryCode: string): Promise<CryptoKey> {
  const raw = await parseRecoveryCode(recoveryCode);
  const key = await importAes(raw, false);
  let masterRaw: Bytes;
  try {
    masterRaw = await aesDecrypt(key, vault.byRecovery, "vault:recovery");
  } catch {
    throw new CryptoError("chiave di recupero errata");
  }
  return importAes(masterRaw, false);
}

/** Cambia la passphrase senza toccare i record: cambia solo l'avvolgimento della chiave principale. */
export async function changePassphrase(vault: Vault, oldPass: string, newPass: string): Promise<Vault> {
  if (newPass.length < 10) throw new CryptoError("passphrase troppo corta (minimo 10 caratteri)");
  const masterRaw = await masterRawFromPassphrase(vault, oldPass);
  const salt = randomBytes(16);
  const kek = await deriveKek(newPass, salt, vault.kdf.iterations);
  return {
    ...vault,
    kdf: { ...vault.kdf, salt: toB64(salt) },
    byPassphrase: await aesEncrypt(kek, masterRaw, "vault:passphrase"),
  };
}

/** Dopo aver sbloccato con la passphrase, genera una nuova chiave di recupero e invalida la vecchia. */
export async function rotateRecoveryCode(
  vault: Vault,
  passphrase: string,
): Promise<{ vault: Vault; recoveryCode: string }> {
  const masterRaw = await masterRawFromPassphrase(vault, passphrase);
  const recoveryRaw = randomBytes(32);
  const key = await importAes(recoveryRaw, false);
  return {
    vault: { ...vault, byRecovery: await aesEncrypt(key, masterRaw, "vault:recovery") },
    recoveryCode: await formatRecoveryCode(recoveryRaw),
  };
}

// ---- Record -------------------------------------------------------------

// Il contesto (professionista, record, tipo) entra nei dati autenticati:
// un blocco cifrato spostato su un altro record o su un altro professionista non si apre.
const aadFor = (c: RecordContext) => `record:v1|${c.professionalId}|${c.recordId}|${c.kind}`;

export async function encryptRecord(master: CryptoKey, ctx: RecordContext, value: unknown): Promise<Sealed> {
  return aesEncrypt(master, utf8.enc(JSON.stringify(value)), aadFor(ctx));
}

export async function decryptRecord<T = unknown>(master: CryptoKey, ctx: RecordContext, sealed: Sealed): Promise<T> {
  return JSON.parse(utf8.dec(await aesDecrypt(master, sealed, aadFor(ctx)))) as T;
}

// ---- Primitive riusate dal portale -------------------------------------

export const _internal = { aesEncrypt, aesDecrypt, importAes, randomBytes };
