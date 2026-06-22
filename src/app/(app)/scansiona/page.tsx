import { prisma } from "@/lib/prisma";
import { ScanClient } from "./scan-client";

export const dynamic = "force-dynamic";

export default async function ScansionaPage() {
  const cats = await prisma.product.findMany({
    distinct: ["categoria"],
    select: { categoria: true },
    orderBy: { categoria: "asc" },
  });
  const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
  return <ScanClient categorie={cats.map((c) => c.categoria)} aiEnabled={aiEnabled} />;
}
