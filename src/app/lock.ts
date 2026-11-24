// Schermata di apertura: crea l'archivio la prima volta, poi chiede la passphrase.

import { h } from "./dom.js";
import { changedDocuments, currentAcceptance, documents } from "./legal.js";
import { acceptanceBox } from "./legal-view.js";
import { Studio, type Backend } from "./store.js";

const volatile = (b: Backend) => (b as { persistent?: boolean }).persistent === false;

/** Sotto la scheda di apertura, in modalità con account: chi è collegato e come uscire. */
let footer: (() => Node) | null = null;

export function showLock(root: HTMLElement, backend: Backend, onOpen: (s: Studio) => void, below?: () => Node): void {
  footer = below ?? null;
  Studio.exists(backend)
    .then((exists) => (exists ? renderUnlock(root, backend, onOpen) : renderCreate(root, backend, onOpen)))
    .catch(() => {
      root.replaceChildren(frame(h("p", { class: "form-error", role: "alert" }, "Non riesco a leggere i dati. Controlla la connessione e ricarica la pagina.")));
    });
}

function frame(...children: Node[]): HTMLElement {
  return h(
    "main",
    { class: "lock" },
    h("div", { class: "logo logo-big" }, "Studio", h("span", null, ".")),
    h("div", { class: "lock-card" }, ...children),
    footer ? footer() : null,
  );
}

function renderCreate(root: HTMLElement, backend: Backend, onOpen: (s: Studio) => void) {
  const pass = h("input", { type: "password", autocomplete: "new-password", id: "pass", minlength: 10, required: true });
  const pass2 = h("input", { type: "password", autocomplete: "new-password", id: "pass2", required: true });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide", disabled: true }, "Crea il mio archivio");
  const accept = acceptanceBox((ok) => (go.disabled = !ok));
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        if (pass.value !== pass2.value) return fail("Le due passphrase non coincidono.");
        go.disabled = true;
        go.textContent = "Creo l'archivio…";
        try {
          const { studio, recoveryCode } = await Studio.create(backend, pass.value, undefined, currentAcceptance(new Date()));
          renderRecovery(root, recoveryCode, () => onOpen(studio));
        } catch (ex) {
          fail(ex instanceof Error ? ex.message : "Non sono riuscito a creare l'archivio.");
        }
      },
    },
    volatile(backend)
      ? h("p", { class: "form-error" }, "Questa è un'anteprima: i dati restano solo finché la pagina è aperta, poi spariscono.")
      : null,
    h("p", { class: "lead" }, "Le persone, gli incontri e le note restano cifrati: li apri solo tu, con la tua passphrase."),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Passphrase"), pass, h("span", { class: "field-hint" }, "Almeno 10 caratteri. Meglio una frase che una parola.")),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Ripeti la passphrase"), pass2),
    accept.node,
    err,
    go,
    h(
      "p",
      { class: "small" },
      "Ti darò anche un codice di recupero. Se perdi sia la passphrase sia il codice, nessuno — nemmeno io — può riaprire i dati.",
    ),
  );
  function fail(msg: string) {
    err.textContent = msg;
    err.hidden = false;
    go.disabled = !accept.ok();
    go.textContent = "Crea il mio archivio";
  }
  root.replaceChildren(frame(form));
}

/** Testi cambiati dall'ultima volta: si rileggono e si riaccettano prima di entrare. */
export function showAcceptance(root: HTMLElement, studio: Studio, onDone: () => void): void {
  studio.acceptance().then((prev) => {
    const changed = changedDocuments(prev);
    const go = h("button", { type: "button", class: "btn btn-primary btn-wide", disabled: true }, "Accetto e continuo");
    const err = h("p", { class: "form-error", role: "alert" });
    err.hidden = true;
    const box = acceptanceBox((ok) => (go.disabled = !ok));
    go.addEventListener("click", async () => {
      go.disabled = true;
      try {
        await studio.accept(currentAcceptance(new Date()));
        onDone();
      } catch {
        err.textContent = "Non sono riuscito a registrare l'accettazione. Riprova.";
        err.hidden = false;
        go.disabled = false;
      }
    });
    root.replaceChildren(
      frame(
        h("h1", { class: "lock-title" }, prev ? "Testi aggiornati" : "Prima di entrare"),
        h(
          "p",
          { class: "lead" },
          prev
            ? `Sono cambiati: ${documents().filter((d) => changed.includes(d.key)).map((d) => d.title.toLowerCase()).join(", ")}. Rileggi e conferma per continuare. I tuoi dati non vengono toccati.`
            : "Per usare Studio. servono queste tre letture e conferme.",
        ),
        box.node,
        err,
        go,
      ),
    );
  });
}

function renderRecovery(root: HTMLElement, code: string, done: () => void) {
  const saved = h("input", { type: "checkbox", id: "saved" });
  const go = h("button", { type: "button", class: "btn btn-primary btn-wide", disabled: true, onclick: done }, "Entra nello Studio");
  saved.addEventListener("change", () => (go.disabled = !saved.checked));
  const copy = h(
    "button",
    {
      type: "button",
      class: "btn btn-quiet",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(code);
          copy.textContent = "Copiato";
        } catch {
          copy.textContent = "Non riesco a copiare: selezionalo a mano";
        }
      },
    },
    "Copia",
  );
  root.replaceChildren(
    frame(
      h("h1", { class: "lock-title" }, "Il tuo codice di recupero"),
      h("p", { class: "lead" }, "Serve se dimentichi la passphrase. Compare solo adesso: scrivilo su carta o salvalo in un gestore di password."),
      h("div", { class: "recovery", "data-testid": "recovery-code", "aria-label": code }, ...code.split("-").map((g) => h("span", null, g))),
      h("div", { class: "row" }, copy),
      h("label", { class: "check" }, saved, h("span", null, "L'ho salvato in un posto sicuro")),
      go,
    ),
  );
}

function renderUnlock(root: HTMLElement, backend: Backend, onOpen: (s: Studio) => void) {
  const pass = h("input", { type: "password", id: "pass", autocomplete: "current-password", required: true });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Apri");
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        go.disabled = true;
        go.textContent = "Apro…";
        try {
          onOpen(await Studio.unlock(backend, { passphrase: pass.value }));
        } catch {
          err.textContent = "Passphrase non corretta.";
          err.hidden = false;
          go.disabled = false;
          go.textContent = "Apri";
        }
      },
    },
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Passphrase"), pass),
    err,
    go,
    h("p", { class: "small" }, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); renderRecover(root, backend, onOpen); } }, "Ho perso la passphrase")),
  );
  root.replaceChildren(frame(form));
  pass.focus();
}

function renderRecover(root: HTMLElement, backend: Backend, onOpen: (s: Studio) => void) {
  const code = h("textarea", { id: "code", rows: 3, required: true, autocapitalize: "characters", spellcheck: false });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Apri con il codice");
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        go.disabled = true;
        try {
          onOpen(await Studio.unlock(backend, { recoveryCode: code.value }));
        } catch {
          err.textContent = "Codice non riconosciuto. Controlla di averlo copiato per intero.";
          err.hidden = false;
          go.disabled = false;
        }
      },
    },
    h("p", { class: "lead" }, "Inserisci il codice di recupero che ti è stato dato alla creazione."),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Codice di recupero"), code),
    err,
    go,
    h("p", { class: "small" }, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); renderUnlock(root, backend, onOpen); } }, "Torna alla passphrase")),
  );
  root.replaceChildren(frame(form));
}
