// Lettura dei testi legali e riquadro di accettazione.

import { h } from "./dom.js";
import { DECLARATIONS, documents, type DocKey, type LegalSection } from "./legal.js";

/** Finestra di sola lettura. Si chiude con il pulsante, con Esc o toccando fuori. */
export function openReader(title: string, sections: LegalSection[], intro?: string): void {
  const dlg = h("dialog", { class: "sheet reader", "aria-label": title });
  const close = () => dlg.open && dlg.close();
  dlg.append(
    h(
      "div",
      { class: "reader-body" },
      h("h2", null, title),
      intro ? h("p", { class: "lead" }, intro) : null,
      ...sections.flatMap((s) => [h("h3", null, s.title), ...s.paragraphs.map((p) => h("p", null, p))]),
    ),
    h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn btn-primary", onclick: close }, "Chiudi")),
  );
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) close();
  });
  document.body.append(dlg);
  dlg.showModal();
}

export function openDocument(key: DocKey): void {
  const doc = documents().find((d) => d.key === key);
  if (doc) openReader(doc.title, doc.sections, `Versione del ${doc.version.split("-").reverse().join("/")}. ${doc.summary}`);
}

export interface AcceptanceBox {
  node: HTMLElement;
  /** Tutte le caselle spuntate. */
  ok(): boolean;
}

/** I tre testi da leggere e le tre caselle da spuntare. `onChange` dice se si può procedere. */
export function acceptanceBox(onChange: (ok: boolean) => void, only?: DocKey[]): AcceptanceBox {
  const docs = documents().filter((d) => !only || only.length === 0 || only.includes(d.key));
  const mk = (id: string, label: string) => {
    const cb = h("input", { type: "checkbox", id });
    cb.addEventListener("change", () => onChange(ok()));
    return { cb, row: h("label", { class: "check" }, cb, h("span", null, label)) };
  };
  const read = mk("acc-read", "Ho letto e accetto questi testi.");
  const adults = mk("acc-adults", DECLARATIONS.adultsOnly);
  const health = mk("acc-health", DECLARATIONS.noHealthData);
  const ok = () => read.cb.checked && adults.cb.checked && health.cb.checked;
  const node = h(
    "div",
    { class: "accept" },
    h(
      "ul",
      { class: "legal-list" },
      ...docs.map((d) =>
        h(
          "li",
          null,
          h("div", null, h("strong", null, d.title), h("span", { class: "small" }, d.summary)),
          h("button", { type: "button", class: "btn btn-quiet btn-sm", onclick: () => openDocument(d.key) }, "Leggi"),
        ),
      ),
    ),
    read.row,
    adults.row,
    health.row,
  );
  return { node, ok };
}
