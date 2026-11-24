// Schermate "Persone": elenco e scheda della persona.

import { dayTime, field, h, icon, longDate, nextFullHour, openSheet, todayDate } from "./dom.js";
import {
  ATTENDANCE_LABEL,
  countsAsDone,
  initials,
  type Attendance,
  type Entity,
  type Meeting,
  type Person,
  type Structure,
} from "./model.js";
import {
  activePackage,
  addPackage,
  addPerson,
  deleteMeeting,
  deletePerson,
  lastMeeting,
  meetingsOf,
  nextMeeting,
  packagesOf,
  saveMeeting,
  updatePerson,
} from "./people.js";
import { materialsCard, noticesCard, shareCard, slotsCard, workCard } from "./persona-extra.js";
import { navigate, routeLink } from "./router.js";
import type { Sharing } from "./sharing.js";
import type { Studio } from "./store.js";
import { listCatalog } from "./work.js";

// ---- Elenco -----------------------------------------------------------------

export function renderPeopleList(studio: Studio, query: string, setQuery: (q: string) => void): HTMLElement {
  const now = new Date();
  const q = query.trim().toLowerCase();
  const all = studio
    .list<Person>("person")
    .sort((a, b) => a.value.name.localeCompare(b.value.name, "it", { sensitivity: "base" }));
  const shown = q ? all.filter((p) => p.value.name.toLowerCase().includes(q)) : all;

  const search = h("input", {
    type: "search",
    class: "search-input",
    placeholder: "Cerca per nome",
    "aria-label": "Cerca una persona",
    value: query,
    oninput: (e: Event) => setQuery((e.target as HTMLInputElement).value),
  });

  const list =
    all.length === 0
      ? h(
          "div",
          { class: "empty" },
          h("p", { class: "empty-title" }, "Ancora nessuna persona."),
          h("p", null, "Comincia dalla prima. Bastano il nome e, se vuoi, due righe su ciò che è importante ricordare."),
          h("button", { class: "btn btn-primary", onclick: () => openPersonForm(studio) }, "Aggiungi la prima persona"),
        )
      : shown.length === 0
        ? h("div", { class: "empty" }, h("p", null, `Nessuna persona con “${query.trim()}”.`))
        : h(
            "ul",
            { class: "people card" },
            ...shown.map((p) => {
              const act = activePackage(studio, p.id, now);
              const next = nextMeeting(studio, p.id, now);
              return h(
                "li",
                null,
                routeLink(
                  { view: "persona", id: p.id },
                  { class: "item click person-row" },
                  h("span", { class: "avatar" }, initials(p.value.name)),
                  h(
                    "span",
                    { class: "person-main" },
                    h("span", { class: "person-name" }, p.value.name),
                    h(
                      "span",
                      { class: "person-sub" },
                      act ? `${act.pkg.value.title} · ${act.progress.done} di ${act.progress.total}` : "Nessun percorso attivo",
                    ),
                  ),
                  h("span", { class: "person-side" }, next ? dayTime(next.value.at) : ""),
                  icon("avanti", 18),
                ),
              );
            }),
          );

  return h(
    "section",
    { class: "page" },
    h(
      "header",
      { class: "page-head" },
      h("div", null, h("h1", null, "Persone"), h("p", { class: "sub" }, all.length === 1 ? "1 persona" : `${all.length} persone`)),
      h("button", { class: "btn btn-primary", onclick: () => openPersonForm(studio) }, icon("piu", 18), h("span", null, "Nuova persona")),
    ),
    all.length > 0 ? h("div", { class: "search" }, icon("cerca", 18), search) : null,
    list,
  );
}

// ---- Scheda -----------------------------------------------------------------

export function renderPersonPage(studio: Studio, id: string, goBack: () => void, sharing: Sharing): HTMLElement {
  const person = studio.get<Person>(id);
  if (!person) {
    return h("section", { class: "page" }, h("p", null, "Questa persona non c'è più."), routeLink({ view: "persone" }, null, "Torna alle persone"));
  }
  const now = new Date();
  const p = person.value;
  const act = activePackage(studio, id, now);
  const meetings = meetingsOf(studio, id);
  const done = meetings.filter((m) => countsAsDone(m.value, now)).length;
  const next = nextMeeting(studio, id, now);
  const last = lastMeeting(studio, id, now);

  const contacts = [
    p.email ? h("a", { href: `mailto:${p.email}` }, p.email) : null,
    p.phone ? h("a", { href: `tel:${p.phone.replace(/\s+/g, "")}` }, p.phone) : null,
  ].filter(Boolean) as HTMLElement[];

  const hero = h(
    "div",
    { class: "card hero" },
    h("span", { class: "avatar avatar-lg" }, initials(p.name)),
    h(
      "div",
      { class: "hero-main" },
      h("h1", null, p.name),
      p.goal ? h("p", { class: "hero-goal" }, h("span", { class: "label" }, "Obiettivo"), p.goal) : h("p", { class: "muted" }, "Nessun obiettivo indicato"),
      contacts.length ? h("p", { class: "contacts" }, ...contacts) : null,
    ),
    h("button", { class: "btn btn-quiet", onclick: () => openPersonForm(studio, person) }, icon("matita", 16), h("span", null, "Modifica")),
  );

  const glance = h(
    "div",
    { class: "glance" },
    stat("Incontri svolti", String(done), last ? `ultimo il ${longDate(last.value.at)}` : "nessuno ancora"),
    stat(
      "Percorso",
      act ? `${act.progress.done} / ${act.progress.total}` : "—",
      act ? (act.progress.toRecover ? `${act.progress.toRecover} da recuperare` : act.pkg.value.title) : "nessuno attivo",
    ),
    stat("Prossimo incontro", next ? dayTime(next.value.at) : "—", next ? "" : "da fissare", true),
  );

  const remember = h(
    "div",
    { class: "card card-sand" },
    h("h2", null, "Informazioni da ricordare sempre"),
    p.remember
      ? h("p", { class: "preline" }, p.remember)
      : h("p", { class: "muted" }, "Niente per ora. Qui metti ciò che non vuoi dimenticare prima di ogni incontro."),
  );

  const packageCard = h(
    "div",
    { class: "card" },
    h(
      "div",
      { class: "card-head" },
      h("h2", null, "Percorso"),
      h("button", { class: "btn btn-quiet", onclick: () => openPackageForm(studio, id) }, act ? "Nuovo percorso" : "Crea un percorso"),
    ),
    act
      ? h(
          "div",
          null,
          h("p", { class: "pkg-title" }, act.pkg.value.title),
          bar(act.progress.done, act.progress.planned, act.progress.total),
          h(
            "p",
            { class: "muted small" },
            `${act.progress.done} ${act.progress.done === 1 ? "svolto" : "svolti"} · ${act.progress.planned} in programma · ${act.progress.left} da fissare`,
            act.progress.toRecover ? ` · ${act.progress.toRecover} da recuperare` : "",
          ),
        )
      : h(
          "p",
          { class: "muted" },
          packagesOf(studio, id).length ? "Tutti i percorsi sono completati." : "Nessun percorso. Puoi anche registrare incontri singoli, senza percorso.",
        ),
  );

  const meetingsCard = h(
    "div",
    { class: "card" },
    h(
      "div",
      { class: "card-head" },
      h("h2", null, "Incontri"),
      h("button", { class: "btn btn-primary btn-sm", onclick: () => openMeetingForm(studio, id) }, icon("piu", 16), h("span", null, "Nuovo incontro")),
    ),
    meetings.length === 0
      ? h("p", { class: "muted" }, "Nessun incontro registrato.")
      : h("ul", { class: "meetings" }, ...meetings.map((m) => meetingRow(studio, m, now))),
  );

  const danger = h(
    "div",
    { class: "danger-zone" },
    h("button", { class: "btn btn-danger-quiet", onclick: () => confirmDelete(studio, person, goBack) }, "Elimina questa persona"),
  );

  return h(
    "section",
    { class: "page" },
    routeLink({ view: "persone" }, { class: "back" }, icon("indietro", 18), h("span", null, "Persone")),
    hero,
    glance,
    h("div", { class: "grid" }, h("div", { class: "stack" }, meetingsCard), h(
        "div",
        { class: "stack side" },
        remember,
        packageCard,
        shareCard(studio, person, sharing),
        noticesCard(studio, person),
        materialsCard(studio, person),
        slotsCard(studio, person),
        workCard(studio, person),
      ),
    ),
    danger,
  );
}

function stat(label: string, value: string, sub: string, text = false): HTMLElement {
  return h("div", { class: "stat" }, h("span", { class: "label" }, label), h("span", { class: text ? "stat-value stat-text" : "stat-value" }, value), h("span", { class: "stat-sub" }, sub));
}

function bar(done: number, planned: number, total: number): HTMLElement {
  const pct = (n: number) => `${Math.min(100, (n / Math.max(total, 1)) * 100)}%`;
  return h(
    "div",
    { class: "bar", role: "img", "aria-label": `${done} svolti su ${total}` },
    h("span", { class: "bar-done", style: `width:${pct(done)}` }),
    h("span", { class: "bar-planned", style: `width:${pct(planned)}` }),
  );
}

function meetingRow(studio: Studio, m: Entity<Meeting>, now: Date): HTMLElement {
  const future = new Date(m.value.at).getTime() > now.getTime();
  return h(
    "li",
    null,
    h(
      "button",
      { class: "meeting", onclick: () => openMeetingForm(studio, m.value.personId, m) },
      h(
        "span",
        { class: "meeting-top" },
        h("span", { class: "meeting-date" }, dayTime(m.value.at)),
        h("span", { class: future ? "chip chip-planned" : m.value.attendance === "absent_unpaid" ? "chip chip-warn" : "chip" }, future ? "In programma" : ATTENDANCE_LABEL[m.value.attendance]),
      ),
      m.value.sharedReport ? h("span", { class: "meeting-note" }, icon("condiviso", 14), h("span", null, m.value.sharedReport)) : null,
      m.value.privateNote ? h("span", { class: "meeting-note private" }, icon("lucchetto", 14), h("span", null, m.value.privateNote)) : null,
    ),
  );
}

// ---- Moduli -----------------------------------------------------------------

function openPersonForm(studio: Studio, existing?: Entity<Person>): void {
  const v = existing?.value;
  const name = h("input", { type: "text", required: true, value: v?.name ?? "", autocomplete: "off" });
  const email = h("input", { type: "email", value: v?.email ?? "", autocomplete: "off" });
  const phone = h("input", { type: "tel", value: v?.phone ?? "", autocomplete: "off" });
  const goal = h("input", { type: "text", value: v?.goal ?? "", autocomplete: "off" });
  const remember = h("textarea", { rows: 4, value: v?.remember ?? "" });
  openSheet({
    title: existing ? "Modifica persona" : "Nuova persona",
    submitLabel: "Salva",
    body: [
      field("Nome d'elezione", name, "Solo il nome, senza cognome."),
      field("Obiettivo", goal, "Anche in due parole."),
      field("Informazioni da ricordare sempre", remember, "Restano solo tue."),
      field("Email", email),
      field("Telefono", phone),
    ],
    onSubmit: async () => {
      const input = { name: name.value, email: email.value, phone: phone.value, goal: goal.value, remember: remember.value };
      if (existing) await updatePerson(studio, existing.id, input);
      else {
        const created = await addPerson(studio, input);
        navigate({ view: "persona", id: created.id });
      }
    },
  });
  name.focus();
}

function openPackageForm(studio: Studio, personId: string): void {
  const catalog = listCatalog(studio);
  const title = h("input", { type: "text", placeholder: "Se vuoi, un nome (es. Percorso autunno)", autocomplete: "off" });
  const total = h("input", { type: "number", min: 1, max: 200, value: "10", inputmode: "numeric", required: true });
  const price = h("input", { type: "text", inputmode: "decimal", placeholder: "Lascia vuoto se non è a pacchetto" });
  const started = h("input", { type: "date", value: todayDate(), required: true });
  const preset = h(
    "select",
    { "aria-label": "Dal catalogo" },
    h("option", { value: "" }, "Nessuno: lo scrivo io"),
    ...catalog.map((c) => h("option", { value: c.id }, `${c.value.title} · ${c.value.total} incontri · ${c.value.price} €`)),
  );
  preset.addEventListener("change", () => {
    const c = catalog.find((x) => x.id === preset.value);
    if (!c) return;
    title.value = c.value.title;
    total.value = String(c.value.total);
    price.value = c.value.price ? String(c.value.price) : "";
  });
  openSheet({
    title: "Nuovo percorso",
    submitLabel: "Crea percorso",
    body: [
      catalog.length ? field("Dal catalogo", preset, "Compila nome, incontri e prezzo.") : h("span"),
      field("Nome", title),
      field("Numero di incontri", total),
      field("Prezzo complessivo (€)", price, "Serve ai conti: il prezzo viene diviso per gli incontri."),
      field("Data di inizio", started),
    ],
    onSubmit: async () => {
      const raw = price.value.replace(",", ".").trim();
      await addPackage(studio, personId, { title: title.value, total: Number(total.value), startedAt: started.value, ...(raw ? { price: Number(raw) } : {}) });
    },
  });
}

function openMeetingForm(studio: Studio, personId: string, existing?: Entity<Meeting>): void {
  const v = existing?.value;
  const now = new Date();
  const at = h("input", { type: "datetime-local", required: true, value: v?.at ?? nextFullHour(now) });
  const attendance = h(
    "select",
    null,
    ...(Object.keys(ATTENDANCE_LABEL) as Attendance[]).map((k) => h("option", { value: k, selected: (v?.attendance ?? "none") === k }, ATTENDANCE_LABEL[k])),
  );
  const act = activePackage(studio, personId, now);
  const pkgs = packagesOf(studio, personId);
  const current = v ? v.packageId : act?.pkg.id ?? null;
  const pkg = h(
    "select",
    null,
    h("option", { value: "", selected: current === null }, "Incontro singolo (senza percorso)"),
    ...pkgs.map((p) => h("option", { value: p.id, selected: current === p.id }, p.value.title)),
  );
  const privateNote = h("textarea", { rows: 3, value: v?.privateNote ?? "" });
  const shared = h("textarea", { rows: 3, value: v?.sharedReport ?? "" });
  const personEnt = studio.get<Person>(personId);
  const structure = personEnt?.value.structureId ? studio.get<Structure>(personEnt.value.structureId) : null;
  const minutes = h("input", { type: "number", min: 15, max: 480, step: 5, inputmode: "numeric", value: String(v?.minutes ?? structure?.value.minutes ?? 60) });
  const hint = h("span", { class: "field-hint" });
  const syncHint = () => {
    hint.textContent = at.value ? (new Date(at.value).getTime() > Date.now() ? "In programma" : "Svolto") : "";
  };
  at.addEventListener("input", syncHint);
  syncHint();

  const body: Node[] = [
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Data e ora"), at, hint),
    field("Presenza", attendance),
    structure?.value.mode === "per_hour" ? field("Durata (minuti)", minutes, "Il compenso della struttura è a ora.") : h("span"),
    pkgs.length ? field("Percorso", pkg) : h("span"),
    field("Nota privata", privateNote, "Solo per te. Non si vede mai nel portale."),
    field("Resoconto per la persona", shared, "Si vede nel suo portale. Puoi lasciarlo vuoto."),
  ];
  const sheet = openSheet({
    title: existing ? "Incontro" : "Nuovo incontro",
    submitLabel: "Salva",
    body,
    onSubmit: async () => {
      await saveMeeting(
        studio,
        personId,
        {
          at: at.value,
          attendance: attendance.value as Attendance,
          packageId: pkg.value || null,
          privateNote: privateNote.value,
          sharedReport: shared.value,
          ...(structure?.value.mode === "per_hour" ? { minutes: Number(minutes.value) } : {}),
        },
        existing?.id,
      );
    },
  });
  if (existing) {
    const del = h(
      "button",
      {
        type: "button",
        class: "btn btn-danger-quiet btn-sm",
        onclick: async () => {
          openSheet({
            title: "Eliminare questo incontro?",
            danger: true,
            submitLabel: "Elimina",
            body: [h("p", null, "Non si può annullare.")],
            onSubmit: async () => {
              await deleteMeeting(studio, existing.id);
              sheet.close();
            },
          });
        },
      },
      "Elimina incontro",
    );
    (body[body.length - 1] as HTMLElement).after(del);
  }
}

function confirmDelete(studio: Studio, person: Entity<Person>, goBack: () => void): void {
  const meetings = meetingsOf(studio, person.id).length;
  openSheet({
    title: `Eliminare ${person.value.name}?`,
    danger: true,
    submitLabel: "Elimina per sempre",
    body: [
      h(
        "p",
        null,
        `Spariscono anche ${meetings === 1 ? "il suo incontro" : `i suoi ${meetings} incontri`}, i percorsi e le note. Non si può annullare.`,
      ),
    ],
    onSubmit: async () => {
      await deletePerson(studio, person.id);
      goBack();
    },
  });
}
