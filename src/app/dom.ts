// Piccoli strumenti per costruire il DOM senza librerie.
// Il testo passa sempre da textContent: niente HTML iniettato dai dati.

export type Child = Node | string | number | null | false | undefined;
type Attrs = Record<string, unknown> | null;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "class") {
      el.className = String(v);
    } else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(typeof c === "number" ? String(c) : c);
  }
  return el;
}

const ICONS: Record<string, string> = {
  riepilogo: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10.5V19h11v-8.5"/>',
  agenda: '<rect x="4.5" y="6" width="15" height="13" rx="2.5"/><path d="M4.5 10.5h15M9 4v4M15 4v4"/>',
  persone: '<circle cx="9.5" cy="9" r="3"/><path d="M4 19c.5-3 2.7-4.7 5.5-4.7S14.500 16 15 19"/><path d="M15.500 6.200a3 3 0 0 1 0 5.600M17 14.600c1.700.6 2.800 2 3 4.400"/>',
  percorsi: '<path d="M6 19V8a3 3 0 0 1 3-3h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h9"/><circle cx="6" cy="19" r="1.200"/><circle cx="18" cy="17" r="1.200"/>',
  strutture: '<path d="M5 19V6.500L12 4l7 2.500V19"/><path d="M3.500 19h17M9 10h1.500M13.500 10H15M9 14h1.500M13.500 14H15"/>',
  amministrazione: '<path d="M16.500 8.500A5 5 0 1 0 16.500 15.500"/><path d="M5 10.500h8M5 13.500h8"/>',
  altro: '<circle cx="6" cy="12" r="1.200"/><circle cx="12" cy="12" r="1.200"/><circle cx="18" cy="12" r="1.200"/>',
  piu: '<path d="M12 5v14M5 12h14"/>',
  cerca: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.200-4.200"/>',
  indietro: '<path d="M14.500 6 8.500 12l6 6"/>',
  avanti: '<path d="M9.500 6l6 6-6 6"/>',
  lucchetto: '<rect x="5.500" y="10.500" width="13" height="9" rx="2.500"/><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500"/>',
  matita: '<path d="M5 19l1-4L16.500 4.500a2 2 0 0 1 3 3L9 18z"/><path d="M14.500 6.500l3 3"/>',
  impostazioni: '<circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.300 6.300l1.400 1.400M16.300 16.300l1.400 1.400M17.700 6.300l-1.400 1.400M7.700 16.300l-1.400 1.400"/>',
  condiviso: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.500 2.300 2.500 13.700 0 16M12 4c-2.500 2.300-2.500 13.700 0 16"/>',
};

export function icon(name: string, size = 22): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] ?? ""; // solo stringhe fisse scritte qui sopra
  return svg;
}

// ---- Date in italiano ------------------------------------------------------

const fmtDay = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
const fmtLong = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });

export function dayTime(at: string): string {
  const d = new Date(at);
  return `${fmtDay.format(d)}, ${fmtTime.format(d)}`;
}
export function longDate(at: string): string {
  return fmtLong.format(new Date(at));
}

/** Valore per <input type="datetime-local">: prossima ora piena. */
export function nextFullHour(now = new Date()): string {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function todayDate(now = new Date()): string {
  return toLocalInput(now).slice(0, 10);
}

// ---- Finestre di dialogo ---------------------------------------------------

export interface SheetHandle {
  close(): void;
  setError(msg: string): void;
}

/** Foglio modale. `onSubmit` può lanciare un errore: il messaggio compare nel foglio. */
export function openSheet(opts: {
  title: string;
  body: Node[];
  submitLabel: string;
  danger?: boolean;
  onSubmit: () => Promise<void>;
}): SheetHandle {
  const dlg = h("dialog", { class: "sheet" });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const submit = h("button", { type: "submit", class: opts.danger ? "btn btn-danger" : "btn btn-primary" }, opts.submitLabel);
  const cancel = h("button", { type: "button", class: "btn btn-quiet", onclick: () => close() }, "Annulla");
  const form = h(
    "form",
    {
      method: "dialog",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        submit.disabled = true;
        try {
          await opts.onSubmit();
          close();
        } catch (ex) {
          err.textContent = ex instanceof Error ? ex.message : "Qualcosa non ha funzionato.";
          err.hidden = false;
          submit.disabled = false;
        }
      },
    },
    h("h2", null, opts.title),
    ...opts.body,
    err,
    h("div", { class: "sheet-actions" }, cancel, submit),
  );
  dlg.append(form);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) close();
  });
  document.body.append(dlg);
  dlg.showModal();
  function close() {
    if (dlg.open) dlg.close();
  }
  return {
    close,
    setError(msg) {
      err.textContent = msg;
      err.hidden = false;
    },
  };
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
}

// ---- Piccoli aiuti ---------------------------------------------------------

/** Messaggio breve in basso, letto dai lettori di schermo. */
export function toast(msg: string, ms = 4000): void {
  let box = document.getElementById("toasts");
  if (!box) {
    box = h("div", { id: "toasts", class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(box);
  }
  const t = h("p", { class: "toast" }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Copia negli appunti. Dove non è permesso restituisce false, e chi chiama mostra il testo da copiare a mano. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Avvia un download. Nelle anteprime incorporate può essere bloccato: non c'è modo di saperlo, quindi chi chiama offre anche il testo. */
export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function euroInput(v: string): number {
  return Number(v.replace(",", ".").trim() || "0");
}
