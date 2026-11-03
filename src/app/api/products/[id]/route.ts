import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { caricaFornitori, risolviFornitore } from "@/lib/fornitori";
import { bloccaGiacenze } from "@/lib/giacenza";

const IVA_VALIDE = [0, 4, 5, 10, 22];

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).replace(/\s+/g, " ").trim().slice(0, max);
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
    data.prodotto = body.prodotto.replace(/\s+/g, " ").trim().slice(0, 160);
  if (typeof body.categoria === "string" && body.categoria.trim())
    data.categoria = body.categoria.replace(/\s+/g, " ").trim().slice(0, 40);
  if ("tipologia" in body) data.tipologia = strField(body.tipologia, 40);
  if ("zona" in body) data.zona = strField(body.zona, 60);
  if ("fornitore" in body) {
    const f = strField(body.fornitore, 120);
    // stesso fornitore scritto in modo diverso (Giesse/giesse) → grafia già in uso
    data.fornitore = f ? risolviFornitore(await caricaFornitori(prisma), f) : f;
  }

  const prezzoUnit = num(body.prezzoUnit);
  if (prezzoUnit !== undefined) data.prezzoUnit = Math.max(0, prezzoUnit);
  const ivaRate = num(body.ivaRate);
  if (ivaRate !== undefined && IVA_VALIDE.includes(ivaRate)) data.ivaRate = ivaRate;
  const sogliaMin = num(body.sogliaMin);
  if (sogliaMin !== undefined) data.sogliaMin = Math.max(0, sogliaMin);
  const nuovaQuantita = num(body.quantita);

  if (Object.keys(data).length === 0 && nuovaQuantita === undefined) {
    return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      const giac = (await bloccaGiacenze(tx, [id])).get(id);
      if (giac === undefined) return null;
      const attuale = { quantita: giac };

      // La giacenza cambia SOLO se il valore inviato è diverso da quello a database
      // (il form invia sempre tutti i campi: così non si sovrascrive il lavoro di un
      // collega) e ogni variazione lascia un movimento di rettifica, visibile nelle
      // statistiche.
      if (nuovaQuantita !== undefined) {
        const qtaDopo = Math.max(0, nuovaQuantita);
        if (qtaDopo !== attuale.quantita) {
          data.quantita = qtaDopo;
          await tx.movimento.create({
            data: {
              productId: id,
              tipo: "RETTIFICA",
              quantita: Math.abs(qtaDopo - attuale.quantita),
              qtaPrima: attuale.quantita,
              qtaDopo,
              note: "Modifica manuale da inventario",
              userId: user.id,
            },
          });
        }
      }
      if (Object.keys(data).length === 0) return tx.product.findUnique({ where: { id } });
      return tx.product.update({ where: { id }, data });
    });

    if (!product) return NextResponse.json({ error: "Articolo non trovato" }, { status: 404 });
    return NextResponse.json({ product });
  } catch (e) {
    console.error("product patch error", e);
    return NextResponse.json({ error: "Salvataggio non riuscito: riprova." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  // Eliminare un articolo cancella anche tutto il suo storico movimenti e le
  // statistiche collegate: lo può fare solo l'amministratore.
  if (user.role !== "ADMIN")
    return NextResponse.json(
      { error: "Solo l'amministratore può eliminare un articolo." },
      { status: 403 },
    );

  const { id } = await ctx.params;
  try {
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Articolo non trovato" }, { status: 404 });
  }
}
