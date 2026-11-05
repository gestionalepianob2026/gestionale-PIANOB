// Svuota il magazzino e importa i prodotti già classificati (da FINALE_con_prezzi.xlsx).
// Uso:  node prisma/importa-finale.mjs <file.json> [--dry-run]
// Categorie: CUCINA, STRUZZICHERIA, CAFFETTERIA, BEVANDE, ALCOLICI, VINI (CARTOPLASTICA per ora vuota).
// La sottocategoria va nel campo "tipologia". Giacenze a 0 (il file non ha quantità).
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const file = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!file) throw new Error("Manca il file JSON");
const righe = JSON.parse(fs.readFileSync(file, "utf8"));

const OK = new Set(["CUCINA", "STRUZZICHERIA", "CAFFETTERIA", "BEVANDE", "ALCOLICI", "VINI"]);
const pulisci = (s) =>
  String(s)
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

const prodotti = righe
  .filter((r) => OK.has(r.cat))
  .map((r) => ({
    prodotto: pulisci(r.nome),
    categoria: r.cat,
    tipologia: r.sub || null,
    fornitore: r.forn ? String(r.forn).trim() : null,
    prezzoUnit: r.net != null ? Number(r.net) : 0,
    ivaRate: r.iva != null ? Math.round(Number(r.iva) * 1000) / 10 : 22,
    quantita: 0,
    sogliaMin: 0,
  }))
  .filter((p) => p.prodotto.length > 1);

const conta = {};
for (const p of prodotti) conta[p.categoria] = (conta[p.categoria] ?? 0) + 1;
console.log("Da importare:", prodotti.length, conta);
if (dry) process.exit(0);

const db = new PrismaClient();
const prima = await db.product.count();
await db.$transaction(
  async (tx) => {
    await tx.telegramRiga.updateMany({ data: { productId: null } });
    await tx.alias.deleteMany();
    await tx.movimento.deleteMany();
    await tx.product.deleteMany();
    await tx.product.createMany({ data: prodotti });
  },
  { timeout: 120000 },
);
console.log(`Magazzino svuotato (${prima} prodotti) e importati ${await db.product.count()}.`);
await db.$disconnect();
