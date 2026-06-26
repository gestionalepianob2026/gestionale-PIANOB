import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Tipo = "CARICO" | "SCARICO" | "RETTIFICA";

type RigaMov = {
  productId?: string;
  tipo?: string;
  quantita?: number | string; // per CARICO / SCARICO: quantità del movimento
  conteggio?: number | string; // per RETTIFICA: giacenza reale contata
  note?: string | null;
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
  const righe: RigaMov[] = Array.isArray(body.movimenti) ? body.movimenti : [];

  if (righe.length === 0)
    return NextResponse.json(
      { error: "Nessun movimento da registrare" },
      { status: 400 },
    );

  // Normalizza e calcola la giacenza risultante per ogni riga.
  const ids = [...new Set(righe.map((r) => r.productId).filter(Boolean))] as string[];
  const prodotti = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, quantita: true },
  });
  const giacenze = new Map(prodotti.map((p) => [p.id, p.quantita]));

  const ops: {
    productId: string;
    tipo: Tipo;
    quantita: number;
    qtaPrima: number;
    qtaDopo: number;
    note: string | null;
  }[] = [];

  for (const r of righe) {
    const tipo = String(r.tipo ?? "").toUpperCase() as Tipo;
    if (!r.productId || !giacenze.has(r.productId)) continue;
    if (!["CARICO", "SCARICO", "RETTIFICA"].includes(tipo)) continue;

    const qtaPrima = giacenze.get(r.productId)!;
    let qtaDopo: number;
    let quantita: number;

    if (tipo === "RETTIFICA") {
      const conteggio = num(r.conteggio);
      if (conteggio === undefined) continue;
      qtaDopo = Math.max(0, conteggio);
      quantita = Math.abs(qtaDopo - qtaPrima);
    } else {
      const q = num(r.quantita);
      if (q === undefined || q <= 0) continue;
      quantita = q;
      qtaDopo =
        tipo === "CARICO"
          ? qtaPrima + q
          : Math.max(0, qtaPrima - q);
    }

    if (qtaDopo === qtaPrima) continue; // nessun effetto reale

    ops.push({
      productId: r.productId,
      tipo,
      quantita,
      qtaPrima,
      qtaDopo,
      note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : null,
    });
    // se lo stesso prodotto compare due volte, parti dalla giacenza aggiornata
    giacenze.set(r.productId, qtaDopo);
  }

  if (ops.length === 0)
    return NextResponse.json(
      { error: "Nessun movimento valido (giacenze invariate)" },
      { status: 400 },
    );

  await prisma.$transaction([
    ...ops.map((o) =>
      prisma.movimento.create({
        data: {
          productId: o.productId,
          tipo: o.tipo,
          quantita: o.quantita,
          qtaPrima: o.qtaPrima,
          qtaDopo: o.qtaDopo,
          note: o.note,
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
  ]);

  // Restituisce le giacenze finali per aggiornare la UI senza ricaricare.
  const aggiornati = ops.map((o) => ({ id: o.productId, quantita: o.qtaDopo }));
  return NextResponse.json({ ok: true, count: ops.length, products: aggiornati });
}
