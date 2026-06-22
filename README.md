# PIANO B — Gestionale

Gestionale di magazzino per il locale **PIANO B**: inventario di vini, bevande e
alimenti, dashboard, inserimento manuale e **scansione delle bolle con AI**.

Costruito con Next.js 16, React 19, Tailwind CSS v4, Prisma e l'API Claude
(Anthropic) per la lettura automatica delle bolle.

---

## Avvio rapido (sviluppo)

```bash
cd gestionale
npm install
npm run db:push     # crea il database SQLite
npm run db:seed     # importa gli articoli dall'Excel + crea gli utenti
npm run dev         # avvia su http://localhost:3000
```

### Credenziali di accesso

| Ruolo | Email             | Password     |
| ----- | ----------------- | ------------ |
| Admin | admin@pianob.it   | pianob2026   |
| Crew  | marco@pianob.it   | pianob2026   |

> Cambia le password in produzione: modifica `prisma/seed.mjs` ed esegui di nuovo
> `npm run db:seed`, oppure aggiungi una pagina di gestione utenti.

---

## Funzionalità

- **Login** con sessione sicura (cookie firmato JWT).
- **Dashboard**: valore magazzino, n° articoli, articoli sotto scorta, ultima
  bolla, distribuzione del valore per categoria, lista "da riordinare".
- **Inventario**: ricerca, filtri per categoria e "sotto scorta", modifica
  rapida della giacenza, prezzi, fornitore e soglia minima, eliminazione.
- **Aggiungi**: inserimento manuale di un articolo.
- **Scansiona bolla (AI)**: carichi/scatti la foto di una bolla, Claude estrae
  numero documento, fornitore e righe prodotto; tu correggi e confermi.

I 1170 articoli reali sono importati da `Inventario 30 Aprile.xlsx`
(vini, bevande, distillati) tramite `prisma/seed-data.json`.

---

## Attivare la scansione AI

La funzione è già pronta; va solo fornita la chiave API:

1. Crea una chiave su <https://console.anthropic.com/>.
2. Apri il file `.env` e imposta:
   ```env
   ANTHROPIC_API_KEY="sk-ant-..."
   ANTHROPIC_MODEL="claude-opus-4-8"
   ```
3. Riavvia il server.

Finché la chiave è vuota, la pagina "Scansiona bolla" funziona comunque: avvisa
che l'AI non è attiva e permette l'inserimento manuale delle righe.

---

## Pubblicazione online (telefono + PC)

Il database di default è **SQLite** (file `prisma/dev.db`), ideale per lo
sviluppo e per un PC del locale. Per l'accesso online da più dispositivi conviene
un database gestito (es. **Postgres** su Neon/Supabase) e l'hosting su Vercel,
Railway o un VPS:

1. In `prisma/schema.prisma` cambia `provider = "sqlite"` in `"postgresql"`.
2. Imposta `DATABASE_URL` con la stringa di connessione Postgres.
3. `npm run db:push && npm run db:seed`.
4. Configura su hosting le variabili `DATABASE_URL`, `AUTH_SECRET` (un valore
   lungo e casuale) e, se vuoi l'AI, `ANTHROPIC_API_KEY`.
5. `npm run build && npm run start`.

---

## Comandi utili

| Comando             | Descrizione                                        |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Server di sviluppo                                 |
| `npm run build`     | Build di produzione                                |
| `npm run start`     | Avvia la build di produzione                       |
| `npm run db:seed`   | Reimporta articoli e utenti                        |
| `npm run db:reset`  | Azzera e ricrea il database (cancella i dati)      |
| `npm run db:studio` | Interfaccia visuale al database (Prisma Studio)    |

---

## Struttura

```
src/
  app/
    login/                  pagina di accesso
    (app)/                  area protetta (dashboard, inventario, aggiungi, scansiona)
    api/
      auth/                 login / logout
      products/             CRUD articoli
      scan/                 analisi AI della bolla
      bolle/                conferma e salvataggio bolla
  components/               Logo, icone, AppShell (sidebar + nav mobile)
  lib/                      prisma, auth (sessioni), format (calcoli/euro)
  proxy.ts                  protezione delle route (ex middleware)
prisma/
  schema.prisma            modello dati (User, Product, Bolla)
  seed.mjs                 importazione dati
  seed-data.json           articoli estratti dall'Excel
```
