import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";

export const maxDuration = 120;

// Identificativi del locale (il CLIENTE): non vanno mai confusi col fornitore
// né estratti come prodotto.
const CLIENTE = ["MORNINBAR", "PIANO B", "MORNIN BAR"];

const SYSTEM = `Sei un assistente esperto che legge documenti commerciali italiani (bolle di consegna, DDT, fatture immediate e accompagnatorie) ricevuti da un bar/ristorante e ne estrae i dati in JSON.

IMPORTANTE SULL'IMMAGINE:
- La foto è spesso RUOTATA (di 90°, 180° o 270°) o storta: leggi comunque il testo in qualsiasi orientamento.
- Può essere poco nitida: fai del tuo meglio, ma non inventare dati.

Restituisci ESCLUSIVAMENTE un oggetto JSON valido, senza testo prima o dopo, con questa forma:
{
  "numero": string | null,        // numero del documento (es. "N. doc 10037", "n° 3522")
  "fornitore": string | null,     // ragione sociale del FORNITORE (mittente in intestazione/logo)
  "data": string | null,          // data del documento in formato YYYY-MM-DD
  "righe": [
    {
      "prodotto": string,         // descrizione dell'articolo, ripulita
      "categoria": string,        // vedi elenco categorie sotto
      "fornitore": string | null, // di norma uguale al fornitore del documento
      "prezzoUnit": number,       // PREZZO UNITARIO NETTO (imponibile, senza IVA), in euro
      "ivaRate": number,          // aliquota IVA della riga in % (4, 5, 10 o 22)
      "quantita": number          // quantità/colli/pezzi della riga
    }
  ]
}

TIPI DI DOCUMENTO CHE PUOI RICEVERE:
1. Foto di un DDT/fattura cartacea (spesso ruotata).
2. Buono di consegna SCRITTO A MANO: spesso senza fornitore stampato, intestato "A: PIANO B", con righe tipo "6 KG OLIVE VERDI  6x6,00  36,00" (quantità × prezzo unitario = totale) e SENZA IVA. In questi casi: quantita = il primo numero (es. 6), prezzoUnit = il prezzo unitario (es. 6.00), fornitore = null, e stima l'IVA dalla categoria.
3. Fattura elettronica in PDF (es. da fattureincloud): ha i blocchi "Cedente/prestatore (fornitore)" e "Cessionario/committente (cliente)".

CHI È IL FORNITORE:
- Il fornitore è il MITTENTE / "Cedente/prestatore": la ragione sociale (Denominazione) in intestazione o nel blocco cedente.
- Il "Cessionario/committente" / DESTINATARIO è il bar e NON è il fornitore: ignora qualsiasi riferimento a ${CLIENTE.map((c) => `"${c}"`).join(", ")} e relativi indirizzi (Altamura, Piazza Duomo, Viale/Viale Regina Margherita). Non creare righe prodotto da questi dati.
- Se il documento non riporta alcun fornitore (tipico dei buoni a mano), usa null.

COLONNE TIPICHE: Codice | Descrizione | Lotto | U.M. (PZ, CT, CF, BT, BAL, KG, NR) | Quantità | Prezzo | Sconti | Importo/Totale | C.I o Cod.IVA.
- "prezzoUnit" = colonna "Prezzo" (prezzo unitario netto). Se manca ma ci sono "Importo/Totale" riga e "Quantità": prezzoUnit = importo / quantità.
- Se c'è uno sconto in percentuale/valore sul prezzo, applicalo per ottenere il netto effettivo. Ignora invece gli "sconti merce" (omaggi).
- "quantita" = colonna "Quantità" (può avere decimali, es. 4.000 = 4).

IVA:
- Spesso c'è una colonna con un CODICE IVA (es. "C.I", "Cod. I.V.A.") che rimanda a una tabella riepilogo in fondo che associa il codice all'aliquota % (es. 4→4%, 5→5%, 10→10%, 22→22%). Usa quell'aliquota.
- Se non è determinabile, stima per tipo merce: alcolici e bevande = 22; alimentari/surgelati/salumi/latticini/pane = 10; ortofrutta fresca = 4.

CATEGORIE (scegli la più adatta):
- Vini; Bollicine/spumanti → "Vini".
- Birra → "Birra".
- Distillati e amari: "Gin", "Rum", "Whisky", "Vodka", "Tequila", "Mezcal", "Cognac", "Brandy", "Grappa", "Pisco", "Amaro", "Liquore", "Vermouth", "Aperitivo", "Bitter".
- Acqua, bibite, coca cola, succhi, tonica, sciroppi → "Bevande".
- Cibo (surgelati, salumi, formaggi/latticini, pane, ortofrutta, frutta secca, olive, ecc.) → "Alimenti".
- Detersivi, carta, prodotti per la pulizia e consumabili non alimentari → "Pulizia".
- Attrezzatura e materiale non di consumo (bicchieri, calici, posate, attrezzi) → "Altro".
- Se davvero incerto → "Altro".

RIGHE DA ESCLUDERE SEMPRE (non sono articoli da inserire):
- "Accisa", imposte, bolli.
- Contributo ambientale CONAI, spese di trasporto/incasso, arrotondamenti.
- Righe con prezzo o totale NEGATIVO (resi, note di accredito, "RIF.AMM. escluse", sconti separati).
- Sotto-intestazioni come "DDT ... del ..." che non sono prodotti.
- Totali, imponibili, riepiloghi IVA, IBAN, dati di pagamento, note e condizioni di vendita.

REGOLE FINALI:
- Usa il punto come separatore decimale (es. 12.40).
- Una riga prodotto valida ha sempre una descrizione e una quantità positiva.
- Non inventare righe non presenti. Se un campo non è leggibile usa null (o 0 per i numeri) ma includi comunque la riga se l'articolo esiste davvero.`;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Nessun JSON nella risposta");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Scansione AI non ancora attiva: inserisci la chiave ANTHROPIC_API_KEY nel file .env per abilitarla.",
        code: "NO_API_KEY",
      },
      { status: 503 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Nessun file ricevuto" },
      { status: 400 },
    );
  }

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  const allowedImages = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  // Blocco documento (PDF) o immagine a seconda del file caricato
  const docBlock: Anthropic.ContentBlockParam = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: (allowedImages.includes(file.type)
            ? file.type
            : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: base64,
        },
      };

  const client = new Anthropic({ apiKey });

  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            docBlock,
            {
              type: "text",
              text: "Leggi questo documento (può essere una foto ruotata/storta, un buono scritto a mano o una fattura elettronica in PDF) ed estrai i dati nel formato JSON richiesto. Ricorda: il fornitore è il mittente/cedente, non il bar destinatario.",
            },
          ],
        },
      ],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const parsed = extractJson(text) as {
      numero?: string | null;
      fornitore?: string | null;
      data?: string | null;
      righe?: unknown[];
    };

    const righe = Array.isArray(parsed.righe)
      ? parsed.righe.map((r) => {
          const x = r as Record<string, unknown>;
          return {
            prodotto: String(x.prodotto ?? "").trim(),
            categoria: String(x.categoria ?? "Altro").trim() || "Altro",
            fornitore:
              x.fornitore != null && String(x.fornitore).trim()
                ? String(x.fornitore).trim()
                : (parsed.fornitore ?? null),
            prezzoUnit: Number(x.prezzoUnit) || 0,
            ivaRate: Number(x.ivaRate) || 22,
            quantita: Number(x.quantita) || 0,
          };
        })
      : [];

    return NextResponse.json({
      numero: parsed.numero ?? null,
      fornitore: parsed.fornitore ?? null,
      data: parsed.data ?? null,
      righe,
    });
  } catch (e) {
    console.error("scan error", e);
    return NextResponse.json(
      { error: "Non sono riuscito a leggere la bolla. Riprova con una foto più nitida." },
      { status: 502 },
    );
  }
}
