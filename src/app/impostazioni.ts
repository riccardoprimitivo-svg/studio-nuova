// Impostazioni: profilo, sicurezza, i tuoi dati, testi legali, cancellazione.

import { copyText, downloadText, field, h, openSheet, toast } from "./dom.js";
import { documents, placeholdersLeft } from "./legal.js";
import { openDocument } from "./legal-view.js";
import type { Sharing } from "./sharing.js";
import type { Studio } from "./store.js";
import { pageHead } from "./ui.js";
import { profileValue, saveProfile } from "./work.js";

export interface SettingsHooks {
  /** Dopo la cancellazione dell'archivio: si torna alla schermata iniziale. */
  onErased: () => void;
}

export function renderSettings(studio: Studio, sharing: Sharing, hooks: SettingsHooks, accepted: { at: string; terms: string } | null): HTMLElement {
  const prof = profileValue(studio);

  const profile = h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Il tuo profilo per le persone"), h("button", { class: "btn btn-quiet btn-sm", onclick: () => openProfileForm(studio) }, "Modifica")),
    h("p", { class: "muted small" }, "È quello che le persone vedono nel portale alla voce “Con chi”. Email e telefono si vedono solo se lo scegli."),
    h(
      "dl",
      { class: "kv" },
      h("dt", null, "Nome"),
      h("dd", null, prof.displayName || "—"),
      h("dt", null, "Email"),
      h("dd", null, prof.email ? `${prof.email}${prof.shareEmail ? " · condivisa" : " · non condivisa"}` : "—"),
      h("dt", null, "Telefono"),
      h("dd", null, prof.phone ? `${prof.phone}${prof.sharePhone ? " · condiviso" : " · non condiviso"}` : "—"),
    ),
  );

  const security = h(
    "div",
    { class: "card" },
    h("h2", null, "Sicurezza"),
    h("p", { class: "muted small" }, "I dati sono cifrati con una chiave che si apre con la passphrase. Il codice di recupero serve se la dimentichi."),
    h("div", { class: "row row-wrap" }, h("button", { class: "btn btn-quiet", onclick: () => openPassphraseForm(studio) }, "Cambia passphrase"), h("button", { class: "btn btn-quiet", onclick: () => openRecoveryForm(studio) }, "Nuovo codice di recupero")),
  );

  const data = h(
    "div",
    { class: "card" },
    h("h2", null, "I tuoi dati"),
    h("p", { class: "muted small" }, "Puoi portare via tutto quando vuoi. La copia leggibile contiene anche le note: conservala con cura."),
    h(
      "div",
      { class: "row row-wrap" },
      h("button", { class: "btn btn-quiet", onclick: () => showExport("studio-dati.json", JSON.stringify(studio.exportPlain(), null, 2), "Copia leggibile") }, "Scarica i dati (leggibili)"),
      h("button", { class: "btn btn-quiet", onclick: async () => showExport("studio-copia-cifrata.json", JSON.stringify(await studio.exportEncrypted(), null, 2), "Copia cifrata") }, "Scarica copia cifrata"),
    ),
  );

  const legal = h(
    "div",
    { class: "card" },
    h("h2", null, "Testi e privacy"),
    accepted ? h("p", { class: "muted small" }, `Hai accettato i testi del ${accepted.terms.split("-").reverse().join("/")} il ${new Date(accepted.at).toLocaleDateString("it-IT")}.`) : null,
    h("ul", { class: "plain-list" }, ...documents().map((d) => h("li", null, h("span", { class: "stack-text" }, h("strong", null, d.title), h("span", { class: "small muted" }, d.summary)), h("button", { class: "btn btn-quiet btn-sm", onclick: () => openDocument(d.key) }, "Leggi")))),
  );

  const left = placeholdersLeft();
  const todo = left.length
    ? h("div", { class: "card card-sand" }, h("h2", null, "Da completare prima di aprire ad altri"), h("p", { class: "small" }, `Nei testi legali restano da compilare: ${left.map((k) => ({ vatNumber: "partita IVA", contactEmail: "email di contatto" }[k as "vatNumber"] ?? k)).join(", ")}. Poi fai leggere i testi una volta a un legale.`))
    : null;

  const danger = h(
    "div",
    { class: "card" },
    h("h2", null, "Elimina tutto"),
    h("p", { class: "muted small" }, "Cancella l'archivio, anche online, e interrompe tutte le condivisioni. L'accesso con email e password resta, ma senza dati. Prima scarica una copia, se ti serve."),
    h("div", null, h("button", { class: "btn btn-danger-quiet", onclick: () => openEraseForm(studio, sharing, hooks) }, "Elimina il mio archivio")),
  );

  return h("section", { class: "page" }, pageHead("Impostazioni", ""), todo, h("div", { class: "cards" }, profile, security, data, legal), danger);
}

function openProfileForm(studio: Studio): void {
  const p = profileValue(studio);
  const name = h("input", { type: "text", value: p.displayName, autocomplete: "name" });
  const bio = h("textarea", { rows: 3, value: p.bio });
  const email = h("input", { type: "email", value: p.email });
  const phone = h("input", { type: "tel", value: p.phone });
  const shareEmail = h("input", { type: "checkbox", checked: p.shareEmail });
  const sharePhone = h("input", { type: "checkbox", checked: p.sharePhone });
  openSheet({
    title: "Il tuo profilo",
    submitLabel: "Salva",
    body: [
      field("Come ti chiami per le persone", name, "Compare nel portale."),
      field("Due righe su di te", bio),
      field("Email", email),
      h("label", { class: "check" }, shareEmail, h("span", null, "Mostrala nel portale")),
      field("Telefono", phone),
      h("label", { class: "check" }, sharePhone, h("span", null, "Mostralo nel portale")),
    ],
    onSubmit: async () => {
      await saveProfile(studio, { displayName: name.value, bio: bio.value, email: email.value, phone: phone.value, shareEmail: shareEmail.checked, sharePhone: sharePhone.checked });
    },
  });
}

function openPassphraseForm(studio: Studio): void {
  const old = h("input", { type: "password", autocomplete: "current-password", required: true });
  const n1 = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 10 });
  const n2 = h("input", { type: "password", autocomplete: "new-password", required: true });
  openSheet({
    title: "Cambia passphrase",
    submitLabel: "Cambia",
    body: [field("Passphrase attuale", old), field("Nuova passphrase", n1, "Almeno 10 caratteri."), field("Ripeti la nuova", n2)],
    onSubmit: async () => {
      if (n1.value !== n2.value) throw new Error("Le due passphrase nuove non coincidono.");
      try {
        await studio.changePassphrase(old.value, n1.value);
      } catch (e) {
        throw new Error(e instanceof Error && /corta/.test(e.message) ? "La nuova passphrase è troppo corta (minimo 10 caratteri)." : "La passphrase attuale non è corretta.");
      }
      toast("Passphrase cambiata");
    },
  });
}

function openRecoveryForm(studio: Studio): void {
  const pass = h("input", { type: "password", autocomplete: "current-password", required: true });
  openSheet({
    title: "Nuovo codice di recupero",
    submitLabel: "Genera",
    body: [h("p", null, "Il codice che hai ora smetterà di funzionare."), field("Passphrase", pass)],
    onSubmit: async () => {
      let code: string;
      try {
        code = await studio.newRecoveryCode(pass.value);
      } catch {
        throw new Error("La passphrase non è corretta.");
      }
      queueMicrotask(() => showNewCode(code));
    },
  });
}

function showNewCode(code: string): void {
  openSheet({
    title: "Il tuo nuovo codice",
    submitLabel: "L'ho salvato",
    body: [
      h("p", null, "Compare solo adesso. Scrivilo su carta o salvalo in un gestore di password."),
      h("div", { class: "recovery", "aria-label": code }, ...code.split("-").map((g) => h("span", null, g))),
      h("button", { type: "button", class: "btn btn-quiet", onclick: async () => toast((await copyText(code)) ? "Copiato" : "Non riesco a copiare: selezionalo a mano") }, "Copia"),
    ],
    onSubmit: async () => {},
  });
}

function showExport(filename: string, text: string, title: string): void {
  const area = h("textarea", { rows: 8, readonly: true, "aria-label": "Contenuto del file" });
  area.value = text;
  openSheet({
    title,
    submitLabel: "Scarica il file",
    body: [h("p", null, `Il file si chiama ${filename}. Se il download non parte, copia il testo qui sotto in un file.`), area, h("button", { type: "button", class: "btn btn-quiet", onclick: async () => toast((await copyText(text)) ? "Copiato" : "Non riesco a copiare: selezionalo a mano") }, "Copia il testo")],
    onSubmit: async () => {
      downloadText(filename, text);
    },
  });
}

function openEraseForm(studio: Studio, sharing: Sharing, hooks: SettingsHooks): void {
  const word = h("input", { type: "text", autocomplete: "off", autocapitalize: "characters", "aria-label": "Scrivi ELIMINA per confermare" });
  openSheet({
    title: "Eliminare tutto?",
    danger: true,
    submitLabel: "Elimina per sempre",
    body: [h("p", null, "Spariscono persone, incontri, percorsi, pagamenti e impostazioni, e i link dei portali smettono di funzionare. Non si può annullare."), field("Scrivi ELIMINA per confermare", word)],
    onSubmit: async () => {
      if (word.value.trim().toUpperCase() !== "ELIMINA") throw new Error("Scrivi la parola ELIMINA per confermare.");
      sharing.halt();
      await sharing.revokeAll();
      await studio.eraseEverything();
      hooks.onErased();
    },
  });
}
