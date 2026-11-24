// Punto d'ingresso: schermata di apertura, poi guscio dell'app (barra, menu, percorsi).

import { showAccount } from "./account-view.js";
import { renderAdmin } from "./amministrazione.js";
import { Auth, cloudConfig, SupabaseBackend } from "./cloud.js";
import { renderAgenda } from "./agenda.js";
import { h, icon, toast } from "./dom.js";
import { renderSettings } from "./impostazioni.js";
import { needsAcceptance } from "./legal.js";
import { showAcceptance, showLock } from "./lock.js";
import { renderPaths } from "./percorsi.js";
import { renderPeopleList, renderPersonPage } from "./persone.js";
import { RemotePortalServer } from "./portal-remote.js";
import { LocalKV, LocalPortalServer, type PortalServer } from "./portal-server.js";
import { renderSummary } from "./riepilogo.js";
import { currentRoute, navigate, onRoute, resetRoute, routeLink, type ViewKey } from "./router.js";
import { Sharing } from "./sharing.js";
import { LocalBackend, type Backend, type Studio } from "./store.js";
import { renderStructures } from "./strutture.js";

const root = document.getElementById("app");
if (!root) throw new Error("manca #app");
const app: HTMLElement = root;

const NAV: { key: ViewKey; label: string }[] = [
  { key: "riepilogo", label: "Riepilogo" },
  { key: "agenda", label: "Agenda" },
  { key: "persone", label: "Persone" },
  { key: "percorsi", label: "Percorsi" },
  { key: "strutture", label: "Strutture" },
  { key: "amministrazione", label: "Amministrazione" },
  { key: "impostazioni", label: "Impostazioni" },
];

// Con config.js l'app usa l'account e salva online (sempre cifrato); senza, lavora solo su questo dispositivo.
const cfg = cloudConfig();
const auth = cfg ? new Auth(cfg) : null;
let backend: Backend = new LocalBackend();
let portalServer: PortalServer = new LocalPortalServer(new LocalKV());
let sharing: Sharing | null = null;

function accountFooter(): Node {
  return h(
    "p",
    { class: "small lock-account" },
    `Account: ${auth?.email ?? ""} · `,
    h(
      "button",
      {
        type: "button",
        class: "link",
        onclick: async () => {
          await auth?.signOut();
          start();
        },
      },
      "Esci",
    ),
  );
}

function start() {
  sharing?.halt();
  sharing = null;
  resetRoute();
  if (auth && cfg) {
    if (!auth.signedIn) {
      showAccount(app, auth, () => start());
      return;
    }
    backend = new SupabaseBackend(auth);
    portalServer = new RemotePortalServer({ url: cfg.url, publicKey: cfg.publishableKey, accessToken: () => auth.accessToken() });
  }
  showLock(
    app,
    backend,
    async (studio) => {
      if (needsAcceptance(await studio.acceptance())) showAcceptance(app, studio, () => openShell(studio));
      else openShell(studio);
    },
    auth ? accountFooter : undefined,
  );
}

async function openShell(studio: Studio) {
  const accepted = await studio.acceptance();
  const share = new Sharing(studio, portalServer, new URL(".", location.href).href);
  share.onError = () => toast("Non sono riuscito ad aggiornare il portale. Riproverò alla prossima modifica.");
  share.start();
  void share.sync().catch(() => {});
  sharing = share;

  const view = h("div", { class: "view", id: "view" });
  let query = "";

  const navLink = (n: (typeof NAV)[number], mobile: boolean) =>
    routeLink({ view: n.key }, { class: "nav-item", "data-nav": n.key }, icon(n.key, mobile ? 24 : 20), h("span", null, n.label));

  const lock = h("button", { class: "btn btn-quiet btn-sm", "aria-label": "Blocca", onclick: () => start() }, icon("lucchetto", 16), h("span", null, "Blocca"));

  // Su telefono la barra in basso mostra le voci principali; il resto sta sotto "Altro".
  const mobileKeys: ViewKey[] = ["riepilogo", "agenda", "persone"];
  const moreSheet = h(
    "div",
    { class: "more", hidden: true },
    ...NAV.filter((n) => !mobileKeys.includes(n.key)).map((n) => navLink(n, true)),
    h("button", { class: "nav-item", onclick: () => start() }, icon("lucchetto", 24), h("span", null, "Blocca")),
  );
  const more = h(
    "button",
    {
      class: "nav-item",
      "aria-expanded": "false",
      onclick: () => {
        moreSheet.hidden = !moreSheet.hidden;
        more.setAttribute("aria-expanded", String(!moreSheet.hidden));
      },
    },
    icon("altro", 24),
    h("span", null, "Altro"),
  );

  app.replaceChildren(
    h(
      "div",
      { class: "shell" },
      h("header", { class: "topbar" }, routeLink({ view: "riepilogo" }, { class: "logo" }, "Studio", h("span", null, ".")), lock),
      h(
        "nav",
        { class: "sidebar", "aria-label": "Sezioni" },
        routeLink({ view: "riepilogo" }, { class: "logo logo-side" }, "Studio", h("span", null, ".")),
        h("div", { class: "nav" }, ...NAV.map((n) => navLink(n, false))),
      ),
      view,
      moreSheet,
      h("nav", { class: "tabbar", "aria-label": "Sezioni" }, ...NAV.filter((n) => mobileKeys.includes(n.key)).map((n) => navLink(n, true)), more),
    ),
  );

  const render = () => {
    const r = currentRoute();
    const section: ViewKey = r.view === "persona" ? "persone" : r.view;
    document.querySelectorAll("[data-nav]").forEach((el) => {
      const on = el.getAttribute("data-nav") === section;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    moreSheet.hidden = true;
    more.setAttribute("aria-expanded", "false");
    const scroll = window.scrollY;
    switch (r.view) {
      case "persona":
        view.replaceChildren(renderPersonPage(studio, r.id, () => navigate({ view: "persone" }), share));
        break;
      case "persone":
        view.replaceChildren(
          renderPeopleList(studio, query, (q) => {
            query = q;
            render();
            // Mantiene il cursore nel campo di ricerca mentre si scrive.
            const input = view.querySelector<HTMLInputElement>(".search-input");
            input?.focus();
            input?.setSelectionRange(q.length, q.length);
          }),
        );
        break;
      case "agenda":
        view.replaceChildren(renderAgenda(studio, render));
        break;
      case "percorsi":
        view.replaceChildren(renderPaths(studio));
        break;
      case "strutture":
        view.replaceChildren(renderStructures(studio));
        break;
      case "amministrazione":
        view.replaceChildren(renderAdmin(studio));
        break;
      case "impostazioni":
        view.replaceChildren(
          renderSettings(studio, share, { onErased: () => start() }, accepted ? { at: accepted.at, terms: accepted.termsVersion } : null),
        );
        break;
      default:
        view.replaceChildren(renderSummary(studio));
    }
    window.scrollTo(0, scroll);
  };
  studio.subscribe(render);
  onRoute(render);
  render();
}

start();
