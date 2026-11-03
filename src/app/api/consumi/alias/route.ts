import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizzaTermine } from "@/lib/consumi";

/**
 * Memorizza subito l'abbinamento soprannome → prodotto (es. "cocha" → Coca Cola)
 * appena l'utente lo sceglie a mano, senza aspettare lo scarico del magazzino.
 */
export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const termine =
    typeof body.termine === "string" ? normalizzaTermine(body.termine) : "";
  const productId = typeof body.productId === "string" ? body.productId : "";

  if (!termine || termine.length > 80 || !productId)
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const prodotto = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!prodotto)
    return NextResponse.json({ error: "Prodotto non trovato" }, { status: 404 });

  await prisma.alias.upsert({
    where: { termine },
    create: { termine, productId },
    update: { productId },
  });

  return NextResponse.json({ ok: true, termine });
}
