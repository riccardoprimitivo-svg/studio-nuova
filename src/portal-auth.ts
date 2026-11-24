// Parte che girerà lato server (funzione edge) per l'accesso della persona.
// Il server non conserva l'email in chiaro: solo un'impronta con un segreto del server (pepper).
// L'email in chiaro serve soltanto nell'istante in cui si invia il codice.

import { bs, toB64, utf8 } from "./encoding.js";

const subtle = globalThis.crypto.subtle;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await subtle.importKey("raw", bs(utf8.enc(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toB64(new Uint8Array(await subtle.sign("HMAC", key, bs(utf8.enc(message)))));
}

export const hashEmail = (email: string, pepper: string) => hmac(pepper, `email:${normalizeEmail(email)}`);

export function newOtp(): string {
  // 8 cifre, uniformi (scarto dei valori che sbilancerebbero la distribuzione).
  const limit = 4_294_967_296 - (4_294_967_296 % 100_000_000);
  for (;;) {
    const n = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!;
    if (n < limit) return String(n % 100_000_000).padStart(8, "0");
  }
}

export const hashOtp = (code: string, shareId: string, pepper: string) => hmac(pepper, `otp:${shareId}:${code}`);

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
