// Riepilogo: cosa c'è oggi, cosa c'è da fissare, cosa c'è da incassare.

import { euro, summary } from "./admin.js";
import { dayTime, h } from "./dom.js";
import { initials, type Entity, type Meeting, type Person } from "./model.js";
import { activePackage, nextMeeting } from "./people.js";
import { routeLink } from "./router.js";
import type { Studio } from "./store.js";
import { emptyBox, pageHead, statBox } from "./ui.js";
import { getBook } from "./work.js";

const DAY = 86_400_000;

export function renderSummary(studio: Studio): HTMLElement {
  const now = new Date();
  const t = now.getTime();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const people = new Map(studio.list<Person>("person").map((p) => [p.id, p] as const));
  const upcoming = studio
    .list<Meeting>("meeting")
    .filter((m) => new Date(m.value.at).getTime() >= start.getTime() && new Date(m.value.at).getTime() <= t + 7 * DAY && people.has(m.value.personId))
    .sort((a, b) => (a.value.at < b.value.at ? -1 : 1));
  const today = upcoming.filter((m) => new Date(m.value.at).getTime() < start.getTime() + DAY);
  const sum = summary(getBook(studio), now);

  const toFix = [...people.values()]
    .map((p) => ({ p, act: activePackage(studio, p.id, now), next: nextMeeting(studio, p.id, now) }))
    .filter((x) => x.act && x.act.progress.left > 0 && !x.next)
    .slice(0, 6);
  const owed = sum.owners.filter((o) => o.residual > 0).slice(0, 4);

  const who = (m: Entity<Meeting>) => people.get(m.value.personId)!;

  const nextCard = h(
    "div",
    { class: "card" },
    h("h2", null, "Prossimi sette giorni"),
    upcoming.length
      ? h(
          "ul",
          { class: "people-lite" },
          ...upcoming.slice(0, 8).map((m) =>
            h("li", null, routeLink({ view: "persona", id: m.value.personId }, { class: "item click person-row" }, h("span", { class: "avatar" }, initials(who(m).value.name)), h("span", { class: "person-main" }, h("span", { class: "person-name" }, who(m).value.name), h("span", { class: "person-sub" }, dayTime(m.value.at))))),
          ),
        )
      : h("p", { class: "muted" }, "Nessun incontro in programma."),
  );

  const fixCard = h(
    "div",
    { class: "card" },
    h("h2", null, "Da fissare"),
    toFix.length
      ? h("ul", { class: "people-lite" }, ...toFix.map((x) => h("li", null, routeLink({ view: "persona", id: x.p.id }, { class: "item click person-row" }, h("span", { class: "avatar" }, initials(x.p.value.name)), h("span", { class: "person-main" }, h("span", { class: "person-name" }, x.p.value.name), h("span", { class: "person-sub" }, `${x.act!.progress.left} ${x.act!.progress.left === 1 ? "incontro" : "incontri"} da fissare`))))))
      : h("p", { class: "muted" }, "Nessuno: ogni percorso attivo ha già un prossimo incontro."),
  );

  const moneyCard = h(
    "div",
    { class: "card" },
    h("h2", null, "Da incassare"),
    owed.length
      ? h("ul", { class: "plain-list" }, ...owed.map((o) => h("li", null, h("span", null, o.name), h("strong", null, euro(o.residual)))))
      : h("p", { class: "muted" }, "Niente in sospeso."),
    routeLink({ view: "amministrazione" }, { class: "back" }, h("span", null, "Vai all'amministrazione")),
  );

  return h(
    "section",
    { class: "page" },
    pageHead("Riepilogo", new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(now)),
    h("div", { class: "glance" }, statBox("Oggi", String(today.length), today.length === 1 ? "incontro" : "incontri"), statBox("Sette giorni", String(upcoming.length), upcoming.length === 1 ? "incontro" : "incontri"), statBox("Stima del mese", euro(sum.month.estimate), `${euro(sum.month.done)} già maturati`, true)),
    studio.list("person").length === 0
      ? emptyBox("Benvenuto in Studio.", "Comincia aggiungendo la prima persona dal menu Persone.", routeLink({ view: "persone" }, { class: "btn btn-primary" }, "Vai alle persone"))
      : h("div", { class: "grid" }, h("div", { class: "stack" }, nextCard), h("div", { class: "stack side" }, fixCard, moneyCard)),
  );
}
