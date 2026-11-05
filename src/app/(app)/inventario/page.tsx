import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ProductDTO } from "@/lib/format";
import { InventarioClient } from "./inventario-client";

export const dynamic = "force-dynamic";

export default async function InventarioPage() {
  const session = await getSession();
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

  return <InventarioClient
      initialProducts={products}
      isAdmin={session?.role === "ADMIN"}
    />;
}
