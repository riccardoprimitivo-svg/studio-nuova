// Operazioni sulle persone, sui percorsi e sugli incontri.
// Nessun accesso al DOM: si può provare con i test.

import {
  nameKey,
  packageProgress,
  type Entity,
  type Meeting,
  type Package,
  type Payment,
  type Person,
  type Progress,
} from "./model.js";
import { Studio, StudioError } from "./store.js";

export interface PersonInput {
  name: string;
  email?: string;
  phone?: string;
  goal?: string;
  remember?: string;
}

function clean(s: string | undefined): string {
  return (s ?? "").trim();
}

/** Nessun doppione: lo stesso nome (senza badare a maiuscole e accenti) esiste una volta sola. */
export function findByName(studio: Studio, name: string, exceptId?: string): Entity<Person> | undefined {
  const key = nameKey(name);
  return studio.list<Person>("person").find((p) => p.id !== exceptId && nameKey(p.value.name) === key);
}

export async function addPerson(studio: Studio, input: PersonInput): Promise<Entity<Person>> {
  const name = clean(input.name);
  if (!name) throw new StudioError("Serve almeno il nome.");
  const dup = findByName(studio, name);
  if (dup) throw new StudioError(`${dup.value.name} è già tra le persone.`);
  return studio.save<Person>("person", {
    name,
    email: clean(input.email),
    phone: clean(input.phone),
    goal: clean(input.goal),
    remember: clean(input.remember),
    createdAt: new Date().toISOString(),
  });
}

export async function updatePerson(studio: Studio, id: string, input: PersonInput): Promise<Entity<Person>> {
  const prev = studio.get<Person>(id);
  if (!prev) throw new StudioError("Persona non trovata.");
  const name = clean(input.name);
  if (!name) throw new StudioError("Serve almeno il nome.");
  const dup = findByName(studio, name, id);
  if (dup) throw new StudioError(`${dup.value.name} è già tra le persone.`);
  return studio.save<Person>(
    "person",
    {
      ...prev.value,
      name,
      email: clean(input.email),
      phone: clean(input.phone),
      goal: clean(input.goal),
      remember: clean(input.remember),
    },
    id,
  );
}

/** Cancella la persona con tutto ciò che la riguarda. L'app chiede conferma prima di chiamarla. */
export async function deletePerson(studio: Studio, id: string): Promise<void> {
  const ids = [
    id,
    ...studio.list<Meeting>("meeting").filter((m) => m.value.personId === id).map((m) => m.id),
    ...studio.list<Package>("package").filter((p) => p.value.personId === id).map((p) => p.id),
    ...studio.list<Payment>("payment").filter((p) => p.value.ownerKind === "person" && p.value.ownerId === id).map((p) => p.id),
  ];
  await studio.remove(...ids);
}

export function meetingsOf(studio: Studio, personId: string): Entity<Meeting>[] {
  return studio
    .list<Meeting>("meeting")
    .filter((m) => m.value.personId === personId)
    .sort((a, b) => (a.value.at < b.value.at ? 1 : -1)); // dal più recente
}

export function packagesOf(studio: Studio, personId: string): Entity<Package>[] {
  return studio
    .list<Package>("package")
    .filter((p) => p.value.personId === personId)
    .sort((a, b) => (a.value.startedAt < b.value.startedAt ? 1 : -1));
}

export interface PackageView {
  pkg: Entity<Package>;
  progress: Progress;
}

/** Il percorso attivo è il più recente non ancora completo. */
export function activePackage(studio: Studio, personId: string, now: Date): PackageView | null {
  const meetings = studio.list<Meeting>("meeting").map((m) => m.value);
  for (const pkg of packagesOf(studio, personId)) {
    const progress = packageProgress(pkg.value, meetings, pkg.id, now);
    if (progress.done < progress.total) return { pkg, progress };
  }
  return null;
}

export function nextMeeting(studio: Studio, personId: string, now: Date): Entity<Meeting> | null {
  const t = now.getTime();
  const future = meetingsOf(studio, personId)
    .filter((m) => new Date(m.value.at).getTime() > t)
    .sort((a, b) => (a.value.at < b.value.at ? -1 : 1));
  return future[0] ?? null;
}

export function lastMeeting(studio: Studio, personId: string, now: Date): Entity<Meeting> | null {
  const t = now.getTime();
  return meetingsOf(studio, personId).find((m) => new Date(m.value.at).getTime() <= t) ?? null;
}

export async function addPackage(
  studio: Studio,
  personId: string,
  input: { title: string; total: number; startedAt: string; price?: number },
): Promise<Entity<Package>> {
  if (!Number.isInteger(input.total) || input.total < 1 || input.total > 200) {
    throw new StudioError("Il numero di incontri deve essere tra 1 e 200.");
  }
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0 || input.price > 100000)) {
    throw new StudioError("Il prezzo non è valido.");
  }
  const title = clean(input.title) || (input.total === 1 ? "Percorso da 1 incontro" : `Percorso da ${input.total} incontri`);
  return studio.save<Package>("package", {
    personId,
    title,
    total: input.total,
    startedAt: input.startedAt,
    ...(input.price ? { price: input.price } : {}),
  });
}

export interface MeetingInput {
  at: string;
  attendance: Meeting["attendance"];
  privateNote: string;
  sharedReport: string;
  packageId: string | null;
  minutes?: number;
}

export async function saveMeeting(
  studio: Studio,
  personId: string,
  input: MeetingInput,
  id?: string,
): Promise<Entity<Meeting>> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.at)) throw new StudioError("Data o ora non valide.");
  // Nessun testo obbligatorio: si salva anche con le note vuote.
  return studio.save<Meeting>(
    "meeting",
    {
      personId,
      packageId: input.packageId,
      at: input.at,
      attendance: input.attendance,
      privateNote: input.privateNote,
      sharedReport: input.sharedReport,
      ...(input.minutes ? { minutes: input.minutes } : {}),
    },
    id,
  );
}

export async function deleteMeeting(studio: Studio, id: string): Promise<void> {
  await studio.remove(id);
}
