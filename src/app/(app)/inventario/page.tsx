import { prisma } from "@/lib/prisma";
import type { ProductDTO } from "@/lib/format";
import { InventarioClient } from "./inventario-client";

export const dynamic = "force-dynamic";

export default async function InventarioPage() {
  const rows = await prisma.product.findMany({
    orderBy: { prodotto: "asc" },
    select: {
      id: true,
      prodotto: true,
      categoria: true,
      tipologia: true,
      zona: true,
      fornitore: true,
      prezzoUnit: true,
      ivaRate: true,
      quantita: true,
      sogliaMin: true,
    },
  });

  const products = rows as ProductDTO[];

  const catMap = new Map<string, number>();
  for (const p of products)
    catMap.set(p.categoria, (catMap.get(p.categoria) ?? 0) + 1);
  const categories = [...catMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return <InventarioClient initialProducts={products} categories={categories} />;
}
