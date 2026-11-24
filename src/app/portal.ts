// Pacchetto che la persona vede nel portale.
//
// Qui si decide cosa esce dall'archivio di chi insegna. Regola unica: ci va solo ciò che serve
// alla persona, scritto in modo che lei lo possa leggere. Le note private, le informazioni
// "da ricordare", le tariffe, i pagamenti e i recapiti della persona NON entrano mai.

import { ATTENDANCE_LABEL, normalizePerson, packageProgress, type Attendance, type Meeting, type Package, type Person } from "./model.js";
import { Studio } from "./store.js";
import { activePackage, nextMeeting } from "./people.js";
import { profileValue } from "./work.js";

export interface PortalHistoryItem {
  at: string;
  attendance: string;
  report: string;
}

export interface PortalPackage {
  version: 1;
  /** Nome della persona, come la chiami tu. */
  name: string;
  teacher: { name: string; bio: string; email: string; phone: string };
  goal: string;
  path: { title: string; total: number; done: number; planned: number; left: number; toRecover: number } | null;
  nextMeeting: string | null;
  notices: { text: string; at: string }[];
  materials: { title: string; url: string }[];
  driveUrl: string;
  history: PortalHistoryItem[];
}

export function buildPackage(studio: Studio, personId: string, now: Date): PortalPackage | null {
  const ent = studio.get<Person>(personId);
  if (!ent) return null;
  const person = normalizePerson(ent.value);
  const profile = profileValue(studio);
  const active = activePackage(studio, personId, now);
  const next = nextMeeting(studio, personId, now);
  const all = studio.list<Meeting>("meeting").map((m) => m.value);
  const t = now.getTime();

  // L'ultimo percorso, anche se concluso, così la persona vede "4 di 4" invece di niente.
  let path: PortalPackage["path"] = null;
  const shown = active?.pkg ?? lastPackage(studio, personId);
  if (shown) {
    const pr = active?.progress ?? packageProgress(shown.value, all, shown.id, now);
    path = { title: shown.value.title, total: pr.total, done: pr.done, planned: pr.planned, left: pr.left, toRecover: pr.toRecover };
  }

  const history = studio
    .list<Meeting>("meeting")
    .filter((m) => m.value.personId === personId && new Date(m.value.at).getTime() <= t)
    .sort((a, b) => (a.value.at < b.value.at ? 1 : -1))
    .map((m) => ({
      at: m.value.at,
      attendance: m.value.attendance === "none" ? "" : ATTENDANCE_LABEL[m.value.attendance as Attendance],
      report: m.value.sharedReport.trim(),
    }));

  return {
    version: 1,
    name: person.name,
    teacher: {
      name: profile.displayName,
      bio: profile.bio,
      email: profile.shareEmail ? profile.email : "",
      phone: profile.sharePhone ? profile.phone : "",
    },
    goal: person.goal,
    path,
    nextMeeting: next?.value.at ?? null,
    notices: person.notices.map((n) => ({ text: n.text, at: n.at })),
    materials: person.materials.map((m) => ({ title: m.title, url: m.url })),
    driveUrl: person.driveUrl,
    history,
  };
}

function lastPackage(studio: Studio, personId: string) {
  return (
    studio
      .list<Package>("package")
      .filter((p) => p.value.personId === personId)
      .sort((a, b) => (a.value.startedAt < b.value.startedAt ? 1 : -1))[0] ?? null
  );
}
