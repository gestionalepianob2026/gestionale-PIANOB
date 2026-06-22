import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Riga = {
  prodotto: string;
  categoria?: string;
  tipologia?: string | null;
  zona?: string | null;
  fornitore?: string | null;
  prezzoUnit?: number;
  ivaRate?: number;
  quantita?: number;
};

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const righe: Riga[] = Array.isArray(body.righe) ? body.righe : [];
  const valide = righe.filter((r) => r.prodotto && r.prodotto.trim());

  if (valide.length === 0) {
    return NextResponse.json(
      { error: "Nessuna riga valida da salvare" },
      { status: 400 },
    );
  }

  let data: Date | null = null;
  if (body.data) {
    const d = new Date(body.data);
    if (!Number.isNaN(d.getTime())) data = d;
  }

  const bolla = await prisma.bolla.create({
    data: {
      numero: body.numero ?? null,
      fornitore: body.fornitore ?? null,
      data,
      userId: user.id,
      rawJson: JSON.stringify(body),
      totale: valide.reduce(
        (s, r) =>
          s +
          (Number(r.prezzoUnit) || 0) *
            (1 + (Number(r.ivaRate) || 22) / 100) *
            (Number(r.quantita) || 0),
        0,
      ),
      products: {
        create: valide.map((r) => ({
          prodotto: r.prodotto.trim(),
          categoria: (r.categoria ?? "Altro").trim() || "Altro",
          tipologia: r.tipologia?.trim() || null,
          zona: r.zona?.trim() || null,
          fornitore:
            r.fornitore?.trim() || body.fornitore?.trim?.() || null,
          prezzoUnit: Number(r.prezzoUnit) || 0,
          ivaRate: Number(r.ivaRate) || 22,
          quantita: Number(r.quantita) || 0,
          sogliaMin: 3,
        })),
      },
    },
    include: { _count: { select: { products: true } } },
  });

  return NextResponse.json({ ok: true, count: bolla._count.products });
}
