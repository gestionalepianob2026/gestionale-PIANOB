// Lettura e normalizzazione dei documenti d'acquisto (bolle, DDT, fatture).
// Contiene: schema/prompt per l'AI, parser deterministico della fattura
// elettronica XML (FatturaPA, gratis e preciso), conversione dei fogli Excel in
// testo e i controlli di coerenza sui numeri estratti.

import { normalizzaTermine } from "@/lib/consumi";

// Il locale è il CLIENTE: mai come fornitore né come prodotto.
const CLIENTE = ["MORNINBAR", "MORNIN BAR", "PIANO B"];

export type RigaEstratta = {
  descrizione: string;
  categoria: string;
  um: string | null;
  quantita: number;
  prezzoUnit: number; // netto IVA, per unità
  ivaRate: number;
  fornitore: string | null;
  dubbia: boolean;
  nota: string | null;
};

export type DocumentoEstratto = {
  numero: string | null;
  fornitore: string | null;
  data: string | null; // YYYY-MM-DD
  tipoDocumento: string;
  totaleImponibile: number | null;
  righe: RigaEstratta[];
  avvisi: string[];
};

// --- Schema JSON per l'output strutturato dell'AI ---------------------------

const nullable = (t: string) => ({ anyOf: [{ type: t }, { type: "null" }] });

export const BOLLA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "numero",
    "fornitore",
    "data",
    "tipoDocumento",
    "totaleImponibile",
    "righe",
    "note",
  ],
  properties: {
    numero: nullable("string"),
    fornitore: nullable("string"),
    data: nullable("string"),
    tipoDocumento: {
      type: "string",
      enum: ["ddt", "fattura", "scontrino", "buono_manuale", "altro"],
    },
    totaleImponibile: nullable("number"),
    note: nullable("string"),
    righe: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "descrizione",
          "categoria",
          "um",
          "quantita",
          "prezzoUnit",
          "importoRiga",
          "ivaRate",
          "dubbia",
          "nota",
        ],
        properties: {
          descrizione: { type: "string" },
          categoria: { type: "string" },
          um: nullable("string"),
          quantita: { type: "number" },
          prezzoUnit: nullable("number"),
          importoRiga: nullable("number"),
          ivaRate: nullable("number"),
          dubbia: { type: "boolean" },
          nota: nullable("string"),
        },
      },
    },
  },
} as const;

// Prompt STATICO (identico a ogni richiesta → sfrutta il prompt caching).
// Le parti variabili (categorie in uso) vanno nel messaggio utente.
export const SYSTEM_BOLLA = `Sei un assistente esperto nella lettura di documenti commerciali italiani ricevuti da un bar/ristorante: bolle di consegna, DDT, fatture, scontrini, buoni di consegna SCRITTI A MANO, fogli Excel/CSV dei fornitori. Estrai i dati nello schema richiesto.

REGOLE GENERALI
- Non inventare mai righe, quantità o prezzi. Se un valore non è leggibile usa null (per i numeri opzionali) e metti dubbia=true con una nota breve su cosa non si legge.
- Usa il punto come separatore decimale. Le quantità possono avere decimali (es. 2,5 kg → 2.5).
- Se ricevi più immagini/pagine sono lo STESSO documento: unisci le righe in un unico elenco senza duplicarle (le righe ripetute in fondo a una pagina e all'inizio della successiva sono la stessa riga).
- Le foto sono spesso ruotate (90°/180°/270°), storte, ombreggiate o con riflessi: leggi comunque il testo in qualsiasi orientamento.

CHI È IL FORNITORE
- È il MITTENTE / "Cedente/prestatore": ragione sociale in intestazione, logo o timbro. Il DESTINATARIO ("Cessionario/committente", "Spett.le", "A:") è il bar e NON è il fornitore: ignora ${CLIENTE.map((c) => `"${c}"`).join(", ")} e i relativi indirizzi (Altamura, Piazza Duomo, Viale Regina Margherita). Mai creare righe da questi dati.
- Se il documento non riporta un fornitore (tipico dei buoni a mano) usa null.

TIPI DI DOCUMENTO
1. DDT / fattura stampata: colonne tipiche Codice | Descrizione | Lotto | U.M. (PZ, CT, CF, BT, BAL, KG, LT, NR) | Quantità | Prezzo | Sconti | Importo | Cod.IVA.
2. Buono di consegna SCRITTO A MANO (tipoDocumento="buono_manuale"): righe tipo "6 KG olive verdi 6x6,00 = 36,00", formato quantità × prezzo = totale, di solito SENZA IVA e senza fornitore stampato. Ambiguità frequenti nella grafia a mano: 1/7, 4/9, 0/6, 5/S, virgola/punto, "x" usata come moltiplicazione. Ricontrolla sempre che quantità × prezzo = importo: se i tre numeri sono coerenti sei quasi certo della lettura; se non lo sono, scegli la lettura che li rende coerenti, oppure segna dubbia=true.
3. Fattura elettronica PDF (fattureincloud, ecc.): blocchi "Cedente/prestatore" e "Cessionario/committente".
4. Foglio Excel/CSV di listino o conferma d'ordine: ogni riga con prodotto e quantità è una riga; ignora intestazioni, righe vuote e totali.

NUMERI
- prezzoUnit = prezzo unitario NETTO (imponibile, senza IVA) PER LA STESSA UNITÀ della quantità. Se c'è uno sconto % o in valore sul prezzo, applicalo per ottenere il netto effettivo; ignora gli "sconti merce" (omaggi).
- importoRiga = importo netto della riga così come stampato (colonna Importo/Totale), se presente. Serve a verificare prezzo e quantità: riportalo sempre quando c'è.
- Se manca il prezzo unitario ma ci sono importo e quantità: prezzoUnit = importoRiga / quantita.
- quantita = numero di unità acquistate nell'unità di misura della riga (es. 4 cartoni → 4; 12 bottiglie → 12). Metti in "um" l'unità scritta (PZ, CT, KG, BT, LT...). Se la descrizione dichiara il contenuto della confezione (es. "CT 6x75cl", "24 bt") e l'unità è un collo, NON convertire: segnalalo in "nota" (es. "cartone da 6 bottiglie").
- ivaRate = aliquota della riga (0, 4, 5, 10 o 22). Spesso la riga ha solo un CODICE IVA da mettere in corrispondenza con la tabella riepilogo in fondo: usa l'aliquota %. Se non determinabile, stima: alcolici e bevande 22; alimentari trasformati, surgelati, salumi, latticini, pane 10; ortofrutta fresca 4; se il documento è un buono a mano senza IVA stima dalla merce.
- totaleImponibile = imponibile totale del documento (somma delle righe prima dell'IVA) se stampato, altrimenti null. Serve a controllare di non aver perso righe.

CATEGORIE (scegli la più adatta; preferisci le categorie già in uso indicate nel messaggio)
Vini (incluse bollicine/spumanti/champagne), Birra, distillati e amari (Gin, Rum, Whisky, Vodka, Tequila, Mezcal, Cognac, Brandy, Grappa, Pisco, Amaro, Liquore, Vermouth, Aperitivo, Bitter), Bevande (acqua, bibite, succhi, toniche, sciroppi), Alimenti (cibo di ogni tipo), Pulizia (detersivi, carta, consumabili non alimentari), Altro (attrezzatura, bicchieri, non classificabile).

DA ESCLUDERE SEMPRE (non sono articoli)
- Accisa, imposte, bolli, contributo CONAI/ambientale, spese di trasporto/incasso/imballo addebitate, arrotondamenti, sconti/abbuoni separati, resi e note di credito (righe con importo negativo).
- Sotto-intestazioni tipo "DDT n. … del …", totali, imponibili, riepiloghi IVA, IBAN, condizioni di pagamento e di vendita.

CAMPO "note" (a livello documento): usalo solo per segnalare problemi concreti (pagina tagliata, parte illeggibile, documento che sembra una nota di credito, più documenti diversi nella stessa foto). Altrimenti null.

descrizione = nome dell'articolo ripulito (senza codici interni, senza lotto), nel modo in cui un barista lo riconoscerebbe.`;

// --- Normalizzazione e controlli di coerenza --------------------------------

const ESCLUDI =
  /^(accisa|conai|contributo|spese\b|trasporto|spedizione|bollo|arrotondament|sconto|abbuono|totale|imponibile|iva\b|ddt\b|rif\.?\s*amm|reso|nota di credito)/i;

const IVA_VALIDE = [0, 4, 5, 10, 22];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function txt(v: unknown, max = 200): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

/** Categoria "probabile" dalla descrizione, per i documenti letti senza AI. */
export function indovinaCategoria(desc: string): string {
  const d = desc.toLowerCase();
  const regole: [RegExp, string][] = [
    [/\b(birra|lager|ipa|pils|weiss|stout)\b/, "Birra"],
    [/\bgin\b/, "Gin"],
    [/\brum\b/, "Rum"],
    [/\b(whisky|whiskey|bourbon|scotch)\b/, "Whisky"],
    [/\bvodka\b/, "Vodka"],
    [/\b(tequila|mezcal)\b/, "Tequila"],
    [/\b(cognac|brandy)\b/, "Cognac"],
    [/\bgrappa\b/, "Grappa"],
    [/\b(amaro|bitter)\b/, "Amaro"],
    [/\b(liquore|limoncello|amaretto|sambuca)\b/, "Liquore"],
    [/\b(vermouth|vermut|aperol|campari|spritz)\b/, "Aperitivo"],
    [/\b(vino|prosecco|champagne|spumante|franciacorta|chardonnay|primitivo|negroamaro|merlot|rosso|bianco|rosato|brut|doc|docg|igt)\b/, "Vini"],
    [/\b(acqua|coca|cola|fanta|sprite|aranciata|limonata|chinotto|succo|tonica|tonic|ginger|bibita|redbull|red bull|schweppes|sanpellegrino|san pellegrino)\b/, "Bevande"],
    [/\b(detersiv|sgrassat|igienizz|carta|tovagli|sacchett|guanti|pellicola|alluminio|sapone|spugn|cannucce|bicchieri monouso)\b/, "Pulizia"],
    [/\b(calice|calici|posate|shaker|strainer|bicchiere)\b/, "Altro"],
  ];
  for (const [re, cat] of regole) if (re.test(d)) return cat;
  return "Alimenti";
}

function ivaDefault(categoria: string): number {
  return /^alimenti$/i.test(categoria) ? 10 : 22;
}

function allineaCategoria(cat: string | null, esistenti: string[]): string {
  const c = (cat ?? "").trim();
  if (!c) return "Altro";
  const n = normalizzaTermine(c);
  const trovata = esistenti.find((e) => normalizzaTermine(e) === n);
  return trovata ?? c.charAt(0).toUpperCase() + c.slice(1);
}

type RigaGrezza = {
  descrizione?: unknown;
  categoria?: unknown;
  um?: unknown;
  quantita?: unknown;
  prezzoUnit?: unknown;
  importoRiga?: unknown;
  ivaRate?: unknown;
  fornitore?: unknown;
  dubbia?: unknown;
  nota?: unknown;
};

type DocGrezzo = {
  numero?: unknown;
  fornitore?: unknown;
  data?: unknown;
  tipoDocumento?: unknown;
  totaleImponibile?: unknown;
  note?: unknown;
  righe?: unknown;
};

/**
 * Pulisce l'output (dell'AI o dei parser deterministici): scarta righe non
 * valide, recupera i prezzi mancanti, verifica quantità × prezzo = importo e la
 * somma delle righe contro l'imponibile, e produce gli avvisi per l'utente.
 */
export function normalizzaDocumento(
  grezzo: DocGrezzo,
  categorieEsistenti: string[] = [],
): DocumentoEstratto {
  const avvisi: string[] = [];
  const fornitoreDoc = txt(grezzo.fornitore, 120);
  const clienteRe = new RegExp(CLIENTE.map((c) => c.replace(/\s/g, "\\s*")).join("|"), "i");
  const fornitore = fornitoreDoc && !clienteRe.test(fornitoreDoc) ? fornitoreDoc : null;
  if (fornitoreDoc && !fornitore)
    avvisi.push("Il fornitore letto era il nome del locale: l'ho lasciato vuoto.");

  // data
  let data: string | null = null;
  const dRaw = txt(grezzo.data, 30);
  if (dRaw) {
    const m = dRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`) : null;
    if (d && !Number.isNaN(d.getTime())) {
      const adesso = Date.now();
      if (d.getTime() > adesso + 2 * 86400_000)
        avvisi.push(`La data letta (${m![0]}) è nel futuro: controllala.`);
      else if (d.getTime() < adesso - 2 * 365 * 86400_000)
        avvisi.push(`La data letta (${m![0]}) è vecchia di oltre 2 anni: controllala.`);
      data = m![0];
    }
  }

  const righe: RigaEstratta[] = [];
  const viste = new Set<string>();
  let scartate = 0;
  const lista = Array.isArray(grezzo.righe) ? (grezzo.righe as RigaGrezza[]) : [];

  for (const r of lista.slice(0, 300)) {
    const descrizione = txt(r.descrizione, 160);
    const quantita = num(r.quantita);
    if (!descrizione || quantita === null || quantita <= 0) {
      if (descrizione) scartate++;
      continue;
    }
    if (ESCLUDI.test(descrizione)) continue;
    if (clienteRe.test(descrizione)) continue;

    let dubbia = r.dubbia === true;
    const note: string[] = [];
    const notaAI = txt(r.nota, 160);
    if (notaAI) note.push(notaAI);

    let prezzo = num(r.prezzoUnit);
    const importo = num(r.importoRiga);
    if (importo !== null && importo < 0) continue; // resi / note di credito

    if ((prezzo === null || prezzo <= 0) && importo !== null && importo > 0) {
      prezzo = importo / quantita;
    } else if (prezzo !== null && prezzo > 0 && importo !== null && importo > 0) {
      const atteso = prezzo * quantita;
      const scarto = Math.abs(atteso - importo);
      if (scarto > Math.max(0.06, importo * 0.03)) {
        // Con uno sconto riga l'importo stampato è il netto reale: più affidabile.
        prezzo = importo / quantita;
        dubbia = true;
        note.push("Quantità × prezzo non tornava con l'importo: prezzo ricalcolato dall'importo, controlla.");
      }
    }
    if (prezzo === null || prezzo < 0) {
      prezzo = 0;
      dubbia = true;
      note.push("Prezzo non leggibile.");
    }
    if (prezzo > 5000 || quantita > 5000) {
      dubbia = true;
      note.push("Valore insolitamente alto: controlla.");
    }

    const categoria = allineaCategoria(
      txt(r.categoria, 40) ?? indovinaCategoria(descrizione),
      categorieEsistenti,
    );
    let iva = num(r.ivaRate);
    if (iva === null || !IVA_VALIDE.includes(iva)) iva = ivaDefault(categoria);

    // riga identica già vista (stessa descrizione, quantità e prezzo) → probabile doppione
    const chiave = `${normalizzaTermine(descrizione)}|${quantita}|${prezzo.toFixed(2)}`;
    if (viste.has(chiave)) {
      dubbia = true;
      note.push("Riga identica a un'altra: forse è un doppione.");
    }
    viste.add(chiave);

    righe.push({
      descrizione,
      categoria,
      um: txt(r.um, 12)?.toUpperCase() ?? null,
      quantita: Math.round(quantita * 1000) / 1000,
      prezzoUnit: Math.round(prezzo * 10000) / 10000,
      ivaRate: iva,
      fornitore: txt(r.fornitore, 120) ?? fornitore,
      dubbia,
      nota: note.length ? note.join(" ").slice(0, 240) : null,
    });
  }

  if (scartate > 0)
    avvisi.push(`${scartate} righe scartate perché senza quantità valida.`);

  // Controllo: la somma delle righe deve tornare con l'imponibile del documento.
  const imponibile = num(grezzo.totaleImponibile);
  if (imponibile !== null && imponibile > 0 && righe.length > 0) {
    const somma = righe.reduce((s, r) => s + r.quantita * r.prezzoUnit, 0);
    if (Math.abs(somma - imponibile) > Math.max(0.5, imponibile * 0.03))
      avvisi.push(
        `La somma delle righe (${somma.toFixed(2)} €) non corrisponde all'imponibile del documento (${imponibile.toFixed(2)} €): controlla se manca qualche riga o c'è un prezzo sbagliato.`,
      );
  }

  const noteDoc = txt(grezzo.note, 300);
  if (noteDoc) avvisi.push(noteDoc);
  if (righe.length === 0 && avvisi.length === 0)
    avvisi.push("Non ho trovato righe di prodotto in questo documento.");

  return {
    numero: txt(grezzo.numero, 40),
    fornitore,
    data,
    tipoDocumento: txt(grezzo.tipoDocumento, 20) ?? "altro",
    totaleImponibile: imponibile,
    righe,
    avvisi,
  };
}

// --- Fattura elettronica XML (FatturaPA) ------------------------------------
// Formato strutturato: si legge senza AI (gratis, istantaneo, preciso al centesimo).

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function tag(blocco: string, nome: string): string | null {
  const m = blocco.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`));
  return m ? decodeXml(m[1].trim()) : null;
}

/** Ritorna null se il testo non è una fattura elettronica leggibile. */
export function leggiFatturaXml(testo: string): DocumentoEstratto | null {
  // Supporta anche i .p7m (firmati): l'XML è incorporato in chiaro.
  const m = testo.match(/<([\w.-]+:)?FatturaElettronica[\s\S]*<\/([\w.-]+:)?FatturaElettronica>/);
  if (!m) return null;
  const xml = m[0].replace(/<(\/?)[\w.-]+:/g, "<$1");

  const cedente = (xml.match(/<CedentePrestatore>([\s\S]*?)<\/CedentePrestatore>/) ?? [])[1] ?? "";
  let fornitore = tag(cedente, "Denominazione");
  if (!fornitore) {
    const nome = tag(cedente, "Nome");
    const cognome = tag(cedente, "Cognome");
    fornitore = [nome, cognome].filter(Boolean).join(" ") || null;
  }

  const generali = (xml.match(/<DatiGeneraliDocumento>([\s\S]*?)<\/DatiGeneraliDocumento>/) ?? [])[1] ?? "";
  const tipo = tag(generali, "TipoDocumento");
  const avvisi: string[] = [];
  if (tipo === "TD04" || tipo === "TD05") {
    return {
      numero: tag(generali, "Numero"),
      fornitore,
      data: tag(generali, "Data"),
      tipoDocumento: "altro",
      totaleImponibile: null,
      righe: [],
      avvisi: ["Questa è una NOTA DI CREDITO/DEBITO: non carica merce in magazzino."],
    };
  }

  const righe: RigaGrezza[] = [];
  const linee = xml.match(/<DettaglioLinee>[\s\S]*?<\/DettaglioLinee>/g) ?? [];
  for (const l of linee) {
    const descrizione = tag(l, "Descrizione");
    const q = num(tag(l, "Quantita"));
    const unitario = num(tag(l, "PrezzoUnitario"));
    const totale = num(tag(l, "PrezzoTotale"));
    const iva = num(tag(l, "AliquotaIVA"));
    const quantita = q !== null && q > 0 ? q : totale !== null && totale > 0 ? 1 : null;
    if (!descrizione || quantita === null) continue;
    righe.push({
      descrizione,
      um: tag(l, "UnitaMisura"),
      quantita,
      // Nell'XML il PrezzoTotale è già al netto degli sconti di riga: il netto
      // unitario effettivo è totale / quantità (lo sconto non è un'anomalia).
      // PrezzoTotale = 0 con prezzo unitario > 0: merce in omaggio, non a prezzo pieno.
      prezzoUnit: totale !== null && totale > 0 ? totale / quantita : totale === 0 ? 0 : unitario,
      // importo negativo (riga di sconto/abbuono) → normalizzaDocumento la scarta
      importoRiga: totale !== null && totale !== 0 ? totale : null,
      ivaRate: iva,
      categoria: indovinaCategoria(descrizione),
      dubbia: false,
      nota: null,
    });
  }

  // imponibile totale dal riepilogo IVA
  let imponibile = 0;
  for (const r of xml.match(/<DatiRiepilogo>[\s\S]*?<\/DatiRiepilogo>/g) ?? [])
    imponibile += num(tag(r, "ImponibileImporto")) ?? 0;

  const doc = normalizzaDocumento({
    numero: tag(generali, "Numero"),
    fornitore,
    data: tag(generali, "Data"),
    tipoDocumento: "fattura",
    totaleImponibile: imponibile > 0 ? imponibile : null,
    righe,
    note: null,
  });
  doc.avvisi.push(...avvisi);
  return doc;
}

// --- Fogli Excel / CSV → testo per l'AI --------------------------------------

/** Converte un foglio (matrice di celle) in righe TSV compatte. */
export function foglioATesto(nome: string, dati: unknown[][]): string {
  const righe: string[] = [];
  for (const riga of dati.slice(0, 600)) {
    const celle = riga.slice(0, 40).map((c) => {
      if (c === null || c === undefined) return "";
      if (c instanceof Date) return c.toISOString().slice(0, 10);
      return String(c).replace(/[\t\r\n]+/g, " ").trim();
    });
    if (celle.every((c) => !c)) continue;
    // toglie le celle vuote in coda
    while (celle.length && !celle[celle.length - 1]) celle.pop();
    righe.push(celle.join("\t"));
  }
  return `### Foglio "${nome}"\n${righe.join("\n")}`;
}
