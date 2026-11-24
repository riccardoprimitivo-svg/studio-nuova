// Agenda: la settimana, con gli orari abituali proposti come bozze da confermare.

import { field, h, icon, nextFullHour, openSheet, toast } from "./dom.js";
import { normalizePerson, type Entity, type Meeting, type Person } from "./model.js";
import { activePackage, saveMeeting } from "./people.js";
import { WEEKDAYS } from "./persona-extra.js";
import { routeLink } from "./router.js";
import type { Studio } from "./store.js";
import { emptyBox, pageHead } from "./ui.js";

let offset = 0; // settimane rispetto a questa

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function monday(base: Date, weeks: number): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7);
  return d;
}

export function renderAgenda(studio: Studio, rerender: () => void): HTMLElement {
  const now = new Date();
  const first = monday(now, offset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const people = new Map(studio.list<Person>("person").map((p) => [p.id, p] as const));
  const meetings = studio.list<Meeting>("meeting").filter((m) => people.has(m.value.personId));

  const fmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long" });
  const label = `${fmt.format(days[0]!)} – ${fmt.format(days[6]!)}`;

  const nav = h(
    "div",
    { class: "row row-wrap" },
    h("button", { class: "btn btn-quiet", "aria-label": "Settimana precedente", onclick: () => { offset -= 1; rerender(); } }, icon("indietro", 16)),
    h("button", { class: "btn btn-quiet", onclick: () => { offset = 0; rerender(); } }, "Questa settimana"),
    h("button", { class: "btn btn-quiet", "aria-label": "Settimana successiva", onclick: () => { offset += 1; rerender(); } }, icon("avanti", 16)),
  );

  const head = pageHead("Agenda", label, h("button", { class: "btn btn-primary", onclick: () => openQuickMeeting(studio) }, icon("piu", 18), h("span", null, "Nuovo incontro")));

  if (people.size === 0) {
    return h("section", { class: "page" }, head, emptyBox("Nessuna persona.", "Aggiungi prima una persona: poi potrai fissare gli incontri.", routeLink({ view: "persone" }, { class: "btn btn-primary" }, "Vai alle persone")));
  }

  const dayBlocks = days.map((d) => {
    const key = ymd(d);
    const mine = meetings.filter((m) => m.value.at.startsWith(key)).sort((a, b) => (a.value.at < b.value.at ? -1 : 1));
    const ghosts: { person: Entity<Person>; at: string }[] = [];
    for (const p of people.values()) {
      for (const s of normalizePerson(p.value).usualSlots) {
        if (s.weekday !== ((d.getDay() + 6) % 7) + 1) continue;
        const at = `${key}T${s.time}`;
        if (new Date(at).getTime() <= now.getTime()) continue;
        if (meetings.some((m) => m.value.personId === p.id && m.value.at === at)) continue;
        const act = activePackage(studio, p.id, now);
        if (act && act.progress.left <= 0) continue;
        ghosts.push({ person: p, at });
      }
    }
    ghosts.sort((a, b) => (a.at < b.at ? -1 : 1));
    const isToday = key === ymd(now);
    return h(
      "section",
      { class: isToday ? "card day today" : "card day", "aria-label": `${WEEKDAYS[((d.getDay() + 6) % 7) + 1]} ${d.getDate()}` },
      h("h2", null, `${WEEKDAYS[((d.getDay() + 6) % 7) + 1]!.slice(0, 3)} ${d.getDate()}`, isToday ? h("span", { class: "chip chip-planned" }, "Oggi") : null),
      mine.length || ghosts.length
        ? h(
            "ul",
            { class: "plain-list" },
            ...mine.map((m) =>
              h("li", null, routeLink({ view: "persona", id: m.value.personId }, { class: "day-link" }, h("strong", null, m.value.at.slice(11)), " ", people.get(m.value.personId)!.value.name), new Date(m.value.at).getTime() > now.getTime() ? h("span", { class: "chip chip-planned" }, "In programma") : null),
            ),
            ...ghosts.map((g) =>
              h(
                "li",
                { class: "ghost" },
                h("span", null, h("strong", null, g.at.slice(11)), " ", g.person.value.name, h("span", { class: "small muted" }, " · orario abituale")),
                h("button", { class: "btn btn-quiet btn-sm", "aria-label": `Fissa ${g.person.value.name} alle ${g.at.slice(11)}`, onclick: async () => { await fix(studio, g.person.id, g.at); toast("Incontro fissato"); } }, "Fissa"),
              ),
            ),
          )
        : h("p", { class: "muted" }, "Niente."),
    );
  });

  return h("section", { class: "page" }, head, nav, h("div", { class: "week" }, ...dayBlocks));
}

async function fix(studio: Studio, personId: string, at: string) {
  const act = activePackage(studio, personId, new Date());
  await saveMeeting(studio, personId, { at, attendance: "none", privateNote: "", sharedReport: "", packageId: act?.pkg.id ?? null });
}

function openQuickMeeting(studio: Studio): void {
  const people = studio.list<Person>("person").sort((a, b) => a.value.name.localeCompare(b.value.name, "it"));
  const who = h("select", null, ...people.map((p) => h("option", { value: p.id }, p.value.name)));
  const at = h("input", { type: "datetime-local", required: true, value: nextFullHour() });
  openSheet({
    title: "Nuovo incontro",
    submitLabel: "Fissa",
    body: [field("Persona", who), field("Data e ora", at)],
    onSubmit: async () => {
      await fix(studio, who.value, at.value);
    },
  });
}
