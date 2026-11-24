# Studio. — prima versione locale

Cifratura, schema dati e prima schermata (Persone). Non è collegato a Supabase né a Vercel.

## Come si apre l'app
    npm start        # compila e apre http://localhost:5173
Primo avvio: si crea la passphrase e si salva il codice di recupero. I dati stanno nel browser (cifrati); cambiando browser o cancellando i dati del sito si perdono: il collegamento a Supabase serve anche a questo.

## Cosa c'è
- `src/app/` — l'app: `store.ts` (archivio cifrato, con `Backend` sostituibile), `model.ts` (persona, percorso, incontro e regole di conteggio), `people.ts` (operazioni), `persone.ts`/`lock.ts`/`main.ts` (schermate).
- `web/` — pagina e stili. `scripts/serve.mjs` — server locale.
- `src/crypto.ts` — passphrase, chiave di recupero, chiave principale, cifratura dei record.
- `src/share.ts` — chiave per ogni persona, pacchetto del portale, link d'invito (chiave nel frammento `#`).
- `src/portal-auth.ts` — impronta dell'email e codici monouso, per la futura funzione edge del portale.
- `db/schema.sql` — tabelle multi-professionista con RLS.
- `db/rls-test.sql` — verifica che due professionisti non si vedano.

## Come si prova
    tsc -p . && node --test "test/*.test.mjs"   # 24 test: cifratura + logica di Persone, percorsi, incontri
    bash db/run-rls-test.sh                      # 23 controlli di isolamento su un Postgres temporaneo

## Limiti noti
- Derivazione della chiave con PBKDF2 (600.000 iterazioni), l'unica disponibile senza librerie. Argon2id è meglio: da aggiungere quando si installano pacchetti.
- Il test RLS gira su un Postgres con uno schema `auth` simulato, non su Supabase vero.
- Provato in Chrome (desktop e telefono simulato). Non provato su Safari/iPhone. Serve HTTPS o localhost (WebCrypto).
- Dopo il recupero con il codice non c'è ancora la schermata per scegliere una nuova passphrase (la funzione c'è in `crypto.ts`).
- Alla chiusura la chiave sparisce: la passphrase va reinserita a ogni apertura.
- Voci del menu ancora spente: Riepilogo, Agenda, Percorsi, Strutture, Amministrazione. Mancano avvisi, materiali e portale nella scheda persona.
- Regola di conteggio da confermare: un incontro passato conta come svolto anche con presenza "non indicata"; solo "assente non retribuito" non consuma il percorso e va recuperato.
- Font: Inter se presente sul dispositivo, altrimenti quello di sistema (da incorporare).
- Il server vede: tipo di record, date, numero e dimensione dei record, email dell'account del professionista.
- Il portale NON usa Supabase Auth per le persone: altrimenti la loro email resterebbe in chiaro in `auth.users`. Serve una funzione edge che invia il codice e consegna il pacchetto (ancora da scrivere).
- Se si perdono passphrase e chiave di recupero, i dati non sono recuperabili.
