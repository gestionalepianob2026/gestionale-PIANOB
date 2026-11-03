import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizzaTermine } from "@/lib/consumi";
import { bloccaGiacenze } from "@/lib/giacenza";

type RigaIn = {
  productId?: string;
  qta?: number | string;
  termine?: string;
};

const MAX_RIGHE = 200;

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

class NessunaRiga extends Error {}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const righe: RigaIn[] = Array.isArray(body.righe) ? body.righe.slice(0, MAX_RIGHE) : [];
  if (righe.length === 0)
    return NextResponse.json({ error: "Nessuna riga da applicare" }, { status: 400 });

  const ids = [...new Set(righe.map((r) => r.productId).filter((x): x is string => typeof x === "string"))];

  try {
    const esito = await prisma.$transaction(
      async (tx) => {
        // giacenze lette dentro la transazione (niente sovrascritture tra colleghi)
        const giacenze = await bloccaGiacenze(tx, ids);

        const ops: { productId: string; qta: number; qtaPrima: number; qtaDopo: number }[] = [];
        const alias = new Map<string, string>(); // termine → productId (ultimo vince)

        for (const r of righe) {
          if (!r.productId || !giacenze.has(r.productId)) continue;
          const qta = num(r.qta);
          if (qta === undefined || qta <= 0 || qta > 100000) continue;
          const qtaPrima = giacenze.get(r.productId)!;
          const qtaDopo = Math.max(0, qtaPrima - qta);
          ops.push({ productId: r.productId, qta, qtaPrima, qtaDopo });
          giacenze.set(r.productId, qtaDopo);
          const termine =
            typeof r.termine === "string" && r.termine.trim() ? normalizzaTermine(r.termine) : "";
          if (termine && termine.length <= 80) alias.set(termine, r.productId);
        }
        if (ops.length === 0) throw new NessunaRiga();

        for (const o of ops) {
          await tx.movimento.create({
            data: {
              productId: o.productId,
              tipo: "SCARICO",
              quantita: o.qta,
              qtaPrima: o.qtaPrima,
              qtaDopo: o.qtaDopo,
              note: "Da messaggio consumi",
              userId: user.id,
            },
          });
          await tx.product.update({ where: { id: o.productId }, data: { quantita: o.qtaDopo } });
        }
        for (const [termine, productId] of alias)
          await tx.alias.upsert({
            where: { termine },
            create: { termine, productId },
            update: { productId, usi: { increment: 1 } },
          });

        return {
          ops,
          aliasSalvati: alias.size,
        };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    return NextResponse.json({
      ok: true,
      count: esito.ops.length,
      aliasSalvati: esito.aliasSalvati,
      products: esito.ops.map((o) => ({ id: o.productId, quantita: o.qtaDopo })),
    });
  } catch (e) {
    if (e instanceof NessunaRiga)
      return NextResponse.json(
        { error: "Nessuna riga valida (prodotto o quantità mancante)" },
        { status: 400 },
      );
    console.error("consumi applica error", e);
    return NextResponse.json({ error: "Salvataggio non riuscito: riprova." }, { status: 500 });
  }
}
