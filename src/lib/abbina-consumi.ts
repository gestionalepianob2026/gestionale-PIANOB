// Abbinamento dei soprannomi dei consumi ("san pell") ai prodotti del catalogo.
// Usato sia dalla pagina web (incolla messaggio) sia dal bot Telegram.
// Ordine: alias già imparati → abbinamento locale certo → AI (solo per il resto).

import { prisma } from "@/lib/prisma";
import { aiConfigurata, aiErrorMessage, generaJSON } from "@/lib/ai";
import {
  abbinaLocale,
  normalizzaTermine,
  preparaIndice,
  type RigaMessaggio,
} from "@/lib/consumi";

export type Fonte = "alias" | "diretto" | "ai" | "nessuno";

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

// Prompt statico (identico a ogni richiesta). Il catalogo va in un blocco
// separato, messo in cache: dalla seconda richiesta costa ~10%.
const SYSTEM = `Sei un assistente di un bar/ristorante italiano. I dipendenti scrivono i prodotti CONSUMATI nel turno con soprannomi, abbreviazioni o nomi storpiati (es. "san pell" = San Pellegrino, "kulmbaker" = Kulmbacher, "coca zero" = Coca Cola Zero, "lome" = limone/Lemonsoda, "cocha" = Coca Cola).

Ti vengono dati un CATALOGO numerato (riga: indice<TAB>prodotto) e un elenco numerato di TERMINI. Per ogni termine indica il prodotto del catalogo più probabile.
- "n" è il numero del termine nell'elenco; "idx" è l'indice del prodotto nel catalogo, oppure null se nessun prodotto è plausibile.
- "confidenza" da 0 a 1: alta solo se il prodotto è praticamente certo. Se più prodotti sono ugualmente plausibili (es. stessa bevanda in formati diversi) abbassa la confidenza.
- Non inventare indici fuori dal catalogo e rispondi per tutti i termini.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["risultati"],
  properties: {
    risultati: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "idx", "confidenza"],
        properties: {
          n: { type: "integer" },
          idx: { anyOf: [{ type: "integer" }, { type: "null" }] },
          confidenza: { type: "number" },
        },
      },
    },
  },
} as const;

export async function abbinaRighe(
  parsed: RigaMessaggio[],
): Promise<{ righe: RigaConsumo[]; aiAttiva: boolean; messaggioAI?: string }> {
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

  const assegna = (i: number, id: string, confidenza: number, fonte: Fonte) => {
    const p = prodById.get(id);
    if (!p) return;
    righe[i].productId = p.id;
    righe[i].prodotto = p.prodotto;
    righe[i].categoria = p.categoria;
    righe[i].confidenza = confidenza;
    righe[i].fonte = fonte;
  };

  // 1) alias appresi  2) abbinamento locale deterministico
  const indice = preparaIndice(prodotti);
  const daAI: number[] = [];
  righe.forEach((r, i) => {
    const pid = aliasMap.get(normalizzaTermine(r.termine));
    if (pid && prodById.has(pid)) return assegna(i, pid, 1, "alias");
    const m = abbinaLocale(r.termine, indice);
    if (m) return assegna(i, m.productId, m.score, "diretto");
    daAI.push(i);
  });

  // 3) AI solo per ciò che resta ambiguo
  let aiAttiva = false;
  let messaggioAI: string | undefined;

  if (daAI.length > 0 && aiConfigurata()) {
    try {
      const catalogo = prodotti.map((p, idx) => `${idx}\t${p.prodotto}`).join("\n");
      // termini unici (stesso soprannome ripetuto = una sola domanda)
      const termini: string[] = [];
      const posizione = new Map<string, number>(); // termine normalizzato → n (1-based)
      for (const i of daAI) {
        const k = normalizzaTermine(righe[i].termine);
        if (!posizione.has(k)) {
          termini.push(righe[i].termine);
          posizione.set(k, termini.length);
        }
      }

      const out = await generaJSON({
        uso: "consumi",
        system: SYSTEM,
        contestoStabile: `CATALOGO:\n${catalogo}`,
        parti: [
          {
            tipo: "testo",
            testo: `TERMINI da abbinare:\n${termini.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
          },
        ],
        schema: SCHEMA as unknown as Record<string, unknown>,
        nomeSchema: "abbinamenti",
        maxTokens: 4000,
        sforzo: "low",
      });
      if (out.esito !== "ok") throw new Error("risposta AI non utilizzabile");

      const parsedAI = JSON.parse(out.testo) as {
        risultati?: { n?: number; idx?: number | null; confidenza?: number }[];
      };

      const perN = new Map<number, { idx: number; conf: number }>();
      for (const r of parsedAI.risultati ?? []) {
        if (typeof r.n !== "number" || typeof r.idx !== "number") continue;
        if (r.idx < 0 || r.idx >= prodotti.length) continue;
        perN.set(r.n, { idx: r.idx, conf: Math.min(1, Math.max(0, Number(r.confidenza) || 0)) });
      }
      for (const i of daAI) {
        const n = posizione.get(normalizzaTermine(righe[i].termine));
        const res = n ? perN.get(n) : undefined;
        // anche i suggerimenti deboli vengono proposti (restano da confermare)
        if (res) assegna(i, prodotti[res.idx].id, res.conf, "ai");
      }
      aiAttiva = true;
    } catch (e) {
      console.error("consumi parse AI error", e);
      messaggioAI = `${aiErrorMessage(e).message} Abbina a mano i prodotti non riconosciuti.`;
    }
  } else if (daAI.length > 0) {
    messaggioAI =
      "AI non attiva (manca la chiave API): abbina a mano i prodotti non riconosciuti. Verranno memorizzati per la prossima volta.";
  }

  return { righe, aiAttiva, messaggioAI };
}
