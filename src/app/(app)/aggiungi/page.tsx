import { prisma } from "@/lib/prisma";
import { AddForm } from "./add-form";
import { fornitoriUnici } from "@/lib/fornitori";

export const dynamic = "force-dynamic";

export default async function AggiungiPage() {
  const [cats, forns] = await Promise.all([
    prisma.product.findMany({
      distinct: ["categoria"],
      select: { categoria: true },
      orderBy: { categoria: "asc" },
    }),
    prisma.product.findMany({
      where: { fornitore: { not: null } },
      distinct: ["fornitore"],
      select: { fornitore: true },
      orderBy: { fornitore: "asc" },
    }),
  ]);

  return (
    <AddForm
      categorie={cats.map((c) => c.categoria)}
      fornitori={fornitoriUnici(forns.map((f) => f.fornitore))}
    />
  );
}
