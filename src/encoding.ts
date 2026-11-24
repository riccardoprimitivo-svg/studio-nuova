// Codifiche di base: base64url per i dati cifrati, base32 (Crockford) per la chiave di recupero.

export type Bytes = Uint8Array;

export function toB64(bytes: Bytes): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(s: string): Bytes {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function toB32(bytes: Bytes): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Crockford: O -> 0, I e L -> 1; trattini e spazi ignorati. */
export function normalizeB32(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function fromB32(s: string): Bytes {
  const clean = normalizeB32(s);
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("carattere non valido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

export const utf8 = {
  enc: (s: string): Bytes => new TextEncoder().encode(s),
  dec: (b: Bytes): string => new TextDecoder().decode(b),
};

// Il tipo di BufferSource richiesto da WebCrypto non accetta direttamente ogni Uint8Array.
export const bs = (b: Bytes): BufferSource => b as unknown as BufferSource;
