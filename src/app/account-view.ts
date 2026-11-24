// Accesso all'account (email e password). È una cosa diversa dalla passphrase:
// la password apre l'account, la passphrase apre i dati cifrati.

import { CloudError, type Auth } from "./cloud.js";
import { h } from "./dom.js";

function frame(...children: Node[]): HTMLElement {
  return h(
    "main",
    { class: "lock" },
    h("div", { class: "logo logo-big" }, "Studio", h("span", null, ".")),
    h("div", { class: "lock-card" }, ...children),
  );
}

export function showAccount(root: HTMLElement, auth: Auth, onIn: () => void, mode: "in" | "new" = "in", notice?: string): void {
  const creating = mode === "new";
  const email = h("input", { type: "email", id: "email", autocomplete: "email", required: true, inputmode: "email" });
  const pass = h("input", { type: "password", id: "account-pass", autocomplete: creating ? "new-password" : "current-password", required: true, minlength: creating ? 10 : 1 });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const note = h("p", { class: "lead", role: "status" });
  note.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, creating ? "Crea l'account" : "Accedi");

  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        note.hidden = true;
        go.disabled = true;
        const label = go.textContent;
        go.textContent = "Un momento…";
        try {
          if (creating) {
            const r = await auth.signUp(email.value, pass.value);
            if (r === "confirm") {
              note.textContent = "Ti ho mandato un'email: aprila e conferma l'indirizzo, poi torna qui e accedi.";
              note.hidden = false;
              go.disabled = false;
              go.textContent = label;
              return;
            }
          } else await auth.signIn(email.value, pass.value);
          onIn();
        } catch (ex) {
          err.textContent = ex instanceof CloudError ? ex.message : "Qualcosa non ha funzionato. Riprova.";
          err.hidden = false;
          go.disabled = false;
          go.textContent = label;
        }
      },
    },
    h("h1", { class: "lock-title" }, creating ? "Crea il tuo account" : "Accedi"),
    h(
      "p",
      { class: "lead" },
      creating
        ? "L'email e la password aprono il tuo account. Subito dopo sceglierai una passphrase diversa, che cifra i dati: la password da sola non basta a leggerli."
        : "Con l'email e la password dell'account. La passphrase dei dati la chiedo dopo.",
    ),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Email"), email),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Password"), pass, creating ? h("span", { class: "field-hint" }, "Almeno 10 caratteri.") : null),
    err,
    note,
    go,
    h(
      "p",
      { class: "small" },
      h(
        "a",
        {
          href: "#",
          onclick: (e: Event) => {
            e.preventDefault();
            showAccount(root, auth, onIn, creating ? "in" : "new");
          },
        },
        creating ? "Ho già un account" : "Non ho ancora un account",
      ),
      creating ? null : " · ",
      creating
        ? null
        : h(
            "a",
            {
              href: "#",
              onclick: (e: Event) => {
                e.preventDefault();
                showReset(root, auth, onIn);
              },
            },
            "Password dimenticata",
          ),
    ),
  );
  if (notice) {
    err.textContent = notice;
    err.hidden = false;
  }
  root.replaceChildren(frame(form));
  email.focus();
}

export function showReset(root: HTMLElement, auth: Auth, onIn: () => void): void {
  const email = h("input", { type: "email", id: "email", autocomplete: "email", required: true, inputmode: "email" });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const note = h("p", { class: "lead", role: "status" });
  note.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Mandami il link");
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        go.disabled = true;
        try {
          await auth.requestReset(email.value);
          note.textContent = "Se l'indirizzo è registrato, ti ho mandato un'email con il link per scegliere una nuova password. Controlla anche lo spam.";
          note.hidden = false;
        } catch (ex) {
          err.textContent = ex instanceof CloudError ? ex.message : "Qualcosa non ha funzionato. Riprova.";
          err.hidden = false;
        }
        go.disabled = false;
      },
    },
    h("h1", { class: "lock-title" }, "Nuova password"),
    h("p", { class: "lead" }, "Scrivi l'email dell'account. La passphrase dei dati non cambia e non si recupera da qui: se l'hai persa serve il codice di recupero."),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Email"), email),
    err,
    note,
    go,
    h("p", { class: "small" }, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); showAccount(root, auth, onIn); } }, "Torna all'accesso")),
  );
  root.replaceChildren(frame(form));
  email.focus();
}

/** Dopo aver aperto il link dell'email: scelta della nuova password. */
export function showNewPassword(root: HTMLElement, auth: Auth, onDone: () => void): void {
  const pass = h("input", { type: "password", id: "account-pass", autocomplete: "new-password", required: true, minlength: 10 });
  const pass2 = h("input", { type: "password", id: "account-pass2", autocomplete: "new-password", required: true });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Salva la nuova password");
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        if (pass.value !== pass2.value) {
          err.textContent = "Le due password non coincidono.";
          err.hidden = false;
          return;
        }
        go.disabled = true;
        try {
          await auth.changePassword(pass.value);
          onDone();
        } catch (ex) {
          err.textContent = ex instanceof CloudError ? ex.message : "Qualcosa non ha funzionato. Riprova.";
          err.hidden = false;
          go.disabled = false;
        }
      },
    },
    h("h1", { class: "lock-title" }, "Scegli la nuova password"),
    h("p", { class: "lead" }, "Vale per l'accesso all'account. I tuoi dati restano cifrati con la passphrase di sempre."),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Nuova password"), pass, h("span", { class: "field-hint" }, "Almeno 10 caratteri.")),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Ripeti la password"), pass2),
    err,
    go,
  );
  root.replaceChildren(frame(form));
  pass.focus();
}
