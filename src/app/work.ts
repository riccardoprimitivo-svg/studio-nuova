// Operazioni su strutture, pagamenti, orari abituali, avvisi, materiali e impostazioni.
// Nessun accesso al DOM.

import type { Book } from "./admin.js";
import {
  EMPTY_PROFILE,
  MAX_SLOTS,
  nameKey,
  normalizePerson,
  type CatalogSetting,
  type Entity,
  type Material,
  type Meeting,
  type Notice,
  type Package,
  type Payment,
  type Person,
  type ProfileSetting,
  type Setting,
  type Slot,
  type Structure,
  type StructureMode,
} from "./model.js";
import { Studio, StudioError } from "./store.js";

export function getBook(studio: Studio): Book {
  return {
    people: studio.list<Person>("person"),
    packages: studio.list<Package>("package"),
    meetings: studio.list<Meeting>("meeting"),
    structures: studio.list<Structure>("structure"),
    payments: studio.list<Payment>("payment"),
  };
}

const trim = (s: string | undefined) => (s ?? "").trim();

/** Solo collegamenti https: niente "javascript:", niente file, niente testo libero. */
export function safeHttpsUrl(raw: string): string {
  const value = trim(raw);
  if (!value) return "";
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new StudioError("Il collegamento non è valido. Deve iniziare con https://");
  }
  if (u.protocol !== "https:") throw new StudioError("Il collegamento deve iniziare con https://");
  return u.toString();
}

async function patchPerson(studio: Studio, personId: string, change: (p: ReturnType<typeof normalizePerson>) => Partial<Person>) {
  const prev = studio.get<Person>(personId);
  if (!prev) throw new StudioError("Persona non trovata.");
  return studio.save<Person>("person", { ...prev.value, ...change(normalizePerson(prev.value)) }, personId);
}

// ---- Orari abituali -----------------------------------------------------------

export function normalizeSlots(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const s of slots) {
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) throw new StudioError("Giorno non valido.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new StudioError("Orario non valido.");
    const k = `${s.weekday}-${s.time}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ weekday: s.weekday, time: s.time });
    }
  }
  if (out.length > MAX_SLOTS) throw new StudioError(`Al massimo ${MAX_SLOTS} orari abituali.`);
  return out.sort((a, b) => a.weekday - b.weekday || (a.time < b.time ? -1 : 1));
}

export async function setUsualSlots(studio: Studio, personId: string, slots: Slot[]) {
  const clean = normalizeSlots(slots);
  return patchPerson(studio, personId, () => ({ usualSlots: clean }));
}

// ---- Dati di lavoro sulla persona ---------------------------------------------

export async function setWorkData(
  studio: Studio,
  personId: string,
  d: { city: string; subjects: string; structureId: string | null; rate: number; driveUrl: string },
) {
  if (!Number.isFinite(d.rate) || d.rate < 0 || d.rate > 10000) throw new StudioError("La tariffa non è valida.");
  if (d.structureId && !studio.get<Structure>(d.structureId)) throw new StudioError("Struttura non trovata.");
  const drive = safeHttpsUrl(d.driveUrl);
  return patchPerson(studio, personId, () => ({
    city: trim(d.city),
    subjects: trim(d.subjects),
    structureId: d.structureId,
    rate: d.rate,
    driveUrl: drive,
  }));
}

export async function addNotice(studio: Studio, personId: string, text: string, now = new Date()) {
  const t = trim(text);
  if (!t) throw new StudioError("Scrivi l'avviso.");
  const n: Notice = { id: globalThis.crypto.randomUUID(), text: t, at: now.toISOString() };
  return patchPerson(studio, personId, (p) => ({ notices: [n, ...p.notices] }));
}

export const removeNotice = (studio: Studio, personId: string, id: string) =>
  patchPerson(studio, personId, (p) => ({ notices: p.notices.filter((n) => n.id !== id) }));

export async function addMaterial(studio: Studio, personId: string, input: { title: string; url: string }) {
  const url = safeHttpsUrl(input.url);
  if (!url) throw new StudioError("Serve il collegamento.");
  const m: Material = { id: globalThis.crypto.randomUUID(), title: trim(input.title) || new URL(url).hostname, url };
  return patchPerson(studio, personId, (p) => ({ materials: [...p.materials, m] }));
}

export const removeMaterial = (studio: Studio, personId: string, id: string) =>
  patchPerson(studio, personId, (p) => ({ materials: p.materials.filter((m) => m.id !== id) }));

// ---- Strutture -----------------------------------------------------------------

export interface StructureInput {
  name: string;
  mode: StructureMode;
  amount: number;
  minutes: number;
}

export async function saveStructure(studio: Studio, input: StructureInput, id?: string): Promise<Entity<Structure>> {
  const name = trim(input.name);
  if (!name) throw new StudioError("Serve il nome della struttura.");
  const key = nameKey(name);
  const dup = studio.list<Structure>("structure").find((s) => s.id !== id && nameKey(s.value.name) === key);
  if (dup) throw new StudioError(`${dup.value.name} esiste già.`);
  if (!["per_meeting", "per_hour", "per_month"].includes(input.mode)) throw new StudioError("Modalità non valida.");
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 100000) throw new StudioError("L'importo non è valido.");
  const minutes = Number.isFinite(input.minutes) && input.minutes >= 15 && input.minutes <= 480 ? Math.round(input.minutes) : 60;
  return studio.save<Structure>("structure", { name, mode: input.mode, amount: input.amount, minutes }, id);
}

/** Le persone seguite dentro la struttura restano, ma tornano a compenso individuale. */
export async function deleteStructure(studio: Studio, id: string): Promise<void> {
  for (const p of studio.list<Person>("person")) {
    if (p.value.structureId === id) await studio.save<Person>("person", { ...p.value, structureId: null }, p.id);
  }
  const pays = studio.list<Payment>("payment").filter((p) => p.value.ownerKind === "structure" && p.value.ownerId === id);
  await studio.remove(id, ...pays.map((p) => p.id));
}

// ---- Pagamenti ------------------------------------------------------------------

export async function addPayment(studio: Studio, input: Payment): Promise<Entity<Payment>> {
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new StudioError("L'importo deve essere maggiore di zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.at)) throw new StudioError("Data non valida.");
  const exists = input.ownerKind === "person" ? studio.get<Person>(input.ownerId) : studio.get<Structure>(input.ownerId);
  if (!exists) throw new StudioError("Chi ha pagato non è stato trovato.");
  return studio.save<Payment>("payment", { ...input, note: trim(input.note) });
}

export const deletePayment = (studio: Studio, id: string) => studio.remove(id);

// ---- Impostazioni -----------------------------------------------------------------

export function getProfile(studio: Studio): Entity<ProfileSetting> | null {
  const s = studio.list<Setting>("setting").find((x) => x.value.type === "profile");
  return s ? (s as Entity<ProfileSetting>) : null;
}

export function profileValue(studio: Studio): ProfileSetting {
  return { ...EMPTY_PROFILE, ...(getProfile(studio)?.value ?? {}) };
}

export async function saveProfile(studio: Studio, input: Omit<ProfileSetting, "type">): Promise<void> {
  const value: ProfileSetting = {
    type: "profile",
    displayName: trim(input.displayName),
    bio: trim(input.bio),
    email: trim(input.email),
    phone: trim(input.phone),
    shareEmail: !!input.shareEmail && !!trim(input.email),
    sharePhone: !!input.sharePhone && !!trim(input.phone),
  };
  await studio.save<Setting>("setting", value, getProfile(studio)?.id);
}

export function listCatalog(studio: Studio): Entity<CatalogSetting>[] {
  return (studio.list<Setting>("setting").filter((x) => x.value.type === "catalog") as Entity<CatalogSetting>[]).sort((a, b) =>
    a.value.title.localeCompare(b.value.title, "it"),
  );
}

export async function saveCatalogItem(studio: Studio, input: { title: string; total: number; price: number }, id?: string) {
  const title = trim(input.title);
  if (!title) throw new StudioError("Serve il nome del percorso.");
  if (!Number.isInteger(input.total) || input.total < 1 || input.total > 200) throw new StudioError("Gli incontri devono essere tra 1 e 200.");
  if (!Number.isFinite(input.price) || input.price < 0 || input.price > 100000) throw new StudioError("Il prezzo non è valido.");
  const dup = listCatalog(studio).find((c) => c.id !== id && nameKey(c.value.title) === nameKey(title));
  if (dup) throw new StudioError(`${dup.value.title} esiste già.`);
  return studio.save<Setting>("setting", { type: "catalog", title, total: input.total, price: input.price }, id);
}

export const deleteCatalogItem = (studio: Studio, id: string) => studio.remove(id);
