import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { caricaFornitori, risolviFornitore } from "@/lib/fornitori";

function num(v: unknown, def = 0): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : def;
}
function str(v: unknown, max = 160): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s ? s : null;
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const prodotto = str(body.prodotto);
  const categoria = str(body.categoria);

  if (!prodotto || !categoria) {
    return NextResponse.json(
      { error: "Prodotto e categoria sono obbligatori" },
      { status: 400 },
    );
  }

  const product = await prisma.product.create({
    data: {
      prodotto,
      categoria,
      tipologia: strOrNull(body.tipologia),
      zona: strOrNull(body.zona),
      fornitore: risolviFornitore(await caricaFornitori(prisma), str(body.fornitore)),
      prezzoUnit: Math.max(0, num(body.prezzoUnit)),
      ivaRate: [0, 4, 5, 10, 22].includes(num(body.ivaRate, 22)) ? num(body.ivaRate, 22) : 22,
      quantita: Math.max(0, num(body.quantita)),
      sogliaMin: Math.max(0, num(body.sogliaMin, 3)),
    },
  });

  return NextResponse.json({ product }, { status: 201 });
}
