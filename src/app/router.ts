// Navigazione interna, senza toccare l'indirizzo della pagina:
// nell'anteprima dentro Claude l'indirizzo non è controllabile.

import { h, type Child } from "./dom.js";

export type ViewKey = "riepilogo" | "agenda" | "persone" | "percorsi" | "strutture" | "amministrazione" | "impostazioni";
export type Route = { view: ViewKey } | { view: "persona"; id: string };
type Listener = (r: Route) => void;

let current: Route = { view: "riepilogo" };
const listeners = new Set<Listener>();

export const currentRoute = (): Route => current;

export function navigate(r: Route): void {
  current = r;
  window.scrollTo(0, 0);
  for (const l of listeners) l(r);
}

export function onRoute(fn: Listener): void {
  listeners.add(fn);
}

/** Da chiamare quando si blocca l'app: azzera percorso e ascoltatori. */
export function resetRoute(): void {
  current = { view: "riepilogo" };
  listeners.clear();
}

export function routeLink(r: Route, attrs: Record<string, unknown> | null, ...children: Child[]): HTMLAnchorElement {
  return h(
    "a",
    {
      ...(attrs ?? {}),
      href: "#",
      onclick: (e: Event) => {
        e.preventDefault();
        navigate(r);
      },
    },
    ...children,
  );
}
