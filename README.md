# PIANO B — Gestionale

Gestionale di magazzino per il locale **PIANO B**: inventario, consumi di fine
turno, statistiche utili alla gestione e **lettura automatica delle bolle**
(foto anche scritte a mano, PDF, Excel/CSV, fattura elettronica XML).

Next.js 16 · React 19 · Tailwind v4 · Prisma 6 + **Postgres** · API Claude.

---

## Sviluppo in locale

Serve un Postgres. Il progetto usa `DATABASE_URL` (in `.env` o `.env.local`,
quest'ultimo ha la precedenza ed è ignorato da git).

```bash
npm install
npx prisma db push      # crea le tabelle
npm run db:seed         # utenti iniziali + 1170 articoli (SOLO su db vuoto)
npm run dev             # http://localhost:3000
```

`db:seed` **non sovrascrive mai** dati esistenti: se ci sono già articoli si
ferma, e non tocca le password degli utenti presenti. La password iniziale è
casuale e viene mostrata una sola volta (oppure `SEED_PASSWORD=... npm run db:seed`).
Cambiala subito dal profilo (clic sul tuo nome in basso a sinistra).

---

## Funzioni

- **Dashboard** con valore del magazzino, sotto scorta, ultima bolla.
- **Inventario**: ricerca, filtri, modifica giacenza/prezzi/soglie (ogni
  modifica manuale della giacenza lascia una rettifica nello storico), export
  CSV. L'eliminazione di un articolo è riservata all'amministratore.
- **Consumi** (`/giacenza`): scarico da messaggio WhatsApp (riconosce i
  soprannomi, li impara alla prima conferma) o manuale.
- **Scansiona bolla**: più foto/pagine insieme, PDF, Excel/CSV, XML FatturaPA.
  Le righe vengono abbinate agli articoli già in magazzino (si carica la
  giacenza invece di creare doppioni), con controllo di quantità × prezzo e
  della somma contro l'imponibile; ogni carico lascia un movimento.
- **Statistiche**: cosa ordinare e da chi, articoli in esaurimento, consumi e
  acquisti per periodo, top prodotti, giorni forti, scorte ferme, ammanchi di
  inventario, qualità dei dati.
- **Fornitori**: `Giesse`, `giesse`, `GIESSE` sono lo stesso fornitore (il
  confronto ignora maiuscole e accenti). Per unire i doppioni già presenti:
  `npm run db:unisci-fornitori` (con `-- --dry-run` mostra prima cosa farebbe).

---

## Lettura bolle con l'AI

Funziona con **OpenAI** (`OPENAI_API_KEY`, modelli `gpt-5.5` per i documenti e
`gpt-5.4-mini` per i consumi; cambiabili con `OPENAI_MODEL_SCAN` / `OPENAI_MODEL_CONSUMI`)
oppure con **Anthropic** (sotto). Se c'è una sola chiave usa quella; con entrambe
vince Anthropic, a meno di `AI_PROVIDER=openai`.

1. Chiave su <https://console.anthropic.com/> → `.env`:
   ```env
   ANTHROPIC_API_KEY="sk-ant-..."
   # opzionali (default sotto):
   # ANTHROPIC_MODEL_SCAN="claude-sonnet-5-5"     # lettura documenti
   # ANTHROPIC_MODEL_CONSUMI="claude-haiku-5-5"   # abbinamento soprannomi
   ```
2. Riavvia il server.

Le **fatture XML** si leggono senza AI (gratis e precise). Senza chiave la
pagina funziona comunque con XML e inserimento manuale.

Costi contenuti: il prompt statico e il catalogo prodotti sono in cache, le
foto vengono ridotte nel browser prima dell'invio, l'AI dei consumi interviene
solo sui termini che alias e abbinamento locale non riconoscono.

---

## Bot Telegram: scarico consumi dal gruppo

I ragazzi scrivono nel gruppo Telegram cosa hanno consumato (`12 san pell`,
`3 aperol`, `coca zero x6`, anche più voci su una riga separate da virgola) e
il magazzino si scarica da solo. Il bot risponde col riepilogo
(`✅ 12 × San Pellegrino (20 → 8)`, avviso se sotto scorta).

- Scarico **automatico** solo se il prodotto è certo (soprannome già imparato,
  nome inequivocabile; l'AI da sola non basta, suggerisce solo il pulsante giusto). Se ha un dubbio, mostra 2-3 pulsanti
  con i prodotti possibili: un tocco scarica **e memorizza** il soprannome.
- Pulsante **↩️ Annulla scarico** (entro 24 ore): rimette tutto a posto.
- Lo stesso messaggio non scarica mai due volte; scarichi simultanei di più
  persone non si sovrascrivono (la giacenza è bloccata durante l'aggiornamento).
- Gli scarichi compaiono nello storico/statistiche come gli altri (nota «Telegram · Nome»).

**Attivazione (una tantum)** — serve il sito online (HTTPS):
1. Su Telegram, **@BotFather** → `/setprivacy` → scegli il bot → **Disable**
   (altrimenti in un gruppo il bot non vede i messaggi normali), poi aggiungi il bot al gruppo.
2. Variabili sul server: `TELEGRAM_BOT_TOKEN` (da BotFather), `TELEGRAM_WEBHOOK_SECRET`
   (stringa casuale 16+ caratteri), `TELEGRAM_SETUP_CODE` (parola d'ordine a tua scelta).
   Poi `npx prisma db push` (nuove tabelle; lo fa già il build su Render).
3. Collega il bot al sito: `npm run telegram:webhook -- https://tuo-sito.onrender.com`
   (`--stato` per controllare, `--rimuovi` per scollegare).
4. Nel gruppo scrivi `/attiva LA_TUA_PAROLA`. Da quel momento il gruppo è autorizzato;
   gli altri gruppi/persone vengono ignorati. `/disattiva` lo toglie, `/aiuto` mostra le istruzioni.

---

## Pubblicazione (Render + Postgres)

`render.yaml` descrive il servizio. Variabili: `DATABASE_URL` (Postgres),
`AUTH_SECRET` (generata da Render), `ANTHROPIC_API_KEY`. In produzione
`AUTH_SECRET` deve essere lunga (24+ caratteri) e non di esempio, altrimenti
l'app si rifiuta di avviarsi. `/api/ping` serve per il keep-alive.

---

## Comandi utili

| Comando                      | Descrizione                                        |
| ---------------------------- | -------------------------------------------------- |
| `npm run dev`                | Server di sviluppo                                 |
| `npm run build` / `start`    | Build e avvio di produzione                        |
| `npm run db:seed`            | Carica utenti e articoli su db vuoto               |
| `npm run db:unisci-fornitori`| Unisce i fornitori scritti in modo diverso         |
| `npm run db:reset`           | Azzera e ricrea il database (cancella tutto)       |
| `npm run db:studio`          | Interfaccia visuale al database                    |

---

## Struttura

```
src/
  app/(app)/        dashboard, inventario, consumi, statistiche, aggiungi, scansiona
  app/api/          auth, products, movimenti, consumi, scan, bolle
  lib/              auth, ai (modelli/errori), bolla (schema/parsers/controlli),
                    consumi (parser + ricerca fuzzy), fornitori, statistiche
  components/       Logo, AppShell, ProductPicker, icone
prisma/             schema, seed, seed-data.json, unisci-fornitori
```
