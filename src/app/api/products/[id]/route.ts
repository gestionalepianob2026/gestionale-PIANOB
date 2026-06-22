import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function strField(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if (typeof body.prodotto === "string" && body.prodotto.trim())
    data.prodotto = body.prodotto.trim();
  if (typeof body.categoria === "string" && body.categoria.trim())
    data.categoria = body.categoria.trim();
  if ("tipologia" in body) data.tipologia = strField(body.tipologia);
  if ("zona" in body) data.zona = strField(body.zona);
  if ("fornitore" in body) data.fornitore = strField(body.fornitore);

  const prezzoUnit = num(body.prezzoUnit);
  if (prezzoUnit !== undefined) data.prezzoUnit = prezzoUnit;
  const ivaRate = num(body.ivaRate);
  if (ivaRate !== undefined) data.ivaRate = ivaRate;
  const quantita = num(body.quantita);
  if (quantita !== undefined) data.quantita = Math.max(0, quantita);
  const sogliaMin = num(body.sogliaMin);
  if (sogliaMin !== undefined) data.sogliaMin = Math.max(0, sogliaMin);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
  }

  try {
    const product = await prisma.product.update({ where: { id }, data });
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ error: "Articolo non trovato" }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  try {
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Articolo non trovato" }, { status: 404 });
  }
}
