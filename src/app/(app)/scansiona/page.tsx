import { prisma } from "@/lib/prisma";
import { aiConfigurata } from "@/lib/ai";
import type { ProductDTO } from "@/lib/format";
import { ScanClient } from "./scan-client";

export const dynamic = "force-dynamic";

export default async function ScansionaPage() {
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
  const categorie = [...new Set(rows.map((r) => r.categoria))].sort();
  return (
    <ScanClient
      categorie={categorie}
      products={rows as ProductDTO[]}
      aiEnabled={aiConfigurata()}
    />
  );
}
