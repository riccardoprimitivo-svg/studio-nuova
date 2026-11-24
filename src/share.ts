// Condivisione con la persona (portale allievo).
//
// Ogni persona ha una chiave di condivisione propria. Il pacchetto che la persona
// vede è cifrato con quella chiave. La chiave viaggia solo nel frammento del link
// (la parte dopo "#", che il browser non invia al server) e, avvolta con la chiave
// principale, nell'archivio del professionista per poter rigenerare il link.

import { _internal, CryptoError, Sealed } from "./crypto.js";
import { fromB64, toB64, utf8 } from "./encoding.js";

const { aesEncrypt, aesDecrypt, importAes, randomBytes } = _internal;
const subtle = globalThis.crypto.subtle;

export interface ShareKey {
  shareId: string;
  key: CryptoKey;
}

/** Chiave nuova per una persona. Estraibile: serve per metterla nel link e per avvolgerla. */
export async function createShareKey(): Promise<{ shareId: string; raw: Uint8Array; key: CryptoKey }> {
  const raw = randomBytes(32);
  return { shareId: globalThis.crypto.randomUUID(), raw, key: await importAes(raw, false) };
}

/** Avvolge la chiave di condivisione con la chiave principale, per conservarla (cifrata) sul server. */
export async function wrapShareKey(master: CryptoKey, shareId: string, raw: Uint8Array): Promise<Sealed> {
  return aesEncrypt(master, raw, `sharekey:v1|${shareId}`);
}

export async function unwrapShareKey(master: CryptoKey, shareId: string, sealed: Sealed): Promise<Uint8Array> {
  return aesDecrypt(master, sealed, `sharekey:v1|${shareId}`);
}

export async function sealPackage(raw: Uint8Array, shareId: string, rev: number, pkg: unknown): Promise<Sealed> {
  const key = await importAes(raw, false);
  return aesEncrypt(key, utf8.enc(JSON.stringify(pkg)), `share:v1|${shareId}|${rev}`);
}

export async function openPackage<T = unknown>(
  raw: Uint8Array,
  shareId: string,
  rev: number,
  sealed: Sealed,
): Promise<T> {
  const key = await importAes(raw, false);
  return JSON.parse(utf8.dec(await aesDecrypt(key, sealed, `share:v1|${shareId}|${rev}`))) as T;
}

export function buildInviteLink(base: string, shareId: string, raw: Uint8Array, page = "portale"): string {
  return `${base.replace(/\/$/, "")}/${page}#s=${shareId}&k=${toB64(raw)}`;
}

export function parseInviteLink(link: string): { shareId: string; raw: Uint8Array } {
  const hash = new URL(link).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const shareId = params.get("s");
  const k = params.get("k");
  if (!shareId || !k) throw new CryptoError("link di invito incompleto");
  const raw = fromB64(k);
  if (raw.length !== 32) throw new CryptoError("link di invito non valido");
  return { shareId, raw };
}

export async function fingerprint(raw: Uint8Array): Promise<string> {
  // Impronta breve per riconoscere una chiave senza rivelarla (utile nei test e nei log).
  const h = new Uint8Array(await subtle.digest("SHA-256", raw as unknown as BufferSource));
  return toB64(h.slice(0, 6));
}
