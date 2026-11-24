// Pagina della persona: accesso con email e codice, poi il suo spazio.

import { cloudConfig } from "./cloud.js";
import { h } from "./dom.js";
import type { PortalPackage } from "./portal.js";
import { RemotePortalServer } from "./portal-remote.js";
import { LocalKV, LocalPortalServer, PortalError, type PortalServer } from "./portal-server.js";
import { renderPortal } from "./portal-view.js";
import { openPackage, parseInviteLink } from "../share.js";

const root = document.getElementById("app");
if (!root) throw new Error("manca #app");
const app: HTMLElement = root;

const cfg = cloudConfig();
const server: PortalServer = cfg ? new RemotePortalServer({ url: cfg.url, publicKey: cfg.publishableKey }) : new LocalPortalServer(new LocalKV());

function frame(...children: (Node | null)[]): HTMLElement {
  return h(
    "main",
    { class: "lock portal-login", id: "portal-main", tabindex: "-1" },
    h("div", { class: "logo logo-big", "aria-label": "Studio." }, "Studio", h("span", null, ".")),
    h("div", { class: "lock-card" }, ...children.filter((n): n is Node => n !== null)),
  );
}

let link: { shareId: string; raw: Uint8Array } | null = null;
try {
  link = parseInviteLink(location.href);
} catch {
  link = null;
}

function invalid() {
  app.replaceChildren(
    frame(
      h("h1", { class: "lock-title" }, "Link non valido"),
      h("p", { class: "lead" }, "Il link è incompleto o è stato interrotto. Chiedi a chi ti segue di mandartelo di nuovo."),
    ),
  );
}

function stepEmail(prefill = "") {
  const email = h("input", { type: "email", id: "email", autocomplete: "email", inputmode: "email", required: true, value: prefill, autocapitalize: "off" });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Mandami il codice");
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        go.disabled = true;
        go.textContent = "Un attimo…";
        try {
          const r = await server.requestCode(link!.shareId, email.value);
          stepCode(email.value, r.demoCode);
        } catch {
          err.textContent = "Non riesco a inviare il codice in questo momento. Riprova tra poco.";
          err.hidden = false;
          go.disabled = false;
          go.textContent = "Mandami il codice";
        }
      },
    },
    h("label", { class: "field" }, h("span", { class: "field-label" }, "La tua email"), email, h("span", { class: "field-hint" }, "Quella a cui chi ti segue ha mandato il link.")),
    err,
    go,
  );
  app.replaceChildren(
    frame(
      h("h1", { class: "lock-title" }, "Entra nel tuo spazio"),
      h("p", { class: "lead" }, "Ti mandiamo un codice di 8 cifre. Non serve nessuna password."),
      form,
    ),
  );
  email.focus();
}

function stepCode(emailValue: string, demoCode?: string) {
  const code = h("input", {
    type: "text",
    id: "code",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    pattern: "[0-9]{8}",
    maxlength: 8,
    required: true,
    autocapitalize: "off",
    spellcheck: "false",
  });
  const err = h("p", { class: "form-error", role: "alert" });
  err.hidden = true;
  const go = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Entra");
  const status = h("p", { class: "lead", role: "status" }, "Se l'indirizzo è quello giusto, il codice sta arrivando. Vale 10 minuti.");
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        go.disabled = true;
        go.textContent = "Controllo…";
        try {
          const { sealed, rev } = await server.verify(link!.shareId, emailValue, code.value.replace(/\s/g, ""));
          const pkg = await openPackage<PortalPackage>(link!.raw, link!.shareId, rev, sealed);
          app.replaceChildren(renderPortal(pkg, { onExit: () => stepEmail() }));
        } catch (ex) {
          err.textContent =
            ex instanceof PortalError && ex.code === "revoked"
              ? "Questo link non è più attivo. Chiedi a chi ti segue un link nuovo."
              : ex instanceof PortalError && ex.code === "too_many"
                ? "Troppi tentativi. Chiedi un codice nuovo."
                : ex instanceof PortalError
                  ? "Il codice non è corretto o è scaduto. Controlla le cifre o chiedine uno nuovo."
                  : "Non riesco ad aprire il tuo spazio con questo link. Chiedi a chi ti segue di mandartelo di nuovo.";
          err.hidden = false;
          go.disabled = false;
          go.textContent = "Entra";
          code.focus();
        }
      },
    },
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Codice di 8 cifre"), code),
    err,
    go,
  );
  app.replaceChildren(
    frame(
      h("h1", { class: "lock-title" }, "Controlla la posta"),
      status,
      demoCode
        ? h("p", { class: "demo-box", role: "note" }, h("strong", null, "Modalità prova. "), "In uso reale il codice arriva per email. Qui è: ", h("span", { class: "demo-code" }, demoCode))
        : null,
      form,
      h(
        "div",
        { class: "row row-wrap" },
        h("button", { type: "button", class: "btn btn-quiet", onclick: () => void resend() }, "Mandami un altro codice"),
        h("button", { type: "button", class: "btn btn-quiet", onclick: () => stepEmail(emailValue) }, "Cambia email"),
      ),
    ),
  );
  code.focus();

  async function resend() {
    try {
      const r = await server.requestCode(link!.shareId, emailValue);
      stepCode(emailValue, r.demoCode);
    } catch {
      status.textContent = "Non riesco a mandare un altro codice adesso. Riprova tra poco.";
    }
  }
}

if (!link) invalid();
else stepEmail();
