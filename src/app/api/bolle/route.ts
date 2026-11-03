import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizzaTermine } from "@/lib/consumi";
import { caricaFornitori, risolviFornitore } from "@/lib/fornitori";
import { bloccaGiacenze } from "@/lib/giacenza";

type Riga = {
  prodotto?: unknown;
  categoria?: unknown;
  tipologia?: unknown;
  zona?: unknown;
  fornitore?: unknown;
  prezzoUnit?: unknown;
  ivaRate?: unknown;
  quantita?: unknown;
  productId?: unknown; // se presente: carica questo articolo invece di crearne uno nuovo
};

const IVA_VALIDE = [0, 4, 5, 10, 22];
const MAX_RIGHE = 300;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown, max = 160): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const grezze: Riga[] = Array.isArray(body.righe) ? body.righe.slice(0, MAX_RIGHE) : [];

  const righe = grezze
    .map((r) => ({
      prodotto: str(r.prodotto),
      categoria: str(r.categoria, 40) ?? "Altro",
      tipologia: str(r.tipologia, 40),
      zona: str(r.zona, 60),
      fornitore: str(r.fornitore, 120),
      prezzoUnit: Math.max(0, num(r.prezzoUnit) ?? 0),
      ivaRate: IVA_VALIDE.includes(num(r.ivaRate) ?? -1) ? (num(r.ivaRate) as number) : 22,
      quantita: num(r.quantita) ?? 0,
      productId: typeof r.productId === "string" && r.productId ? r.productId : null,
    }))
    .filter((r) => r.prodotto && r.quantita > 0 && r.quantita < 100000);

  if (righe.length === 0)
    return NextResponse.json(
      { error: "Nessuna riga valida da salvare (serve nome e quantità maggiore di zero)" },
      { status: 400 },
    );

  const numero = str(body.numero, 40);
  let data: Date | null = null;
  if (typeof body.data === "string" && body.data) {
    const d = new Date(body.data);
    if (!Number.isNaN(d.getTime())) data = d;
  }
  const totale = righe.reduce((s, r) => s + r.prezzoUnit * (1 + r.ivaRate / 100) * r.quantita, 0);

  try {
    const esito = await prisma.$transaction(async (tx) => {
      // Fornitori scritti in modo diverso (Giesse/giesse) = stesso fornitore.
      const mappaFornitori = await caricaFornitori(tx);
      const fornitoreDoc = risolviFornitore(mappaFornitori, str(body.fornitore, 120));
      for (const r of righe) r.fornitore = risolviFornitore(mappaFornitori, r.fornitore);
      const bolla = await tx.bolla.create({
        data: {
          numero,
          fornitore: fornitoreDoc,
          data,
          totale,
          userId: user.id,
          // salvo le righe già validate, non l'input grezzo dell'utente
          rawJson: JSON.stringify({ numero, fornitore: fornitoreDoc, data: body.data ?? null, righe }),
        },
      });

      // Articoli esistenti, per caricare la giacenza invece di duplicare.
      const esistenti = await tx.product.findMany({
        select: { id: true, prodotto: true, quantita: true },
      });
      const perId = new Map(esistenti.map((p) => [p.id, p]));
      const perNome = new Map(esistenti.map((p) => [normalizzaTermine(p.prodotto), p]));

      let aggiornati = 0;
      let nuovi = 0;
      const alias = new Map<string, string>();

      for (const r of righe) {
        let target = r.productId ? perId.get(r.productId) : undefined;
        // senza scelta esplicita, un nome identico a un articolo esistente lo aggiorna
        if (!target) target = perNome.get(normalizzaTermine(r.prodotto!));

        const nota = `Bolla${numero ? ` n. ${numero}` : ""}${fornitoreDoc ? ` · ${fornitoreDoc}` : ""}`;

        if (target) {
          // giacenza riletta con blocco: un collega potrebbe aver scaricato nel frattempo
          target.quantita = (await bloccaGiacenze(tx, [target.id])).get(target.id) ?? target.quantita;
          const dopo = target.quantita + r.quantita;
          await tx.product.update({
            where: { id: target.id },
            data: {
              quantita: dopo,
              // aggiorna il costo all'ultimo acquisto, se la bolla lo riporta
              ...(r.prezzoUnit > 0 ? { prezzoUnit: r.prezzoUnit, ivaRate: r.ivaRate } : {}),
              ...(r.fornitore || fornitoreDoc ? { fornitore: r.fornitore ?? fornitoreDoc } : {}),
            },
          });
          await tx.movimento.create({
            data: {
              productId: target.id,
              tipo: "CARICO",
              quantita: r.quantita,
              qtaPrima: target.quantita,
              qtaDopo: dopo,
              note: nota,
              userId: user.id,
            },
          });
          target.quantita = dopo; // più righe sullo stesso articolo si sommano
          aggiornati++;
          // impara il nome usato dal fornitore, se diverso da quello a catalogo
          if (r.productId && normalizzaTermine(r.prodotto!) !== normalizzaTermine(target.prodotto))
            alias.set(normalizzaTermine(r.prodotto!), target.id);
        } else {
          const nuovo = await tx.product.create({
            data: {
              prodotto: r.prodotto!,
              categoria: r.categoria,
              tipologia: r.tipologia,
              zona: r.zona,
              fornitore: r.fornitore ?? fornitoreDoc,
              prezzoUnit: r.prezzoUnit,
              ivaRate: r.ivaRate,
              quantita: r.quantita,
              sogliaMin: 3,
              bollaId: bolla.id,
            },
          });
          await tx.movimento.create({
            data: {
              productId: nuovo.id,
              tipo: "CARICO",
              quantita: r.quantita,
              qtaPrima: 0,
              qtaDopo: r.quantita,
              note: nota,
              userId: user.id,
            },
          });
          perId.set(nuovo.id, { id: nuovo.id, prodotto: nuovo.prodotto, quantita: nuovo.quantita });
          perNome.set(normalizzaTermine(nuovo.prodotto), perId.get(nuovo.id)!);
          nuovi++;
        }
      }

      for (const [termine, productId] of alias)
        if (termine && termine.length <= 80)
          await tx.alias.upsert({
            where: { termine },
            create: { termine, productId },
            update: { productId },
          });

      return { aggiornati, nuovi };
    }, { timeout: 30_000, maxWait: 10_000 });

    return NextResponse.json({
      ok: true,
      count: esito.aggiornati + esito.nuovi,
      aggiornati: esito.aggiornati,
      nuovi: esito.nuovi,
    });
  } catch (e) {
    console.error("bolle error", e);
    return NextResponse.json({ error: "Salvataggio non riuscito: riprova." }, { status: 500 });
  }
}
