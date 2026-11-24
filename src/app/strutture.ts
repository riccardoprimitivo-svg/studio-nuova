// Strutture: scuole, centri, associazioni che ti riconoscono il lavoro.

import { euro, summary } from "./admin.js";
import { euroInput, field, h, icon, openSheet } from "./dom.js";
import { MODE_LABEL, type Person, type Structure, type StructureMode } from "./model.js";
import { confirm2 } from "./persona-extra.js";
import type { Studio } from "./store.js";
import { emptyBox, pageHead } from "./ui.js";
import { deleteStructure, getBook, saveStructure } from "./work.js";

export function renderStructures(studio: Studio): HTMLElement {
  const items = studio.list<Structure>("structure").sort((a, b) => a.value.name.localeCompare(b.value.name, "it"));
  const people = studio.list<Person>("person");
  const sum = summary(getBook(studio), new Date());
  const add = h("button", { class: "btn btn-primary", onclick: () => openForm(studio) }, icon("piu", 18), h("span", null, "Nuova struttura"));

  return h(
    "section",
    { class: "page" },
    pageHead("Strutture", "Dove il compenso lo stabilisce chi ti ingaggia.", add),
    items.length === 0
      ? emptyBox("Nessuna struttura.", "Se lavori anche per una scuola o un centro, aggiungila qui: scegli se ti pagano a incontro, a ora o al mese, e poi associ le persone che segui lì.")
      : h(
          "div",
          { class: "cards" },
          ...items.map((s) => {
            const mine = people.filter((p) => p.value.structureId === s.id);
            const bal = sum.owners.find((o) => o.kind === "structure" && o.id === s.id);
            return h(
              "div",
              { class: "card" },
              h("div", { class: "card-head" }, h("h2", null, s.value.name), h("button", { class: "btn btn-quiet btn-sm", "aria-label": `Modifica ${s.value.name}`, onclick: () => openForm(studio, s.id) }, icon("matita", 14), h("span", null, "Modifica"))),
              h("p", null, `${MODE_LABEL[s.value.mode]}: ${euro(s.value.amount)}${s.value.mode === "per_hour" ? ` · incontri da ${s.value.minutes} minuti` : ""}`),
              h("p", { class: "muted small" }, mine.length ? mine.map((p) => p.value.name).join(", ") : "Nessuna persona associata."),
              h("p", { class: "small" }, `Registrato ${euro(bal?.registered ?? 0)} · incassato ${euro(bal?.collected ?? 0)} · residuo ${euro(bal?.residual ?? 0)}`),
            );
          }),
        ),
  );
}

function openForm(studio: Studio, id?: string): void {
  const cur = id ? studio.get<Structure>(id) : null;
  const name = h("input", { type: "text", required: true, value: cur?.value.name ?? "" });
  const mode = h("select", null, ...(Object.keys(MODE_LABEL) as StructureMode[]).map((m) => h("option", { value: m, selected: (cur?.value.mode ?? "per_meeting") === m }, MODE_LABEL[m])));
  const amount = h("input", { type: "text", inputmode: "decimal", required: true, value: cur ? String(cur.value.amount) : "" });
  const minutes = h("input", { type: "number", min: 15, max: 480, step: 5, inputmode: "numeric", value: String(cur?.value.minutes ?? 60) });
  const hint = h("span", { class: "field-hint" });
  const syncHint = () => {
    hint.textContent = { per_meeting: "Importo per ogni incontro svolto.", per_hour: "Importo per ora: si calcola sulla durata di ogni incontro.", per_month: "Quota fissa per ogni mese in cui c'è almeno un incontro." }[mode.value as StructureMode];
  };
  mode.addEventListener("change", syncHint);
  syncHint();
  const sheet = openSheet({
    title: cur ? "Modifica struttura" : "Nuova struttura",
    submitLabel: "Salva",
    body: [field("Nome", name), h("label", { class: "field" }, h("span", { class: "field-label" }, "Come ti pagano"), mode, hint), field("Importo (€)", amount), field("Durata abituale (minuti)", minutes, "Serve solo per il compenso a ora.")],
    onSubmit: async () => {
      await saveStructure(studio, { name: name.value, mode: mode.value as StructureMode, amount: euroInput(amount.value), minutes: Number(minutes.value) }, id);
    },
  });
  if (cur) {
    const del = h("button", { type: "button", class: "btn btn-danger-quiet btn-sm", onclick: () => confirm2(`Eliminare ${cur.value.name}?`, "Le persone associate restano, ma tornano a compenso individuale. Spariscono i pagamenti registrati per questa struttura.", "Elimina", async () => { await deleteStructure(studio, cur.id); sheet.close(); }) }, "Elimina struttura");
    minutes.closest("label")?.after(del);
  }
}
