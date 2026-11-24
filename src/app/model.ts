// Modello dei dati dell'app. Tutto ciò che sta qui dentro viene cifrato prima di
// lasciare il dispositivo: il server non vede mai nomi, note o conteggi.

export interface Person {
  name: string;
  email: string;
  phone: string;
  /** "Informazioni da ricordare sempre": visibili a chi insegna, in cima alla scheda. */
  remember: string;
  /** Obiettivo della persona, anche in due parole. */
  goal: string;
  createdAt: string; // ISO
  // I campi seguenti sono nati dopo: nei record vecchi mancano, si leggono con normalizePerson.
  city?: string;
  /** Materie o aree di lavoro, in poche parole. */
  subjects?: string;
  /** Se la persona viene seguita dentro una struttura, il compenso segue quella struttura. */
  structureId?: string | null;
  /** Cartella condivisa (Drive o simili). */
  driveUrl?: string;
  /** Orari abituali, al massimo 14. */
  usualSlots?: Slot[];
  /** Compenso per incontro quando non c'è né percorso con prezzo né struttura. */
  rate?: number;
  notices?: Notice[];
  materials?: Material[];
}

export interface Slot {
  /** 1 = lunedì … 7 = domenica. */
  weekday: number;
  /** HH:MM. */
  time: string;
}

export interface Notice {
  id: string;
  text: string;
  at: string; // ISO
}

export interface Material {
  id: string;
  title: string;
  /** Solo collegamenti https. */
  url: string;
}

export const MAX_SLOTS = 14;

export type NormalPerson = Required<Omit<Person, "structureId">> & { structureId: string | null };

export function normalizePerson(p: Person): NormalPerson {
  return {
    ...p,
    city: p.city ?? "",
    subjects: p.subjects ?? "",
    structureId: p.structureId ?? null,
    driveUrl: p.driveUrl ?? "",
    usualSlots: p.usualSlots ?? [],
    rate: p.rate ?? 0,
    notices: p.notices ?? [],
    materials: p.materials ?? [],
  };
}

export interface Package {
  personId: string;
  title: string;
  /** Numero di incontri previsti dal percorso. */
  total: number;
  startedAt: string; // data, AAAA-MM-GG
  /** Prezzo complessivo, se il percorso è a pacchetto. */
  price?: number;
}

/** Come una struttura (scuola, centro, associazione) ti riconosce il lavoro. */
export type StructureMode = "per_meeting" | "per_hour" | "per_month";

export const MODE_LABEL: Record<StructureMode, string> = {
  per_meeting: "A incontro",
  per_hour: "A ora",
  per_month: "Al mese",
};

export interface Structure {
  name: string;
  mode: StructureMode;
  /** Importo: per incontro, per ora o per mese secondo `mode`. */
  amount: number;
  /** Durata abituale in minuti (serve per il compenso a ora). */
  minutes: number;
}

export interface Payment {
  ownerKind: "person" | "structure";
  ownerId: string;
  amount: number;
  /** AAAA-MM-GG */
  at: string;
  note: string;
}

export interface ProfileSetting {
  type: "profile";
  /** Nome che la persona vede nel portale. */
  displayName: string;
  bio: string;
  /** Recapiti che condividi con le persone solo se lo scegli. */
  email: string;
  phone: string;
  shareEmail: boolean;
  sharePhone: boolean;
}

/** Percorsi con nome e prezzo, da riusare quando ne apri uno nuovo. */
export interface CatalogSetting {
  type: "catalog";
  title: string;
  total: number;
  price: number;
}

export type Setting = ProfileSetting | CatalogSetting;

export const EMPTY_PROFILE: ProfileSetting = {
  type: "profile",
  displayName: "",
  bio: "",
  email: "",
  phone: "",
  shareEmail: false,
  sharePhone: false,
};

/** Presenza. Si imposta dopo l'incontro; "none" = non ancora indicata. */
export type Attendance = "none" | "present" | "absent_paid" | "absent_unpaid";

export const ATTENDANCE_LABEL: Record<Attendance, string> = {
  none: "Non indicata",
  present: "Presente",
  absent_paid: "Assente retribuito",
  absent_unpaid: "Assente non retribuito",
};

export interface Meeting {
  personId: string;
  packageId: string | null;
  /** Data e ora locali, AAAA-MM-GGTHH:MM. */
  at: string;
  attendance: Attendance;
  /** Resta solo a chi insegna. */
  privateNote: string;
  /** Si vede nel portale della persona. */
  sharedReport: string;
  /** Durata in minuti; se manca vale quella abituale della struttura (o 60). */
  minutes?: number;
}

export interface Entity<T> {
  id: string;
  value: T;
}

// ---- Regole di calcolo (le stesse varranno sul client e nel portale) ------

/**
 * Un incontro del percorso conta come svolto se la sua data è passata e la presenza
 * non è "assente non retribuito" (quello si recupera e non consuma il percorso).
 * Gli incontri non ancora avvenuti sono "in programma".
 */
export function countsAsDone(m: Meeting, now: Date): boolean {
  return new Date(m.at).getTime() <= now.getTime() && m.attendance !== "absent_unpaid";
}

export interface Progress {
  total: number;
  done: number;
  planned: number;
  /** Quanti incontri restano da fissare (non può scendere sotto zero). */
  left: number;
  /** Assenze non retribuite da recuperare. */
  toRecover: number;
}

export function packageProgress(pkg: Package, meetings: Meeting[], pkgId: string, now: Date): Progress {
  const mine = meetings.filter((m) => m.packageId === pkgId && m.personId === pkg.personId);
  const t = now.getTime();
  const done = mine.filter((m) => countsAsDone(m, now)).length;
  const planned = mine.filter((m) => new Date(m.at).getTime() > t).length;
  const toRecover = mine.filter((m) => new Date(m.at).getTime() <= t && m.attendance === "absent_unpaid").length;
  return { total: pkg.total, done, planned, left: Math.max(0, pkg.total - done - planned), toRecover };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Per i doppioni: stessa persona se il nome coincide ignorando maiuscole, accenti e spazi. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
