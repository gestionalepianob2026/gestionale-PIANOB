import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizzaTermine } from "@/lib/consumi";

type RigaIn = {
  productId?: string;
  qta?: number | string;
  termine?: string;
};

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const righe: RigaIn[] = Array.isArray(body.righe) ? body.righe : [];
  if (righe.length === 0)
    return NextResponse.json(
      { error: "Nessuna riga da applicare" },
      { status: 400 },
    );

  const ids = [...new Set(righe.map((r) => r.productId).filter(Boolean))] as string[];
  const prodotti = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, quantita: true },
  });
  const giacenze = new Map(prodotti.map((p) => [p.id, p.quantita]));

  const ops: {
    productId: string;
    qta: number;
    qtaPrima: number;
    qtaDopo: number;
    termine: string | null;
  }[] = [];

  for (const r of righe) {
    if (!r.productId || !giacenze.has(r.productId)) continue;
    const qta = num(r.qta);
    if (qta === undefined || qta <= 0) continue;
    const qtaPrima = giacenze.get(r.productId)!;
    const qtaDopo = Math.max(0, qtaPrima - qta);
    const termine =
      typeof r.termine === "string" && r.termine.trim()
        ? normalizzaTermine(r.termine)
        : null;
    ops.push({ productId: r.productId, qta, qtaPrima, qtaDopo, termine });
    giacenze.set(r.productId, qtaDopo);
  }

  if (ops.length === 0)
    return NextResponse.json(
      { error: "Nessuna riga valida (prodotto o quantità mancante)" },
      { status: 400 },
    );

  // Termini -> productId da memorizzare come alias (ultimo vince).
  const aliasDaSalvare = new Map<string, string>();
  for (const o of ops) if (o.termine) aliasDaSalvare.set(o.termine, o.productId);

  await prisma.$transaction([
    ...ops.map((o) =>
      prisma.movimento.create({
        data: {
          productId: o.productId,
          tipo: "SCARICO",
          quantita: o.qta,
          qtaPrima: o.qtaPrima,
          qtaDopo: o.qtaDopo,
          note: "Da messaggio consumi",
          userId: user.id,
        },
      }),
    ),
    ...ops.map((o) =>
      prisma.product.update({
        where: { id: o.productId },
        data: { quantita: o.qtaDopo },
      }),
    ),
    ...[...aliasDaSalvare.entries()].map(([termine, productId]) =>
      prisma.alias.upsert({
        where: { termine },
        create: { termine, productId },
        update: { productId, usi: { increment: 1 } },
      }),
    ),
  ]);

  const aggiornati = ops.map((o) => ({ id: o.productId, quantita: o.qtaDopo }));
  return NextResponse.json({
    ok: true,
    count: ops.length,
    aliasSalvati: aliasDaSalvare.size,
    products: aggiornati,
  });
}
