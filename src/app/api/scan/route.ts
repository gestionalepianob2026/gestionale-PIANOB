import { NextResponse } from "next/server";
import readExcelFile from "read-excel-file/node";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { aiConfigurata, aiErrorMessage, generaJSON, type Parte } from "@/lib/ai";
import {
  BOLLA_SCHEMA,
  SYSTEM_BOLLA,
  foglioATesto,
  leggiFatturaXml,
  normalizzaDocumento,
  type DocumentoEstratto,
} from "@/lib/bolla";
import {
  abbinaLocale,
  candidatiCatalogo,
  normalizzaTermine,
  preparaIndice,
} from "@/lib/consumi";
import { caricaFornitori, risolviFornitore } from "@/lib/fornitori";

export const maxDuration = 120;

const MAX_FILES = 6;
const MAX_BYTES = 20 * 1024 * 1024; // per file
const MAX_IMG_BYTES = 4_800_000; // l'API Anthropic accetta immagini fino a 5 MB
const MAX_TEXT = 80_000; // caratteri di testo (Excel/CSV) inviati all'AI

type Kind = "pdf" | "image" | "xlsx" | "xls" | "xml" | "text" | "heic" | "altro";

function classifica(f: File): Kind {
  const nome = f.name.toLowerCase();
  const t = f.type.toLowerCase();
  if (t === "application/pdf" || nome.endsWith(".pdf")) return "pdf";
  if (/\.(heic|heif)$/.test(nome) || /heic|heif/.test(t)) return "heic";
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/.test(nome)) return "image";
  if (nome.endsWith(".xlsx") || t.includes("spreadsheetml")) return "xlsx";
  if (nome.endsWith(".xls") || t === "application/vnd.ms-excel") return "xls";
  if (nome.endsWith(".xml") || nome.endsWith(".p7m") || t.includes("xml")) return "xml";
  if (nome.endsWith(".csv") || nome.endsWith(".txt") || t.startsWith("text/")) return "text";
  return "altro";
}

function mediaTypeImmagine(buf: Buffer, dichiarato: string) {
  // riconosce il formato dai primi byte (il tipo dichiarato dal browser può mentire)
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png" as const;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg" as const;
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif" as const;
  if (buf.subarray(8, 12).toString() === "WEBP") return "image/webp" as const;
  if (dichiarato === "image/png") return "image/png" as const;
  return "image/jpeg" as const;
}

function decodificaTesto(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  // se compaiono caratteri di sostituzione il file è quasi certamente Latin-1 (Excel/IT)
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}

type RispostaRiga = {
  prodotto: string;
  categoria: string;
  um: string | null;
  quantita: number;
  prezzoUnit: number;
  ivaRate: number;
  fornitore: string | null;
  dubbia: boolean;
  nota: string | null;
  match: { id: string; prodotto: string; quantita: number; certo: boolean } | null;
  candidati: { id: string; prodotto: string; quantita: number }[];
};

/** Abbina ogni riga letta a un articolo già a catalogo (per caricare, non duplicare). */
async function abbinaAlCatalogo(doc: DocumentoEstratto): Promise<RispostaRiga[]> {
  const [prodotti, aliasRows] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, prodotto: true, quantita: true },
    }),
    prisma.alias.findMany({ select: { termine: true, productId: true } }),
  ]);
  const byId = new Map(prodotti.map((p) => [p.id, p]));
  const aliasMap = new Map(aliasRows.map((a) => [a.termine, a.productId]));
  const indice = preparaIndice(prodotti);

  return doc.righe.map((r) => {
    const norm = normalizzaTermine(r.descrizione);
    let match: RispostaRiga["match"] = null;

    // 1) abbinamento già imparato (alias) o nome identico
    const viaAlias = aliasMap.get(norm);
    const pAlias = viaAlias ? byId.get(viaAlias) : undefined;
    if (pAlias) {
      match = { id: pAlias.id, prodotto: pAlias.prodotto, quantita: pAlias.quantita, certo: true };
    } else {
      const esatto = indice.find((p) => p.norm === norm);
      if (esatto) {
        const p = byId.get(esatto.id)!;
        match = { id: p.id, prodotto: p.prodotto, quantita: p.quantita, certo: true };
      }
    }

    // 2) somiglianza: se c'è un vincitore netto lo propone (da confermare)
    const cand = candidatiCatalogo(r.descrizione, indice, 3);
    if (!match && cand.length > 0) {
      const [primo, secondo] = cand;
      const nettoVincitore = !secondo || primo.score - secondo.score >= 0.15;
      if (primo.score >= 0.8 && nettoVincitore) {
        const p = byId.get(primo.id)!;
        match = { id: p.id, prodotto: p.prodotto, quantita: p.quantita, certo: false };
      } else {
        const loc = abbinaLocale(r.descrizione, indice);
        if (loc) {
          const p = byId.get(loc.productId)!;
          match = { id: p.id, prodotto: p.prodotto, quantita: p.quantita, certo: false };
        }
      }
    }

    return {
      prodotto: r.descrizione,
      categoria: r.categoria,
      um: r.um,
      quantita: r.quantita,
      prezzoUnit: r.prezzoUnit,
      ivaRate: r.ivaRate,
      fornitore: r.fornitore,
      dubbia: r.dubbia,
      nota: r.nota,
      match,
      candidati: cand
        .filter((c) => c.id !== match?.id)
        .map((c) => {
          const p = byId.get(c.id)!;
          return { id: p.id, prodotto: p.prodotto, quantita: p.quantita };
        }),
    };
  });
}

/** Allinea i fornitori letti a quelli già in uso (Giesse = giesse = GIESSE). */
async function uniscaFornitori(doc: DocumentoEstratto) {
  const mappa = await caricaFornitori(prisma);
  doc.fornitore = risolviFornitore(mappa, doc.fornitore);
  for (const r of doc.righe) r.fornitore = risolviFornitore(mappa, r.fornitore) ?? doc.fornitore;
}

function rispondi(doc: DocumentoEstratto, righe: RispostaRiga[], fonte: "xml" | "ai") {
  return NextResponse.json({
    fonte,
    numero: doc.numero,
    fornitore: doc.fornitore,
    data: doc.data,
    tipoDocumento: doc.tipoDocumento,
    avvisi: doc.avvisi,
    righe,
  });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const files = [...(formData?.getAll("files") ?? []), ...(formData?.getAll("file") ?? [])].filter(
    (f): f is File => f instanceof File && f.size > 0,
  );
  if (files.length === 0)
    return NextResponse.json({ error: "Nessun file ricevuto" }, { status: 400 });
  if (files.length > MAX_FILES)
    return NextResponse.json(
      { error: `Puoi caricare al massimo ${MAX_FILES} file per volta.` },
      { status: 400 },
    );

  const letti: { file: File; kind: Kind; buf: Buffer }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES)
      return NextResponse.json(
        { error: `“${f.name}” è troppo grande (massimo 20 MB).` },
        { status: 413 },
      );
    const kind = classifica(f);
    if (kind === "heic")
      return NextResponse.json(
        { error: `“${f.name}”: il formato HEIC non è supportato. Scatta in JPG o usa “Più compatibile” nelle impostazioni foto.` },
        { status: 400 },
      );
    if (kind === "xls")
      return NextResponse.json(
        { error: `“${f.name}”: il vecchio formato .xls non è leggibile. Salvalo come .xlsx (o CSV) e riprova.` },
        { status: 400 },
      );
    if (kind === "altro")
      return NextResponse.json(
        { error: `“${f.name}”: formato non supportato. Usa foto (JPG/PNG), PDF, Excel (.xlsx), CSV o fattura XML.` },
        { status: 400 },
      );
    const buf = Buffer.from(await f.arrayBuffer());
    if (kind === "image" && buf.length > MAX_IMG_BYTES)
      return NextResponse.json(
        { error: `“${f.name}”: immagine troppo pesante (oltre 5 MB). Riprova: l'app la riduce da sola dal telefono.` },
        { status: 413 },
      );
    letti.push({ file: f, kind, buf });
  }

  const categorie = (
    await prisma.product.findMany({
      distinct: ["categoria"],
      select: { categoria: true },
      orderBy: { categoria: "asc" },
    })
  ).map((c) => c.categoria);

  // Fattura elettronica XML da sola: lettura deterministica, senza AI.
  if (letti.length === 1 && letti[0].kind === "xml") {
    const doc = leggiFatturaXml(decodificaTesto(letti[0].buf));
    if (doc) {
      doc.righe.forEach((r) => (r.categoria = categorie.find((c) => normalizzaTermine(c) === normalizzaTermine(r.categoria)) ?? r.categoria));
      await uniscaFornitori(doc);
      return rispondi(doc, await abbinaAlCatalogo(doc), "xml");
    }
    // XML non riconosciuto come FatturaPA: proseguo con l'AI sul testo.
  }

  if (!aiConfigurata()) {
    return NextResponse.json(
      {
        error:
          "Scansione AI non ancora attiva: inserisci la chiave dell'AI (OPENAI_API_KEY o ANTHROPIC_API_KEY) nelle impostazioni del server. Intanto puoi caricare fatture XML o inserire le righe a mano.",
        code: "NO_API_KEY",
      },
      { status: 503 },
    );
  }

  // Costruzione dei contenuti per l'AI (tutti i file = lo stesso documento).
  const parti: Parte[] = [];
  let haImmagini = false;
  let testoTotale = 0;
  for (const [i, { file, kind, buf }] of letti.entries()) {
    if (letti.length > 1)
      parti.push({ tipo: "testo", testo: `File ${i + 1} di ${letti.length}: ${file.name}` });
    if (kind === "pdf") {
      haImmagini = true;
      parti.push({ tipo: "pdf", nome: file.name, base64: buf.toString("base64") });
    } else if (kind === "image") {
      haImmagini = true;
      parti.push({
        tipo: "immagine",
        mediaType: mediaTypeImmagine(buf, file.type),
        base64: buf.toString("base64"),
      });
    } else if (kind === "xlsx") {
      try {
        const fogli = await readExcelFile(buf);
        for (const f of fogli) {
          const t = foglioATesto(f.sheet, f.data as unknown[][]);
          testoTotale += t.length;
          parti.push({ tipo: "testo", testo: t });
        }
      } catch {
        return NextResponse.json(
          { error: `“${file.name}”: non riesco ad aprire il file Excel (danneggiato o protetto da password).` },
          { status: 400 },
        );
      }
    } else {
      const t = decodificaTesto(buf).slice(0, MAX_TEXT);
      testoTotale += t.length;
      parti.push({ tipo: "testo", testo: `### ${file.name}\n${t}` });
    }
  }
  if (testoTotale > MAX_TEXT * 2)
    return NextResponse.json(
      { error: "I fogli sono troppo grandi: carica solo il foglio o le righe della consegna." },
      { status: 413 },
    );

  parti.push({
    tipo: "testo",
    testo:
      "Estrai i dati di questo documento (può essere una foto ruotata o scritta a mano, un PDF, una fattura o un foglio Excel). Il fornitore è il mittente/cedente, non il bar destinatario." +
      (categorie.length ? `\n\nCategorie già in uso nel magazzino (preferiscile): ${categorie.join(", ")}.` : ""),
  });

  try {
    // Grafie a mano e foto storte richiedono più ragionamento; i fogli di testo no.
    const out = await generaJSON({
      uso: "scan",
      system: SYSTEM_BOLLA,
      parti,
      schema: BOLLA_SCHEMA as unknown as Record<string, unknown>,
      nomeSchema: "documento_acquisto",
      maxTokens: 16000,
      sforzo: haImmagini ? "high" : "medium",
    });

    if (out.esito === "rifiutato")
      return NextResponse.json(
        { error: "L'AI ha rifiutato di leggere questo file. Prova con una foto diversa." },
        { status: 422 },
      );

    let parsed: Record<string, unknown>;
    try {
      if (out.esito === "troncato") throw new Error("troncato");
      parsed = JSON.parse(out.testo);
    } catch {
      // risposta tagliata (limite di lunghezza) o non valida
      return NextResponse.json(
        {
          error:
            out.esito === "troncato"
              ? "Il documento è molto lungo e la lettura è stata interrotta: caricalo a pezzi (poche pagine per volta)."
              : "Non sono riuscito a leggere la risposta dell'AI. Riprova.",
        },
        { status: 502 },
      );
    }

    const doc = normalizzaDocumento(parsed, categorie);
    await uniscaFornitori(doc);
    return rispondi(doc, await abbinaAlCatalogo(doc), "ai");
  } catch (e) {
    console.error("scan error", e);
    const { message, status } = aiErrorMessage(e);
    return NextResponse.json({ error: message }, { status });
  }
}
