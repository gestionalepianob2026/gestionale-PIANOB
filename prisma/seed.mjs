import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  // --- Utenti ---
  const users = [
    { email: "admin@pianob.it", name: "Admin", role: "ADMIN", password: "pianob2026" },
    { email: "marco@pianob.it", name: "Marco Rossi", role: "CREW", password: "pianob2026" },
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, password: hash },
      create: { email: u.email, name: u.name, role: u.role, password: hash },
    });
  }
  console.log(`Utenti pronti: ${users.map((u) => u.email).join(", ")}`);

  // --- Articoli (dal tuo Excel) ---
  const data = JSON.parse(readFileSync(join(__dirname, "seed-data.json"), "utf-8"));
  await prisma.product.deleteMany();
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
