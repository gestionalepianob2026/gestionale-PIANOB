import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Carica il database con gli utenti iniziali e gli articoli dall'Excel.
//
// SICUREZZA: il seed è pensato per un database VUOTO.
//  - se ci sono già articoli NON li cancella (serve --force-prodotti, che
//    elimina anche tutto lo storico movimenti e le bolle);
//  - non sovrascrive le password di utenti già esistenti;
//  - la password iniziale è casuale e viene mostrata una volta sola, oppure si
//    imposta con SEED_PASSWORD=... (mai una password fissa nel codice).

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const forza = process.argv.includes("--force-prodotti");

async function main() {
  const password = process.env.SEED_PASSWORD || randomBytes(6).toString("base64url");
  const users = [
    { email: "admin@pianob.it", name: "Admin", role: "ADMIN" },
    { email: "marco@pianob.it", name: "Marco Rossi", role: "CREW" },
  ];
  const creati = [];
  for (const u of users) {
    const esiste = await prisma.user.findUnique({ where: { email: u.email } });
    if (esiste) continue; // mai toccare utenti e password esistenti
    await prisma.user.create({
      data: { ...u, password: await bcrypt.hash(password, 10) },
    });
    creati.push(u.email);
  }
  if (creati.length) {
    console.log(`Utenti creati: ${creati.join(", ")}`);
    console.log(`Password iniziale (cambiala dal profilo): ${password}`);
  } else {
    console.log("Utenti già presenti: password invariate.");
  }

  const gia = await prisma.product.count();
  if (gia > 0 && !forza) {
    console.log(
      `Ci sono già ${gia} articoli: NON li sovrascrivo. (Per ricrearli da zero, cancellando storico e bolle: --force-prodotti)`,
    );
    return;
  }

  const data = JSON.parse(readFileSync(join(__dirname, "seed-data.json"), "utf-8"));
  if (gia > 0) await prisma.product.deleteMany();
  let n = 0;
  for (let i = 0; i < data.length; i += 200) {
    const batch = data.slice(i, i + 200).map((r) => ({
      prodotto: r.prodotto,
      categoria: r.categoria,
      tipologia: r.tipologia === "Vini" ? null : r.tipologia,
      zona: r.zona,
      fornitore: r.fornitore,
      prezzoUnit: r.prezzoUnit,
      ivaRate: r.ivaRate,
      quantita: r.quantita,
      sogliaMin: 3,
    }));
    await prisma.product.createMany({ data: batch });
    n += batch.length;
  }
  console.log(`Articoli importati: ${n}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
