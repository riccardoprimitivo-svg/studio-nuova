// Schermata della persona (portale). Pensata per essere letta da chiunque:
// testi chiari, bersagli grandi, nessuna azione nascosta, funziona con tastiera e lettore di schermo,
// e con l'ingrandimento del testo o della pagina.

import { dayTime, h, icon, longDate } from "./dom.js";
import { personNotice } from "./legal.js";
import { openReader } from "./legal-view.js";
import type { PortalPackage } from "./portal.js";

export interface PortalViewOptions {
  /** Anteprima per chi insegna: niente "Esci", con avviso in cima. */
  preview?: boolean;
  onExit?: () => void;
}

type Section = "percorso" | "conchi" | "avvisi" | "materiali" | "obiettivo";

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function renderPortal(pkg: PortalPackage, opts: PortalViewOptions = {}): HTMLElement {
  const root = h("div", { class: "portal" });
  const teacher = pkg.teacher.name.trim();

  function home() {
    const tile = (o: {
      label: string;
      big: string;
      sub?: string;
      section?: Section;
      href?: string;
      empty?: boolean;
      aria: string;
    }) => {
      const inner = [h("span", { class: "tile-label" }, o.label), h("span", { class: "tile-big" }, o.big), o.sub ? h("span", { class: "tile-sub" }, o.sub) : null];
      if (o.empty) return h("li", null, h("div", { class: "tile is-empty", "aria-label": o.aria }, ...inner));
      if (o.href) {
        return h(
          "li",
          null,
          h("a", { class: "tile", href: o.href, target: "_blank", rel: "noopener noreferrer", "aria-label": `${o.aria}. Si apre in una nuova scheda.` }, ...inner, h("span", { class: "tile-go", "aria-hidden": "true" }, icon("avanti", 18))),
        );
      }
      return h(
        "li",
        null,
        h("button", { type: "button", class: "tile", "aria-label": o.aria, onclick: () => detail(o.section!) }, ...inner, h("span", { class: "tile-go", "aria-hidden": "true" }, icon("avanti", 18))),
      );
    };

    const p = pkg.path;
    const percorso = p
      ? tile({
          label: "Percorso",
          big: `${p.done} di ${p.total}`,
          sub: pkg.nextMeeting ? `Prossimo: ${dayTime(pkg.nextMeeting)}` : p.done >= p.total ? "Percorso completato" : "incontri fatti",
          section: "percorso",
          aria: `Percorso: ${p.done} incontri fatti su ${p.total}`,
        })
      : tile({ label: "Percorso", big: "Nessuno per ora", empty: true, aria: "Percorso: nessun percorso attivo" });

    const conchi = tile({
      label: "Con chi",
      big: teacher || "Chi ti segue",
      sub: teacher ? "Chi ti segue" : "",
      section: "conchi",
      aria: `Con chi: ${teacher || "chi ti segue"}`,
    });

    const avvisi = pkg.notices.length
      ? tile({ label: "Avvisi", big: plural(pkg.notices.length, "avviso", "avvisi"), sub: pkg.notices[0]!.text, section: "avvisi", aria: `Avvisi: ${plural(pkg.notices.length, "avviso", "avvisi")}` })
      : tile({ label: "Avvisi", big: "Nessuno", empty: true, aria: "Avvisi: nessuno" });

    const materiali = pkg.materials.length
      ? tile({ label: "Materiali", big: plural(pkg.materials.length, "materiale", "materiali"), sub: pkg.materials[0]!.title, section: "materiali", aria: `Materiali: ${plural(pkg.materials.length, "materiale", "materiali")}` })
      : tile({ label: "Materiali", big: "Nessuno", empty: true, aria: "Materiali: nessuno" });

    const drive = pkg.driveUrl
      ? tile({ label: "Cartella", big: "Apri la cartella", sub: "Documenti condivisi", href: pkg.driveUrl, aria: "Cartella condivisa" })
      : tile({ label: "Cartella", big: "Nessuna", empty: true, aria: "Cartella condivisa: nessuna" });

    const obiettivo = pkg.goal.trim()
      ? tile({ label: "Obiettivo", big: pkg.goal.trim(), section: "obiettivo", aria: `Obiettivo: ${pkg.goal.trim()}` })
      : tile({ label: "Obiettivo", big: "Non indicato", empty: true, aria: "Obiettivo: non indicato" });

    const history = pkg.history.length
      ? h("ul", { class: "p-history", role: "list" }, ...pkg.history.map(historyItem))
      : h("p", { class: "muted" }, "Qui compariranno gli incontri già fatti.");

    root.replaceChildren(
      header(),
      h(
        "main",
        { id: "portal-main", class: "portal-main", tabindex: "-1" },
        h("h1", { id: "portal-title", tabindex: "-1" }, `Ciao, ${firstName(pkg.name) || "bentornata/o"}`),
        h("p", { class: "lead portal-lead" }, teacher ? `Qui trovi il tuo percorso con ${teacher}.` : "Qui trovi il tuo percorso."),
        h("ul", { class: "tiles", role: "list" }, percorso, conchi, avvisi, materiali, drive, obiettivo),
        h("section", { class: "portal-section", "aria-labelledby": "storia" }, h("h2", { id: "storia" }, "Gli incontri fatti"), history),
      ),
      footer(),
    );
    focusTitle();
  }

  function header() {
    return h(
      "header",
      { class: "portal-head" },
      h("span", { class: "logo", "aria-label": "Studio." }, "Studio", h("span", null, ".")),
      opts.preview ? null : h("button", { type: "button", class: "btn btn-quiet", onclick: () => opts.onExit?.() }, "Esci"),
    );
  }

  function footer() {
    return h(
      "footer",
      { class: "portal-foot" },
      h(
        "button",
        {
          type: "button",
          class: "linklike",
          onclick: () => openReader("Come vengono usati i tuoi dati", personNotice(teacher, pkg.teacher.email), "Questo è il testo che chi ti segue ti deve dare sulla privacy."),
        },
        "Come vengono usati i tuoi dati",
      ),
    );
  }

  function historyItem(m: PortalPackage["history"][number]) {
    return h(
      "li",
      { class: "p-meeting" },
      h("div", { class: "p-meeting-top" }, h("strong", null, longDate(m.at)), m.attendance ? h("span", { class: "chip" }, m.attendance) : null),
      m.report ? h("p", { class: "preline" }, m.report) : h("p", { class: "muted" }, "Nessuna nota per questo incontro."),
    );
  }

  function detail(section: Section) {
    const title: Record<Section, string> = { percorso: "Il tuo percorso", conchi: "Con chi", avvisi: "Avvisi", materiali: "Materiali", obiettivo: "Il tuo obiettivo" };
    let body: (Node | null)[] = [];
    if (section === "percorso" && pkg.path) {
      const p = pkg.path;
      const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
      body = [
        h("p", { class: "p-big" }, p.title),
        h("div", { class: "p-progress", role: "img", "aria-label": `${p.done} incontri fatti su ${p.total}` }, h("div", { style: `width:${pct}%` })),
        h("p", null, `${plural(p.done, "incontro fatto", "incontri fatti")} su ${p.total}.`),
        p.planned ? h("p", null, `${plural(p.planned, "incontro in programma", "incontri in programma")}.`) : null,
        p.left ? h("p", null, `Restano ${plural(p.left, "incontro da fissare", "incontri da fissare")}.`) : null,
        p.toRecover ? h("p", null, `${plural(p.toRecover, "incontro da recuperare", "incontri da recuperare")}.`) : null,
        pkg.nextMeeting ? h("p", { class: "p-next" }, h("strong", null, "Prossimo incontro: "), dayTime(pkg.nextMeeting)) : h("p", { class: "muted" }, "Nessun incontro in programma."),
      ];
    } else if (section === "conchi") {
      body = [
        h("p", { class: "p-big" }, teacher || "Chi ti segue"),
        pkg.teacher.bio ? h("p", { class: "preline" }, pkg.teacher.bio) : null,
        pkg.teacher.email || pkg.teacher.phone
          ? h(
              "ul",
              { class: "p-contacts", role: "list" },
              pkg.teacher.email ? h("li", null, "Email: ", h("a", { href: `mailto:${pkg.teacher.email}` }, pkg.teacher.email)) : null,
              pkg.teacher.phone ? h("li", null, "Telefono: ", h("a", { href: `tel:${pkg.teacher.phone.replace(/[^\d+]/g, "")}` }, pkg.teacher.phone)) : null,
            )
          : h("p", { class: "muted" }, "Per contattare chi ti segue usa i canali che avete già concordato."),
      ];
    } else if (section === "avvisi") {
      body = [h("ul", { class: "p-list", role: "list" }, ...pkg.notices.map((n) => h("li", null, h("span", { class: "small muted" }, longDate(n.at)), h("p", { class: "preline" }, n.text))))];
    } else if (section === "materiali") {
      body = [
        h(
          "ul",
          { class: "p-list", role: "list" },
          ...pkg.materials.map((m) =>
            h("li", null, h("a", { class: "p-link", href: m.url, target: "_blank", rel: "noopener noreferrer" }, m.title, h("span", { class: "visually-hidden" }, " (si apre in una nuova scheda)"))),
          ),
        ),
      ];
    } else if (section === "obiettivo") {
      body = [h("p", { class: "p-big preline" }, pkg.goal.trim())];
    }
    root.replaceChildren(
      header(),
      h(
        "main",
        { id: "portal-main", class: "portal-main", tabindex: "-1" },
        h("button", { type: "button", class: "back portal-back", onclick: () => home() }, icon("indietro", 18), h("span", null, "Indietro")),
        h("h1", { id: "portal-title", tabindex: "-1" }, title[section]),
        ...body.filter((n): n is Node => n !== null),
      ),
      footer(),
    );
    focusTitle();
  }

  function focusTitle() {
    // Dopo ogni cambio di schermata il lettore di schermo riparte dal titolo.
    queueMicrotask(() => {
      const t = root.querySelector<HTMLElement>("#portal-title");
      if (t && root.isConnected && !opts.preview) t.focus({ preventScroll: false });
    });
  }

  home();
  return opts.preview ? h("div", { class: "portal-frame" }, h("p", { class: "portal-preview", role: "note" }, `Anteprima: così la vede ${firstName(pkg.name)}. Non può modificare nulla.`), root) : root;
}
