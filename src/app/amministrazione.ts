// Amministrazione: registrato, incassato, residuo. Non è contabilità: serve a vedere il quadro.

import { euro, summary } from "./admin.js";
import { euroInput, field, h, icon, openSheet, todayDate } from "./dom.js";
import type { Person, Structure } from "./model.js";
import type { Payment } from "./model.js";
import { confirm2 } from "./persona-extra.js";
import type { Studio } from "./store.js";
import { emptyBox, pageHead, statBox } from "./ui.js";
import { addPayment, deletePayment, getBook } from "./work.js";

export function renderAdmin(studio: Studio): HTMLElement {
  const now = new Date();
  const book = getBook(studio);
  const s = summary(book, now);
  const names = new Map<string, string>([...book.people.map((p) => [`person:${p.id}`, p.value.name] as const), ...book.structures.map((x) => [`structure:${x.id}`, x.value.name] as const)]);
  const pays = [...book.payments].sort((a, b) => (a.value.at < b.value.at ? 1 : -1)).slice(0, 12);

  const add = h("button", { class: "btn btn-primary", onclick: () => openPaymentForm(studio) }, icon("piu", 18), h("span", null, "Registra pagamento"));
  const empty = book.people.length === 0;

  return h(
    "section",
    { class: "page" },
    pageHead("Amministrazione", "Quanto hai maturato, incassato e quanto resta.", empty ? null : add),
    empty
      ? emptyBox("Niente da mostrare.", "I conti partono dagli incontri svolti. Aggiungi una persona e indica un percorso a prezzo, una tariffa o una struttura.")
      : h(
          "div",
          { class: "stack" },
          h("div", { class: "glance" }, statBox("Registrato", euro(s.registered), "incontri svolti", true), statBox("Incassato", euro(s.collected), "pagamenti segnati", true), statBox("Residuo", euro(s.residual), s.residual < 0 ? "hai incassato in anticipo" : "ancora da incassare", true)),
          h("div", { class: "card card-sand" }, h("h2", null, "Questo mese"), h("p", null, `${euro(s.month.done)} già maturati e ${euro(s.month.planned)} in programma: stima ${euro(s.month.estimate)}.`)),
          h(
            "div",
            { class: "card" },
            h("h2", null, "Per persona o struttura"),
            s.owners.length
              ? h("ul", { class: "plain-list" }, ...s.owners.map((o) => h("li", null, h("span", { class: "stack-text" }, h("strong", null, o.name), h("span", { class: "small muted" }, `Registrato ${euro(o.registered)} · incassato ${euro(o.collected)}`)), h("strong", { class: o.residual > 0 ? "due" : "" }, euro(o.residual)))))
              : h("p", { class: "muted" }, "Ancora nessun incontro con un compenso. Controlla che la persona abbia un percorso a prezzo, una tariffa o una struttura."),
          ),
          h(
            "div",
            { class: "card" },
            h("h2", null, "Ultimi pagamenti"),
            pays.length
              ? h("ul", { class: "plain-list" }, ...pays.map((p) => h("li", null, h("span", { class: "stack-text" }, h("strong", null, `${euro(p.value.amount)} · ${names.get(`${p.value.ownerKind}:${p.value.ownerId}`) ?? "(eliminato)"}`), h("span", { class: "small muted" }, `${p.value.at.split("-").reverse().join("/")}${p.value.note ? ` · ${p.value.note}` : ""}`)), h("button", { class: "btn btn-quiet btn-sm", "aria-label": "Elimina questo pagamento", onclick: () => confirm2("Eliminare il pagamento?", "Il residuo si aggiorna di conseguenza.", "Elimina", async () => { await deletePayment(studio, p.id); }) }, "Elimina"))))
              : h("p", { class: "muted" }, "Nessun pagamento registrato."),
          ),
          h("p", { class: "small muted" }, "Queste cifre ti aiutano a tenere il conto, ma non sono contabilità né fatturazione: gli obblighi fiscali restano tuoi."),
        ),
  );
}

function openPaymentForm(studio: Studio): void {
  const people = studio.list<Person>("person").sort((a, b) => a.value.name.localeCompare(b.value.name, "it"));
  const structures = studio.list<Structure>("structure").sort((a, b) => a.value.name.localeCompare(b.value.name, "it"));
  const who = h(
    "select",
    null,
    h("optgroup", { label: "Persone" }, ...people.map((p) => h("option", { value: `person:${p.id}` }, p.value.name))),
    structures.length ? h("optgroup", { label: "Strutture" }, ...structures.map((x) => h("option", { value: `structure:${x.id}` }, x.value.name))) : null,
  );
  const amount = h("input", { type: "text", inputmode: "decimal", required: true });
  const at = h("input", { type: "date", required: true, value: todayDate() });
  const note = h("input", { type: "text", placeholder: "Es. bonifico di novembre" });
  openSheet({
    title: "Registra pagamento",
    submitLabel: "Salva",
    body: [field("Da chi", who), field("Importo (€)", amount), field("Data", at), field("Nota", note)],
    onSubmit: async () => {
      const [kind, id] = who.value.split(":") as ["person" | "structure", string];
      await addPayment(studio, { ownerKind: kind, ownerId: id, amount: euroInput(amount.value), at: at.value, note: note.value } satisfies Payment);
    },
  });
  amount.focus();
}
