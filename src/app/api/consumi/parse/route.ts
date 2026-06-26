import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseMessaggio, normalizzaTermine } from "@/lib/consumi";

export const maxDuration = 60;

export type Fonte = "alias" | "ai" | "nessuno";

export type RigaConsumo = {
  termine: string;
  qta: number;
  raw: string;
  productId: string | null;
  prodotto: string | null;
  categoria: string | null;
  confidenza: number; // 0..1
  fonte: Fonte;
};

const SYSTEM = `Sei un assistente di un bar/ristorante italiano. I dipendenti inviano messaggi con i prodotti CONSUMATI durante il turno, usando soprannomi, abbreviazioni o nomi storpiati (es. "san pell" = San Pellegrino, "kulmbaker" = Kulmbacher, "coca zero" = Coca Cola Zero, "lome" = limone/Lemonsoda).

Ti vengono dati: (1) un CATALOGO di prodotti numerato e (2) un elenco di TERMINI da abbinare.
Per ogni termine scegli il prodotto del catalogo che corrisponde più probabilmente.

Restituisci ESCLUSIVAMENTE un array JSON valido, senza testo prima o dopo, nella forma:
[{ "termine": string, "idx": number | null, "confidenza": number }]
- "idx" = il numero del prodotto nel catalogo, oppure null se nessun prodotto è plausibile.
- "confidenza" = quanto sei sicuro, da 0 a 1.
- Non inventare indici fuori dal catalogo. Non aggiungere termini non richiesti.`;

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Nessun JSON nella risposta");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const testo = typeof body.testo === "string" ? body.testo : "";
  const { righe: parsed, ignorate } = parseMessaggio(testo);

  if (parsed.length === 0)
    return NextResponse.json({ righe: [], ignorate, aiAttiva: false });

  // Carica prodotti e alias appresi
  const [prodotti, aliasRows] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, prodotto: true, categoria: true },
      orderBy: { prodotto: "asc" },
    }),
    prisma.alias.findMany({ select: { termine: true, productId: true } }),
  ]);
  const prodById = new Map(prodotti.map((p) => [p.id, p]));
  const aliasMap = new Map(aliasRows.map((a) => [a.termine, a.productId]));

  const righe: RigaConsumo[] = parsed.map((r) => ({
    termine: r.termine,
    qta: r.qta,
    raw: r.raw,
    productId: null,
    prodotto: null,
    categoria: null,
    confidenza: 0,
    fonte: "nessuno" as Fonte,
  }));

  // 1) Abbinamento da alias appresi
  const daAI: number[] = [];
  righe.forEach((r, i) => {
    const norm = normalizzaTermine(r.termine);
    const pid = aliasMap.get(norm);
    const prod = pid ? prodById.get(pid) : undefined;
    if (prod) {
      r.productId = prod.id;
      r.prodotto = prod.prodotto;
      r.categoria = prod.categoria;
      r.confidenza = 1;
      r.fonte = "alias";
    } else {
      daAI.push(i);
    }
  });

  // 2) Abbinamento AI per i termini non ancora riconosciuti
  let aiAttiva = false;
  let messaggioAI: string | undefined;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (daAI.length > 0 && apiKey) {
    try {
      const catalogo = prodotti
        .map((p, idx) => `${idx}\t${p.prodotto}\t${p.categoria}`)
        .join("\n");
      const termini = daAI.map((i) => righe[i].termine);

      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
        max_tokens: 4000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `CATALOGO (indice<TAB>prodotto<TAB>categoria):\n${catalogo}\n\nTERMINI da abbinare:\n${JSON.stringify(termini)}`,
          },
        ],
      });

      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const arr = extractJsonArray(text) as {
        termine?: string;
        idx?: number | null;
        confidenza?: number;
      }[];

      // mappa per termine -> risultato
      const byTermine = new Map<string, { idx: number | null; conf: number }>();
      for (const a of arr) {
        if (typeof a.termine !== "string") continue;
        byTermine.set(a.termine, {
          idx: typeof a.idx === "number" ? a.idx : null,
          conf: Number(a.confidenza) || 0,
        });
      }

      for (const i of daAI) {
        const res = byTermine.get(righe[i].termine);
        if (!res || res.idx === null || res.idx < 0 || res.idx >= prodotti.length)
          continue;
        if (res.conf < 0.5) {
          // suggerimento debole: lo lascio non confermato ma propongo
          const p = prodotti[res.idx];
          righe[i].productId = p.id;
          righe[i].prodotto = p.prodotto;
          righe[i].categoria = p.categoria;
          righe[i].confidenza = res.conf;
          righe[i].fonte = "ai";
          continue;
        }
        const p = prodotti[res.idx];
        righe[i].productId = p.id;
        righe[i].prodotto = p.prodotto;
        righe[i].categoria = p.categoria;
        righe[i].confidenza = res.conf;
        righe[i].fonte = "ai";
      }
      aiAttiva = true;
    } catch (e) {
      console.error("consumi parse AI error", e);
      messaggioAI =
        "L'AI non è riuscita ad abbinare i prodotti: controlla la chiave o abbina a mano.";
    }
  } else if (daAI.length > 0 && !apiKey) {
    messaggioAI =
      "AI non attiva (manca ANTHROPIC_API_KEY): abbina a mano i prodotti non riconosciuti. Verranno memorizzati per la prossima volta.";
  }

  return NextResponse.json({ righe, ignorate, aiAttiva, messaggioAI });
}
