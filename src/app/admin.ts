// Conti: quanto hai registrato, incassato e quanto resta, più la stima del mese.
// Funzioni pure, senza accesso al DOM né allo storage: si provano con i test.
//
// Regole (le stesse del vecchio Studio):
// - un incontro passato vale se la presenza non è "assente non retribuito";
// - "assente retribuito" vale come svolto;
// - a pacchetto: prezzo diviso per il numero di incontri; altrimenti la tariffa della persona;
// - dentro una struttura: a incontro, a ora (durata dell'incontro) o al mese
//   (una quota per ogni mese in cui c'è almeno un incontro).

import {
  normalizePerson,
  type Entity,
  type Meeting,
  type Package,
  type Payment,
  type Person,
  type Structure,
} from "./model.js";

export interface Book {
  people: Entity<Person>[];
  packages: Entity<Package>[];
  meetings: Entity<Meeting>[];
  structures: Entity<Structure>[];
  payments: Entity<Payment>[];
}

export type OwnerKind = "person" | "structure";

export interface Line {
  ownerKind: OwnerKind;
  ownerId: string;
  /** Incontro da cui nasce (assente per le quote mensili). */
  meetingId: string | null;
  /** Data dell'incontro, o primo del mese per le quote mensili. */
  at: string;
  amount: number;
  /** "done" = già avvenuto e retribuito; "planned" = in programma. */
  state: "done" | "planned";
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

function isoMonth(at: string): string {
  return at.slice(0, 7);
}

/** Tutte le righe di compenso. Gli incontri "assente non retribuito" non producono righe. */
export function lines(book: Book, now: Date): Line[] {
  const t = now.getTime();
  const people = new Map(book.people.map((p) => [p.id, normalizePerson(p.value)] as const));
  const packages = new Map(book.packages.map((p) => [p.id, p.value] as const));
  const structures = new Map(book.structures.map((s) => [s.id, s.value] as const));
  const out: Line[] = [];
  // Per le quote mensili: struttura -> mese -> {fatto, in programma}
  const months = new Map<string, Map<string, { done: boolean; planned: boolean }>>();

  for (const m of book.meetings) {
    const person = people.get(m.value.personId);
    if (!person) continue;
    const past = new Date(m.value.at).getTime() <= t;
    if (past && m.value.attendance === "absent_unpaid") continue;
    const state: Line["state"] = past ? "done" : "planned";

    const structure = person.structureId ? structures.get(person.structureId) : undefined;
    if (person.structureId && structure) {
      const sid = person.structureId;
      if (structure.mode === "per_month") {
        const byMonth = months.get(sid) ?? new Map();
        const cur = byMonth.get(isoMonth(m.value.at)) ?? { done: false, planned: false };
        if (state === "done") cur.done = true;
        else cur.planned = true;
        byMonth.set(isoMonth(m.value.at), cur);
        months.set(sid, byMonth);
        continue;
      }
      const minutes = finite(m.value.minutes) || finite(structure.minutes) || 60;
      const amount =
        structure.mode === "per_hour" ? round2((finite(structure.amount) * minutes) / 60) : round2(finite(structure.amount));
      out.push({ ownerKind: "structure", ownerId: sid, meetingId: m.id, at: m.value.at, amount, state });
      continue;
    }

    const pkg = m.value.packageId ? packages.get(m.value.packageId) : undefined;
    const perMeeting =
      pkg && finite(pkg.price) > 0 && finite(pkg.total) > 0 ? round2(finite(pkg.price) / pkg.total) : finite(person.rate);
    out.push({ ownerKind: "person", ownerId: m.value.personId, meetingId: m.id, at: m.value.at, amount: perMeeting, state });
  }

  for (const [sid, byMonth] of months) {
    const s = structures.get(sid);
    if (!s) continue;
    for (const [month, flags] of byMonth) {
      out.push({
        ownerKind: "structure",
        ownerId: sid,
        meetingId: null,
        at: `${month}-01T00:00`,
        amount: round2(finite(s.amount)),
        state: flags.done ? "done" : "planned",
      });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

export interface OwnerBalance {
  kind: OwnerKind;
  id: string;
  name: string;
  registered: number;
  collected: number;
  /** Può essere negativo: hai incassato più del registrato (anticipi). */
  residual: number;
}

export interface Summary {
  owners: OwnerBalance[];
  registered: number;
  collected: number;
  residual: number;
  /** Stima del mese di `now`: già avvenuto + in programma. */
  month: { done: number; planned: number; estimate: number };
}

export function summary(book: Book, now: Date): Summary {
  const ls = lines(book, now);
  const names = new Map<string, string>();
  for (const p of book.people) names.set(`person:${p.id}`, p.value.name);
  for (const s of book.structures) names.set(`structure:${s.id}`, s.value.name);

  const acc = new Map<string, OwnerBalance>();
  const get = (kind: OwnerKind, id: string): OwnerBalance => {
    const k = `${kind}:${id}`;
    let b = acc.get(k);
    if (!b) {
      b = { kind, id, name: names.get(k) ?? "(eliminato)", registered: 0, collected: 0, residual: 0 };
      acc.set(k, b);
    }
    return b;
  };

  for (const l of ls) if (l.state === "done") get(l.ownerKind, l.ownerId).registered += l.amount;
  for (const p of book.payments) get(p.value.ownerKind, p.value.ownerId).collected += finite(p.value.amount);

  const owners = [...acc.values()]
    .map((o) => ({ ...o, registered: round2(o.registered), collected: round2(o.collected), residual: round2(o.registered - o.collected) }))
    .filter((o) => o.registered !== 0 || o.collected !== 0)
    .sort((a, b) => b.residual - a.residual || a.name.localeCompare(b.name, "it"));

  const sum = (f: (o: OwnerBalance) => number) => round2(owners.reduce((n, o) => n + f(o), 0));

  const thisMonth = isoMonth(toLocalIso(now));
  const inMonth = ls.filter((l) => isoMonth(l.at) === thisMonth);
  const done = round2(inMonth.filter((l) => l.state === "done").reduce((n, l) => n + l.amount, 0));
  const planned = round2(inMonth.filter((l) => l.state === "planned").reduce((n, l) => n + l.amount, 0));

  return {
    owners,
    registered: sum((o) => o.registered),
    collected: sum((o) => o.collected),
    residual: sum((o) => o.residual),
    month: { done, planned, estimate: round2(done + planned) },
  };
}

function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function euro(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}
