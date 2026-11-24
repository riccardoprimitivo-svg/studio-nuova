// Pezzi di interfaccia comuni a più schermate.

import { h } from "./dom.js";

export function pageHead(title: string, sub: string, ...actions: (Node | null)[]): HTMLElement {
  return h("header", { class: "page-head" }, h("div", null, h("h1", null, title), sub ? h("p", { class: "sub" }, sub) : null), ...actions.filter((a): a is Node => a !== null));
}

export function emptyBox(title: string, text: string, action?: Node): HTMLElement {
  return h("div", { class: "empty" }, h("p", { class: "empty-title" }, title), h("p", null, text), action ?? null);
}

export function statBox(label: string, value: string, sub = "", text = false): HTMLElement {
  return h("div", { class: "stat" }, h("span", { class: "label" }, label), h("span", { class: text ? "stat-value stat-text" : "stat-value" }, value), h("span", { class: "stat-sub" }, sub));
}
