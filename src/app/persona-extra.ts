// Sezioni della scheda persona: dati di lavoro, orari abituali, avvisi, materiali, portale.

import { copyText, euroInput, field, h, icon, openSheet, toast } from "./dom.js";
import { MAX_SLOTS, MODE_LABEL, normalizePerson, type Entity, type Person, type Slot, type Structure } from "./model.js";
import { buildPackage } from "./portal.js";
import { renderPortal } from "./portal-view.js";
import type { Sharing } from "./sharing.js";
import type { Studio } from "./store.js";
import { addMaterial, addNotice, removeMaterial, removeNotice, setUsualSlots, setWorkData } from "./work.js";

export const WEEKDAYS = ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const note = (text: string) => h("p", { class: "muted" }, text);

// ---- Dati di lavoro -------------------------------------------------------------

export function workCard(studio: Studio, person: Entity<Person>): HTMLElement {
  const p = normalizePerson(person.value);
  const structure = p.structureId ? studio.get<Structure>(p.structureId) : null;
  const rows: [string, string][] = [
    ["Struttura", structure ? `${structure.value.name} · ${MODE_LABEL[structure.value.mode].toLowerCase()}` : "Nessuna: percorsi e incontri tuoi"],
    ["Tariffa a incontro", p.rate ? `${p.rate} €` : "—"],
    ["Città", p.city || "—"],
    ["Cartella condivisa", p.driveUrl ? "Collegata" : "—"],
  ];
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Dati di lavoro"), h("button", { class: "btn btn-quiet btn-sm", onclick: () => openWorkForm(studio, person) }, icon("matita", 14), h("span", null, "Modifica"))),
    h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
  );
}

function openWorkForm(studio: Studio, person: Entity<Person>): void {
  const p = normalizePerson(person.value);
  const structures = studio.list<Structure>("structure").sort((a, b) => a.value.name.localeCompare(b.value.name, "it"));
  const sel = h(
    "select",
    null,
    h("option", { value: "", selected: !p.structureId }, "Nessuna"),
    ...structures.map((s) => h("option", { value: s.id, selected: p.structureId === s.id }, `${s.value.name} (${MODE_LABEL[s.value.mode].toLowerCase()})`)),
  );
  const rate = h("input", { type: "text", inputmode: "decimal", value: p.rate ? String(p.rate) : "", placeholder: "0" });
  const city = h("input", { type: "text", value: p.city });
  const subjects = h("input", { type: "text", value: p.subjects });
  const drive = h("input", { type: "url", value: p.driveUrl, placeholder: "https://…" });
  openSheet({
    title: "Dati di lavoro",
    submitLabel: "Salva",
    body: [
      field("Struttura", sel, structures.length ? "Se la persona è seguita dentro una struttura, il compenso segue quella struttura." : "Non hai ancora creato strutture (menu Strutture)."),
      field("Tariffa a incontro (€)", rate, "Vale per gli incontri fuori da un percorso a prezzo e da una struttura."),
      field("Città", city),
      field("Materie o aree", subjects),
      field("Cartella condivisa", drive, "Collegamento https a una cartella (Drive o simili)."),
    ],
    onSubmit: async () => {
      await setWorkData(studio, person.id, { city: city.value, subjects: subjects.value, structureId: sel.value || null, rate: euroInput(rate.value), driveUrl: drive.value });
    },
  });
}

// ---- Orari abituali --------------------------------------------------------------

export function slotsCard(studio: Studio, person: Entity<Person>): HTMLElement {
  const slots = normalizePerson(person.value).usualSlots;
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Orari abituali"), h("button", { class: "btn btn-quiet btn-sm", onclick: () => openSlotsForm(studio, person) }, icon("matita", 14), h("span", null, "Modifica"))),
    slots.length
      ? h("ul", { class: "chips" }, ...slots.map((s) => h("li", { class: "chip chip-planned" }, `${WEEKDAYS[s.weekday]!.slice(0, 3)} ${s.time}`)))
      : note("Nessuno. Se la persona viene di solito negli stessi orari, indicali: l'Agenda te li propone."),
  );
}

function openSlotsForm(studio: Studio, person: Entity<Person>): void {
  const current = [...normalizePerson(person.value).usualSlots];
  const list = h("ul", { class: "slot-list" });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const day = h("select", { "aria-label": "Giorno" }, ...WEEKDAYS.slice(1).map((d, i) => h("option", { value: String(i + 1) }, d)));
  const time = h("input", { type: "time", value: "16:00", "aria-label": "Ora" });
  const redraw = () => {
    list.replaceChildren(
      ...(current.length ? [] : [h("li", { class: "muted" }, "Nessun orario.")]),
      ...current.map((s, i) =>
        h("li", { class: "slot" }, h("span", null, `${WEEKDAYS[s.weekday]} alle ${s.time}`), h("button", { type: "button", class: "btn btn-quiet btn-sm", "aria-label": `Togli ${WEEKDAYS[s.weekday]} ${s.time}`, onclick: () => { current.splice(i, 1); redraw(); } }, "Togli")),
      ),
    );
  };
  redraw();
  const add = h(
    "button",
    {
      type: "button",
      class: "btn btn-quiet",
      onclick: () => {
        err.hidden = true;
        if (current.length >= MAX_SLOTS) {
          err.textContent = `Al massimo ${MAX_SLOTS} orari abituali.`;
          err.hidden = false;
          return;
        }
        if (!time.value) return;
        if (!current.some((s) => s.weekday === Number(day.value) && s.time === time.value)) current.push({ weekday: Number(day.value), time: time.value } as Slot);
        current.sort((a, b) => a.weekday - b.weekday || (a.time < b.time ? -1 : 1));
        redraw();
      },
    },
    "Aggiungi",
  );
  openSheet({
    title: "Orari abituali",
    submitLabel: "Salva",
    body: [list, h("div", { class: "row row-wrap" }, day, time, add), err, h("p", { class: "field-hint" }, `Fino a ${MAX_SLOTS} orari a settimana.`)],
    onSubmit: async () => {
      await setUsualSlots(studio, person.id, current);
    },
  });
}

// ---- Avvisi e materiali ---------------------------------------------------------

export function noticesCard(studio: Studio, person: Entity<Person>): HTMLElement {
  const items = normalizePerson(person.value).notices;
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Avvisi per la persona"), h("button", { class: "btn btn-quiet btn-sm", onclick: () => openNoticeForm(studio, person.id) }, icon("piu", 14), h("span", null, "Nuovo"))),
    items.length
      ? h("ul", { class: "plain-list" }, ...items.map((n) => h("li", null, h("span", { class: "preline" }, n.text), h("button", { class: "btn btn-quiet btn-sm", "aria-label": "Togli questo avviso", onclick: async () => { await removeNotice(studio, person.id, n.id); } }, "Togli"))))
      : note("Nessuno. Un avviso compare nel portale (es. “Giovedì ci vediamo online”)."),
  );
}

function openNoticeForm(studio: Studio, personId: string): void {
  const text = h("textarea", { rows: 3, placeholder: "Scrivi in modo che la persona lo capisca al volo." });
  openSheet({ title: "Nuovo avviso", submitLabel: "Pubblica", body: [field("Avviso", text, "Lo vede la persona nel suo portale.")], onSubmit: async () => { await addNotice(studio, personId, text.value); } });
  text.focus();
}

export function materialsCard(studio: Studio, person: Entity<Person>): HTMLElement {
  const items = normalizePerson(person.value).materials;
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Materiali"), h("button", { class: "btn btn-quiet btn-sm", onclick: () => openMaterialForm(studio, person.id) }, icon("piu", 14), h("span", null, "Aggiungi"))),
    items.length
      ? h("ul", { class: "plain-list" }, ...items.map((m) => h("li", null, h("a", { href: m.url, target: "_blank", rel: "noopener noreferrer" }, m.title), h("button", { class: "btn btn-quiet btn-sm", "aria-label": `Togli ${m.title}`, onclick: async () => { await removeMaterial(studio, person.id, m.id); } }, "Togli"))))
      : note("Nessuno. Collegamenti (https) a dispense, registrazioni, brani."),
  );
}

function openMaterialForm(studio: Studio, personId: string): void {
  const title = h("input", { type: "text", placeholder: "Es. Esercizi di respirazione" });
  const url = h("input", { type: "url", required: true, placeholder: "https://…" });
  openSheet({ title: "Nuovo materiale", submitLabel: "Aggiungi", body: [field("Titolo", title), field("Collegamento", url, "Deve iniziare con https://")], onSubmit: async () => { await addMaterial(studio, personId, { title: title.value, url: url.value }); } });
  title.focus();
}

// ---- Portale ---------------------------------------------------------------------

export function shareCard(studio: Studio, person: Entity<Person>, sharing: Sharing): HTMLElement {
  const active = sharing.of(person.id);
  const preview = () => {
    const pkg = buildPackage(studio, person.id, new Date());
    if (!pkg) return;
    const dlg = h("dialog", { class: "sheet preview", "aria-label": "Anteprima del portale" });
    const close = () => dlg.open && dlg.close();
    dlg.append(renderPortal(pkg, { preview: true }), h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn btn-primary", onclick: close }, "Chiudi anteprima")));
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (e) => e.target === dlg && close());
    document.body.append(dlg);
    dlg.showModal();
  };
  const showLink = (link: string) => {
    const box = h("input", { type: "text", readonly: true, value: link, "aria-label": "Link personale", onfocus: (e: Event) => (e.target as HTMLInputElement).select() });
    openSheet({
      title: "Link per la persona",
      submitLabel: "Copia il link",
      body: [
        h("p", null, `Mandalo a ${person.value.name} (email, messaggio). Con il link e il codice che le arriva per email entra nel suo spazio.`),
        box,
        h("p", { class: "field-hint" }, "Il link contiene la chiave per aprire i suoi dati: mandalo solo a lei."),
      ],
      onSubmit: async () => {
        if (await copyText(link)) toast("Link copiato");
        else {
          box.focus();
          throw new Error("Non riesco a copiare da qui: seleziona il link e copialo a mano.");
        }
      },
    });
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Qualcosa non ha funzionato.");
    }
  };
  if (!active) {
    return h(
      "div",
      { class: "card" },
      h("h2", null, "Portale della persona"),
      note("Non ancora condiviso. La persona vede percorso, prossimo incontro, avvisi, materiali e i resoconti che scegli. Le note private non arrivano mai."),
      h("button", { class: "btn btn-primary", onclick: () => run(async () => showLink(await sharing.enable(person.id))) }, "Dai accesso al portale"),
    );
  }
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Portale della persona"), h("span", { class: "chip chip-planned" }, "Attivo")),
    note("Si aggiorna da solo quando cambi qualcosa che la persona può vedere."),
    h(
      "div",
      { class: "row row-wrap" },
      h("button", { class: "btn btn-quiet", onclick: preview }, "Anteprima"),
      h("button", { class: "btn btn-quiet", onclick: () => run(async () => showLink(sharing.linkFor(person.id)!)) }, "Link"),
    ),
    h(
      "div",
      { class: "row row-wrap" },
      h("button", { class: "btn btn-quiet btn-sm", onclick: () => confirm2("Nuovo link?", "Il vecchio link smette di funzionare subito. Dovrai mandare il nuovo alla persona.", "Crea nuovo link", () => run(async () => showLink(await sharing.renew(person.id)))) }, "Nuovo link"),
      h("button", { class: "btn btn-danger-quiet btn-sm", onclick: () => confirm2("Interrompere la condivisione?", "Il link smette di funzionare subito. Potrai riattivarla quando vuoi, con un link nuovo.", "Interrompi", () => run(() => sharing.disable(person.id))) }, "Interrompi"),
    ),
  );
}

export function confirm2(title: string, text: string, label: string, onYes: () => Promise<void> | void): void {
  openSheet({ title, danger: true, submitLabel: label, body: [h("p", null, text)], onSubmit: async () => { await onYes(); } });
}
