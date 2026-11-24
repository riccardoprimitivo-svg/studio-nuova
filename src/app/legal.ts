// Testi legali dell'app, in italiano semplice, con versione.
//
// Sono una bozza scritta per essere letta una volta da un legale prima di aprire ad altri
// professionisti. Quando un testo cambia si alza la versione: chi ha accettato la precedente
// viene invitato a rileggere e riaccettare prima di continuare.

export interface LegalConfig {
  /** Chi mette a disposizione il servizio. */
  operatorName: string;
  operatorPlace: string;
  /** Da compilare prima di aprire ad altri: restano visibili come segnaposto. */
  vatNumber: string;
  contactEmail: string;
  /** Dove stanno i dati, per chi vuole saperlo. */
  region: string;
}

export const LEGAL_CONFIG: LegalConfig = {
  operatorName: "Opificio Vocale di Primitivo Riccardo",
  operatorPlace: "Via delle Rimesse 59, 04010 Cori (LT)",
  vatNumber: "P. IVA 03174380596",
  contactEmail: "studio@opificiovocale.it",
  region: "Unione europea",
};

export type DocKey = "terms" | "privacy" | "dpa";

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDoc {
  key: DocKey;
  title: string;
  /** Una riga, per chi non vuole leggere tutto. */
  summary: string;
  version: string;
  sections: LegalSection[];
}

export const VERSIONS: Record<DocKey, string> = {
  terms: "2026-11-26",
  privacy: "2026-11-26",
  dpa: "2026-11-26",
};

/** Dichiarazioni che chi si iscrive fa esplicitamente, oltre a leggere i testi. */
export const DECLARATIONS = {
  adultsOnly: "Seguo solo persone maggiorenni.",
  noHealthData: "Non scriverò in Studio. dati sanitari o altre informazioni molto riservate.",
} as const;

export function documents(cfg: LegalConfig = LEGAL_CONFIG): LegalDoc[] {
  const who = `${cfg.operatorName}, ${cfg.operatorPlace}`;
  return [
    {
      key: "terms",
      title: "Condizioni d'uso",
      summary: "Cosa è Studio., cosa puoi metterci, di chi sono i dati e cosa succede se perdi la passphrase.",
      version: VERSIONS.terms,
      sections: [
        {
          title: "Cos'è Studio.",
          paragraphs: [
            `Studio. è un gestionale per chi insegna o accompagna persone: schede, incontri, percorsi, compensi. Lo mette a disposizione ${who}.`,
            "Lo usi per il tuo lavoro. Non è pensato per un uso personale o per altre attività.",
          ],
        },
        {
          title: "Chi può usarlo e per chi",
          paragraphs: [
            "Studio. è per professionisti maggiorenni. Le persone che inserisci devono essere maggiorenni: non usare Studio. per seguire minorenni.",
          ],
        },
        {
          title: "I dati sono tuoi",
          paragraphs: [
            "Le informazioni sulle persone che segui restano tue: sei tu il titolare del trattamento, cioè chi decide come usarle e risponde verso le persone. Il servizio le conserva per te e non le usa per altro.",
            "Per questo devi dare a ogni persona un'informativa sulla privacy. Studio. ne prepara un modello e lo mostra nel portale della persona; ricordati di controllare che ti rispecchi.",
          ],
        },
        {
          title: "Cosa non scrivere",
          paragraphs: [
            "Non inserire dati sanitari (diagnosi, terapie, referti), né altre informazioni molto riservate come orientamento sessuale, convinzioni religiose o politiche, origine etnica, condanne penali. Le note servono per il lavoro didattico.",
            "Identifica ogni persona solo con il nome che ha scelto, senza cognome. Meno dati si inseriscono, meno ce n'è da proteggere.",
            "Se una persona ti racconta qualcosa di questo tipo, non serve trascriverlo: basta annotare quello che ti serve per insegnare.",
          ],
        },
        {
          title: "Passphrase e codice di recupero",
          paragraphs: [
            "I dati sono cifrati sul tuo dispositivo, prima di essere salvati, con una chiave che si apre solo con la tua passphrase. Chi gestisce il servizio non può leggerli.",
            "Per lo stesso motivo non può nemmeno recuperarli: se perdi sia la passphrase sia il codice di recupero, i dati non si riaprono più. Conserva il codice in un posto sicuro.",
          ],
        },
        {
          title: "Portale della persona",
          paragraphs: [
            "Puoi dare a ogni persona un link personale per vedere il proprio percorso. Nel portale va ciò che hai scelto di condividere: le note private non ci arrivano mai.",
            "Puoi interrompere la condivisione in qualsiasi momento: il link smette di funzionare.",
          ],
        },
        {
          title: "Conti e fisco",
          paragraphs: [
            "Studio. tiene traccia di incontri, compensi e pagamenti per aiutarti a vedere il quadro. Non è un programma di contabilità né di fatturazione, e le sue cifre non sostituiscono fatture, ricevute o scritture contabili. Gli obblighi fiscali restano tuoi.",
          ],
        },
        {
          title: "I tuoi dati, sempre con te",
          paragraphs: [
            "Puoi scaricare tutti i tuoi dati e cancellare il tuo archivio quando vuoi, dalle Impostazioni, senza chiedere a nessuno.",
          ],
        },
        {
          title: "Disponibilità e responsabilità",
          paragraphs: [
            "Il servizio è in fase di prova. Faccio il possibile perché funzioni sempre, ma può avere interruzioni o cambiare: ti avviso prima di modifiche importanti e ti lascio il tempo di scaricare i dati.",
            "Valgono la legge italiana e le norme a tutela dei consumatori e dei professionisti che non possono essere derogate.",
          ],
        },
      ],
    },
    {
      key: "privacy",
      title: "Informativa sulla privacy",
      summary: "Quali tuoi dati raccoglie Studio., a cosa servono, quanto restano e a chi scrivere.",
      version: VERSIONS.privacy,
      sections: [
        {
          title: "Chi tratta i dati",
          paragraphs: [
            `Per i dati del tuo account il titolare è ${who} (${cfg.vatNumber}). Contatti: ${cfg.contactEmail}.`,
            "Per le informazioni sulle persone che segui sei tu il titolare e il servizio agisce per tuo conto: vedi l'accordo sul trattamento dei dati.",
          ],
        },
        {
          title: "Quali dati e perché",
          paragraphs: [
            "Dati dell'account: indirizzo email, data di creazione e di accettazione di questi testi. Servono per farti accedere e per dimostrare cosa hai accettato.",
            "Contenuti di lavoro (persone, incontri, percorsi, pagamenti, impostazioni): arrivano al server solo cifrati. Chi gestisce il servizio non può leggerli.",
            "Dati tecnici (orari di accesso, errori): servono a far funzionare il servizio e a tenerlo sicuro.",
          ],
        },
        {
          title: "Base giuridica",
          paragraphs: ["Eseguire il servizio che hai richiesto (contratto) e tenerlo sicuro (interesse legittimo). Non ci sono pubblicità né profilazione."],
        },
        {
          title: "A chi arrivano",
          paragraphs: [
            `Fornitori tecnici che ospitano il servizio (dati nell'${cfg.region}), un servizio di posta per inviare i codici di accesso del portale e, per l'indirizzo web, un servizio di hosting. Nessuno di loro può leggere i contenuti cifrati.`,
            "L'elenco aggiornato dei fornitori è nell'accordo sul trattamento dei dati.",
          ],
        },
        {
          title: "Per quanto tempo",
          paragraphs: [
            "Finché tieni l'archivio. Se lo cancelli, i dati vengono eliminati dal servizio; le copie di sicurezza scadono entro 30 giorni.",
          ],
        },
        {
          title: "I tuoi diritti",
          paragraphs: [
            "Puoi chiedere accesso, correzione, cancellazione e portabilità. Quasi tutto lo fai da solo dalle Impostazioni (scarica e cancella). Per il resto scrivi ai contatti sopra.",
            "Puoi anche rivolgerti al Garante per la protezione dei dati personali.",
          ],
        },
      ],
    },
    {
      key: "dpa",
      title: "Accordo sul trattamento dei dati",
      summary: "Il contratto che l'articolo 28 del GDPR richiede tra chi usa il servizio e chi lo fornisce.",
      version: VERSIONS.dpa,
      sections: [
        {
          title: "Ruoli",
          paragraphs: [
            `Tu sei il titolare del trattamento dei dati delle persone che segui. ${who} è il responsabile del trattamento: conserva i dati per tuo conto e solo secondo le tue istruzioni.`,
          ],
        },
        {
          title: "Cosa viene trattato",
          paragraphs: [
            "Conservazione cifrata di schede, incontri, percorsi, pagamenti e impostazioni, e pubblicazione cifrata del pacchetto che mostri alla persona nel portale. Durata: finché tieni l'archivio.",
            "Per via della cifratura, il responsabile non ha accesso al contenuto. I dati personali visibili al servizio sono solo quelli tecnici e l'impronta (non leggibile) dell'email di chi accede al portale.",
          ],
        },
        {
          title: "Impegni del responsabile",
          paragraphs: [
            "Tratta i dati solo secondo le tue istruzioni. Chi lavora sul servizio è tenuto alla riservatezza.",
            "Adotta misure di sicurezza adeguate: cifratura dei contenuti prima che lascino il dispositivo, accessi separati per professionista, codici di accesso monouso per le persone.",
            "Ti aiuta a rispondere alle richieste delle persone e ai controlli. Ti avvisa senza ritardo, e comunque entro 48 ore, se viene a conoscenza di una violazione dei dati.",
            "Alla fine ti restituisce i dati (esportazione dalle Impostazioni) e poi li cancella.",
          ],
        },
        {
          title: "Altri fornitori",
          paragraphs: [
            `Il servizio si appoggia a fornitori di archiviazione, hosting e posta con sede o data center nell'${cfg.region}. Se ne aggiungo o ne cambio, ti avviso in anticipo e puoi opporti smettendo di usare il servizio. Dati personali non escono dallo Spazio economico europeo, salvo garanzie adeguate previste dal GDPR.`,
          ],
        },
        {
          title: "Controlli",
          paragraphs: ["Puoi chiedere informazioni per verificare che questi impegni siano rispettati. Rispondo per iscritto."],
        },
      ],
    },
  ];
}

/** Modello di informativa che il professionista dà alle persone: lo vedono nel portale. */
export function personNotice(teacherName: string, contact: string): LegalSection[] {
  const who = teacherName.trim() || "chi ti segue";
  const how = contact.trim() ? `Per esercitare i tuoi diritti scrivi a ${contact.trim()}.` : "Per esercitare i tuoi diritti rivolgiti a chi ti segue.";
  return [
    { title: "Chi tratta i tuoi dati", paragraphs: [`${who} è la persona che decide come usare le informazioni che ti riguardano, per seguirti nel tuo percorso.`] },
    { title: "Quali dati", paragraphs: ["Il nome che hai scelto (senza cognome), recapiti, obiettivo, incontri svolti, presenze, appunti di lavoro e importi del percorso."] },
    { title: "Perché", paragraphs: ["Per organizzare gli incontri, tenere traccia del percorso e gestire i pagamenti. Non servono ad altro e non sono venduti."] },
    { title: "Dove stanno", paragraphs: ["In un archivio cifrato su un servizio con sede nell'Unione europea. Il fornitore non può leggerli."] },
    { title: "Quanto restano", paragraphs: ["Finché il percorso è attivo e per il tempo richiesto dagli obblighi di legge, poi vengono cancellati."] },
    { title: "I tuoi diritti", paragraphs: ["Puoi chiedere di vedere, correggere, portare altrove o cancellare i tuoi dati, e puoi rivolgerti al Garante per la protezione dei dati personali.", how] },
  ];
}

// ---- Accettazione ----------------------------------------------------------

export interface Acceptance {
  termsVersion: string;
  privacyVersion: string;
  dpaVersion: string;
  adultOnly: boolean;
  healthDataExcluded: boolean;
  /** ISO. */
  at: string;
}

export function currentAcceptance(now: Date): Acceptance {
  return {
    termsVersion: VERSIONS.terms,
    privacyVersion: VERSIONS.privacy,
    dpaVersion: VERSIONS.dpa,
    adultOnly: true,
    healthDataExcluded: true,
    at: now.toISOString(),
  };
}

/** Vero se non c'è accettazione, o se un testo è cambiato da allora, o se mancano le dichiarazioni. */
export function needsAcceptance(a: Acceptance | null | undefined): boolean {
  if (!a) return true;
  return (
    a.termsVersion !== VERSIONS.terms ||
    a.privacyVersion !== VERSIONS.privacy ||
    a.dpaVersion !== VERSIONS.dpa ||
    a.adultOnly !== true ||
    a.healthDataExcluded !== true
  );
}

/** Quali testi sono cambiati dall'ultima accettazione: serve a dirlo a chi deve rileggere. */
export function changedDocuments(a: Acceptance | null | undefined): DocKey[] {
  if (!a) return ["terms", "privacy", "dpa"];
  const out: DocKey[] = [];
  if (a.termsVersion !== VERSIONS.terms) out.push("terms");
  if (a.privacyVersion !== VERSIONS.privacy) out.push("privacy");
  if (a.dpaVersion !== VERSIONS.dpa) out.push("dpa");
  return out;
}

/** Segnaposto ancora da compilare prima di aprire ad altri. */
export function placeholdersLeft(cfg: LegalConfig = LEGAL_CONFIG): string[] {
  return Object.entries(cfg)
    .filter(([, v]) => /\[.*da compilare.*\]/.test(v))
    .map(([k]) => k);
}
