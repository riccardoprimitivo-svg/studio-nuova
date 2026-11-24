// Percorsi: il catalogo dei percorsi con prezzo e quelli attivi.

import { euro } from "./admin.js";
import { euroInput, field, h, icon, openSheet } from "./dom.js";
import { initials, type Person } from "./model.js";
import { activePackage } from "./people.js";
import { confirm2 } from "./persona-extra.js";
import { routeLink } from "./router.js";
import type { Studio } from "./store.js";
import { emptyBox, pageHead } from "./ui.js";
import { deleteCatalogItem, listCatalog, saveCatalogItem } from "./work.js";

export function renderPaths(studio: Studio): HTMLElement {
  const now = new Date();
  const catalog = listCatalog(studio);
  const people = studio.list<Person>("person").sort((a, b) => a.value.name.localeCompare(b.value.name, "it"));
  const active = people.map((p) => ({ p, a: activePackage(studio, p.id, now) })).filter((x) => x.a);

  const cat = h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Catalogo"), h("button", { class: "btn btn-primary btn-sm", onclick: () => openCatalogForm(studio) }, icon("piu", 14), h("span", null, "Nuovo"))),
    catalog.length
      ? h(
          "ul",
          { class: "plain-list" },
          ...catalog.map((c) =>
            h(
              "li",
              null,
              h("span", { class: "stack-text" }, h("strong", null, c.value.title), h("span", { class: "small muted" }, `${c.value.total} ${c.value.total === 1 ? "incontro" : "incontri"} · ${euro(c.value.price)}${c.value.total > 1 && c.value.price ? ` · ${euro(c.value.price / c.value.total)} a incontro` : ""}`)),
              h("button", { class: "btn btn-quiet btn-sm", "aria-label": `Modifica ${c.value.title}`, onclick: () => openCatalogForm(studio, c.id) }, "Modifica"),
            ),
          ),
        )
      : h("p", { class: "muted" }, "Qui metti i percorsi che proponi di solito, con il prezzo. Quando ne apri uno a una persona lo scegli da qui."),
  );

  const act = h(
    "div",
    { class: "card" },
    h("h2", null, "Percorsi attivi"),
    active.length
      ? h("ul", { class: "people-lite" }, ...active.map((x) => h("li", null, routeLink({ view: "persona", id: x.p.id }, { class: "item click person-row" }, h("span", { class: "avatar" }, initials(x.p.value.name)), h("span", { class: "person-main" }, h("span", { class: "person-name" }, x.p.value.name), h("span", { class: "person-sub" }, `${x.a!.pkg.value.title} · ${x.a!.progress.done} di ${x.a!.progress.total}`)), icon("avanti", 18)))))
      : h("p", { class: "muted" }, "Nessun percorso attivo."),
  );

  return h("section", { class: "page" }, pageHead("Percorsi", "I pacchetti che proponi e quelli in corso."), people.length === 0 && catalog.length === 0 ? emptyBox("Ancora niente.", "Crea un percorso nel catalogo, poi lo assegni dalla scheda di una persona.") : null, h("div", { class: "grid" }, h("div", { class: "stack" }, act), h("div", { class: "stack side" }, cat)));
}

function openCatalogForm(studio: Studio, id?: string): void {
  const cur = id ? listCatalog(studio).find((c) => c.id === id) : undefined;
  const title = h("input", { type: "text", required: true, value: cur?.value.title ?? "" });
  const total = h("input", { type: "number", min: 1, max: 200, inputmode: "numeric", required: true, value: String(cur?.value.total ?? 10) });
  const price = h("input", { type: "text", inputmode: "decimal", value: cur ? String(cur.value.price) : "" });
  const sheet = openSheet({
    title: cur ? "Modifica percorso" : "Nuovo percorso nel catalogo",
    submitLabel: "Salva",
    body: [field("Nome", title), field("Numero di incontri", total), field("Prezzo complessivo (€)", price)],
    onSubmit: async () => {
      await saveCatalogItem(studio, { title: title.value, total: Number(total.value), price: euroInput(price.value) }, id);
    },
  });
  if (cur) {
    const del = h("button", { type: "button", class: "btn btn-danger-quiet btn-sm", onclick: () => confirm2("Togliere dal catalogo?", "I percorsi già assegnati alle persone restano come sono.", "Togli", async () => { await deleteCatalogItem(studio, cur.id); sheet.close(); }) }, "Togli dal catalogo");
    price.closest("label")?.after(del);
  }
}
