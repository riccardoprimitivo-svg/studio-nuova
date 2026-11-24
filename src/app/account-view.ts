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

export function showAccount(root: HTMLElement, auth: Auth, onIn: () => void, mode: "in" | "new" = "in"): void {
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
    ),
  );
  root.replaceChildren(frame(form));
  email.focus();
}
