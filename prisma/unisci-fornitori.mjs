// Unisce i fornitori scritti in modo diverso solo per maiuscole/minuscole/spazi/accenti
// (es. "Giesse" e "giesse"): per ciascun gruppo tiene la grafia più usata.
// Sicuro da rilanciare (idempotente). Uso:  node prisma/unisci-fornitori.mjs
// Con --dry-run mostra cosa farebbe senza modificare nulla.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dry = process.argv.includes("--dry-run");

const chiave = (s) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  const [prod, bolle] = await Promise.all([
    prisma.product.groupBy({ by: ["fornitore"], where: { fornitore: { not: null } }, _count: true }),
    prisma.bolla.groupBy({ by: ["fornitore"], where: { fornitore: { not: null } }, _count: true }),
  ]);

  const gruppi = new Map(); // chiave -> Map(grafia -> conteggio)
  for (const r of [...prod, ...bolle]) {
    const nome = (r.fornitore ?? "").trim();
    const k = chiave(nome);
    if (!k) continue;
    const m = gruppi.get(k) ?? new Map();
    m.set(nome, (m.get(nome) ?? 0) + r._count);
    gruppi.set(k, m);
  }

  let modifiche = 0;
  for (const [, varianti] of gruppi) {
    if (varianti.size < 2) continue;
    let best = "";
    let bestScore = -1;
    for (const [nome, n] of varianti) {
      const score = n + (/[A-Z]/.test(nome) && /[a-z]/.test(nome) ? 100000 : 0); // prima le grafie curate (Giesse), poi la più usata
      if (score > bestScore) [best, bestScore] = [nome, score];
    }
    for (const nome of varianti.keys()) {
      if (nome === best) continue;
      console.log(`${dry ? "[prova] " : ""}"${nome}" → "${best}"`);
      if (!dry) {
        await prisma.product.updateMany({ where: { fornitore: nome }, data: { fornitore: best } });
        await prisma.bolla.updateMany({ where: { fornitore: nome }, data: { fornitore: best } });
      }
      modifiche++;
    }
  }
  console.log(modifiche ? `Fatto: ${modifiche} varianti unite.` : "Nessun fornitore doppio trovato.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
