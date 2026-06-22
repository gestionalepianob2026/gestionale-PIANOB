import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

function num(v: unknown, def = 0): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : def;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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
      fornitore: strOrNull(body.fornitore),
      prezzoUnit: num(body.prezzoUnit),
      ivaRate: num(body.ivaRate, 22),
      quantita: num(body.quantita),
      sogliaMin: num(body.sogliaMin, 3),
    },
  });

  return NextResponse.json({ product }, { status: 201 });
}
