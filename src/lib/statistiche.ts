// Calcolo delle statistiche del gestionale. Funzione pura (niente database):
// riceve articoli, movimenti e bolle e restituisce numeri pronti da mostrare.
//
// Definizioni (tutte a COSTO, IVA esclusa, usando il prezzo netto attuale):
//  - Consumo   = uscite per SCARICO (merce usata/venduta nei turni)
//  - Ammanco   = RETTIFICA in meno (conteggio fisico inferiore alla giacenza)
//  - Acquisti  = totale delle bolle registrate (IVA inclusa, come in fattura)

import { chiaveFornitore, risolviFornitore, type MappaFornitori } from "@/lib/fornitori";

const TZ = "Europe/Rome";
const GIORNO_MS = 86_400_000;

export type PeriodoKey = "7" | "30" | "90" | "365" | "tutto";
export const PERIODI: { key: PeriodoKey; label: string; giorni: number | null }[] = [
  { key: "7", label: "7 giorni", giorni: 7 },
  { key: "30", label: "30 giorni", giorni: 30 },
  { key: "90", label: "3 mesi", giorni: 90 },
  { key: "365", label: "12 mesi", giorni: 365 },
  { key: "tutto", label: "Tutto", giorni: null },
];

export type ProdottoIn = {
  id: string;
  prodotto: string;
  categoria: string;
  fornitore: string | null;
  prezzoUnit: number;
  ivaRate: number;
  quantita: number;
  sogliaMin: number;
  createdAt: Date;
};
export type MovimentoIn = {
  productId: string;
  tipo: string;
  quantita: number;
  qtaPrima: number;
  qtaDopo: number;
  createdAt: Date;
};
export type BollaIn = {
  numero: string | null;
  fornitore: string | null;
  data: Date | null;
  totale: number;
  createdAt: Date;
};

// --- date nel fuso di Roma (il server gira in UTC) ---------------------------
const fmtGiorno = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fmtDow = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
const DOW_IDX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function giornoRoma(d: Date): string {
  return fmtGiorno.format(d); // YYYY-MM-DD
}
export function dowRoma(d: Date): number {
  return DOW_IDX[fmtDow.format(d)] ?? 0;
}
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
function etichettaMese(chiave: string) {
  const [y, m] = chiave.split("-").map(Number);
  return `${MESI[m - 1]} ${String(y).slice(2)}`;
}
function etichettaGiorno(g: string) {
  const [, m, d] = g.split("-").map(Number);
  return `${d} ${MESI[m - 1]}`;
}

export type Serie = { label: string; consumo: number; acquisti: number };

export type RigaOrdine = {
  id: string;
  nome: string;
  categoria: string;
  giacenza: number;
  soglia: number;
  perGiorno: number;
  giorniCopertura: number | null;
  daOrdinare: number;
  costo: number;
};

export type Statistiche = {
  periodo: { key: PeriodoKey; label: string; giorni: number; precedente: boolean };
  kpi: {
    valoreMagazzino: number;
    valoreMagazzinoLordo: number;
    nArticoli: number;
    consumoValore: number;
    consumoValorePrec: number | null;
    consumoPezzi: number;
    acquisti: number;
    acquistiPrec: number | null;
    nBolle: number;
    coperturaGiorni: number | null;
    ammancoValore: number;
    ammancoPezzi: number;
  };
  serie: Serie[];
  topConsumo: {
    id: string;
    nome: string;
    categoria: string;
    pezzi: number;
    valore: number;
    variazione: number | null; // % rispetto al periodo precedente
  }[];
  consumoCategoria: { name: string; pezzi: number; valore: number; quota: number }[];
  giorniSettimana: number[]; // pezzi consumati, 0 = lunedì
  daOrdinare: {
    fornitore: string;
    righe: RigaOrdine[];
    costo: number;
  }[];
  inEsaurimento: RigaOrdine[];
  sottoSogliaInattivi: number; // sotto soglia ma mai movimentati: soglie da rivedere
  scorteFerme: { id: string; nome: string; categoria: string; valore: number; giorni: number }[];
  scorteFermeTotale: number;
  valoreCategoria: { name: string; valore: number; count: number; quota: number }[];
  concentrazioneTop10: number; // % del valore magazzino nei 10 articoli più "pesanti"
  topValore: { id: string; nome: string; categoria: string; valore: number }[];
  acquistiFornitore: { name: string; spesa: number; count: number; ultima: Date | null }[];
  ultimeBolle: { numero: string | null; fornitore: string | null; data: Date; totale: number }[];
  ammanchi: { id: string; nome: string; pezzi: number; valore: number }[];
  qualita: { senzaPrezzo: number; senzaFornitore: number; sogliaDefault: number };
  hasMovimenti: boolean;
  hasBolle: boolean;
};

const costoUnit = (p: { prezzoUnit: number }) => (Number.isFinite(p.prezzoUnit) ? p.prezzoUnit : 0);

export function calcolaStatistiche(args: {
  products: ProdottoIn[];
  movimenti: MovimentoIn[];
  bolle: BollaIn[];
  fornitori: MappaFornitori;
  periodo: PeriodoKey;
  now?: Date;
}): Statistiche {
  const now = args.now ?? new Date();
  const cfg = PERIODI.find((p) => p.key === args.periodo) ?? PERIODI[1];
  const prodById = new Map(args.products.map((p) => [p.id, p]));

  // Per "Tutto" il periodo parte dal primo movimento/bolla registrato.
  // (ciclo, non Math.min(...array): con decine di migliaia di movimenti lo spread va in errore)
  let primoDato = now.getTime();
  for (const m of args.movimenti) primoDato = Math.min(primoDato, m.createdAt.getTime());
  for (const b of args.bolle) primoDato = Math.min(primoDato, (b.data ?? b.createdAt).getTime());
  const giorni = cfg.giorni ?? Math.max(1, Math.ceil((now.getTime() - primoDato) / GIORNO_MS));
  const inizio = new Date(now.getTime() - giorni * GIORNO_MS);
  const inizioPrec = new Date(inizio.getTime() - giorni * GIORNO_MS);
  const hasPrec = cfg.giorni !== null;

  // --- Movimenti: consumo, ammanchi, per prodotto, per periodo ---------------
  let consumoPezzi = 0;
  let consumoValore = 0;
  let consumoValorePrec = 0;
  let ammancoPezzi = 0;
  let ammancoValore = 0;
  const perProdotto = new Map<string, { pezzi: number; pezziPrec: number; valore: number }>();
  const perProdotto60 = new Map<string, number>(); // consumo ultimi 60 gg (per riordino)
  const ultimoScarico = new Map<string, Date>();
  const perCategoria = new Map<string, { pezzi: number; valore: number }>();
  const dow = new Array(7).fill(0) as number[];
  const ammanchiMap = new Map<string, { pezzi: number; valore: number }>();
  const soglia60 = new Date(now.getTime() - 60 * GIORNO_MS);

  // serie temporale: giorno (≤30gg), settimana (≤90gg), mese (oltre)
  const modo: "giorno" | "settimana" | "mese" = giorni <= 31 ? "giorno" : giorni <= 100 ? "settimana" : "mese";
  const bucket = (d: Date): string => {
    const g = giornoRoma(d);
    if (modo === "giorno") return g;
    if (modo === "mese") return g.slice(0, 7);
    // settimana: lunedì di quella settimana
    const [y, m, dd] = g.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, dd));
    const idx = (base.getUTCDay() + 6) % 7;
    base.setUTCDate(base.getUTCDate() - idx);
    return base.toISOString().slice(0, 10);
  };
  const serieMap = new Map<string, { consumo: number; acquisti: number }>();
  const addSerie = (k: string, campo: "consumo" | "acquisti", v: number) => {
    const s = serieMap.get(k) ?? { consumo: 0, acquisti: 0 };
    s[campo] += v;
    serieMap.set(k, s);
  };

  for (const m of args.movimenti) {
    const p = prodById.get(m.productId);
    if (!p) continue;
    // Uno SCARICO è consumo reale anche se la giacenza a sistema era già a zero
    // (non aggiornata): conta la quantità scaricata, non la differenza di giacenza.
    // Le rettifiche invece sono solo la differenza tra conteggio e sistema.
    const uscita =
      m.tipo === "SCARICO" && m.quantita > 0 ? m.quantita : Math.max(0, m.qtaPrima - m.qtaDopo);
    if (uscita <= 0) continue;
    const valore = uscita * costoUnit(p);
    const t = m.createdAt.getTime();

    if (m.tipo === "RETTIFICA") {
      if (t >= inizio.getTime()) {
        ammancoPezzi += uscita;
        ammancoValore += valore;
        const a = ammanchiMap.get(p.id) ?? { pezzi: 0, valore: 0 };
        a.pezzi += uscita;
        a.valore += valore;
        ammanchiMap.set(p.id, a);
      }
      continue;
    }
    // SCARICO (e qualunque altra uscita non-rettifica)
    if (t >= soglia60.getTime()) perProdotto60.set(p.id, (perProdotto60.get(p.id) ?? 0) + uscita);
    const prev = ultimoScarico.get(p.id);
    if (!prev || m.createdAt > prev) ultimoScarico.set(p.id, m.createdAt);

    if (t >= inizio.getTime()) {
      consumoPezzi += uscita;
      consumoValore += valore;
      const pp = perProdotto.get(p.id) ?? { pezzi: 0, pezziPrec: 0, valore: 0 };
      pp.pezzi += uscita;
      pp.valore += valore;
      perProdotto.set(p.id, pp);

      const c = perCategoria.get(p.categoria) ?? { pezzi: 0, valore: 0 };
      c.pezzi += uscita;
      c.valore += valore;
      perCategoria.set(p.categoria, c);

      dow[dowRoma(m.createdAt)] += uscita;
      addSerie(bucket(m.createdAt), "consumo", valore);
    } else if (hasPrec && t >= inizioPrec.getTime()) {
      consumoValorePrec += valore;
      const pp = perProdotto.get(p.id) ?? { pezzi: 0, pezziPrec: 0, valore: 0 };
      pp.pezziPrec += uscita;
      perProdotto.set(p.id, pp);
    }
  }

  // --- Acquisti (bolle) ------------------------------------------------------
  let acquisti = 0;
  let acquistiPrec = 0;
  let nBolle = 0;
  const perFornitore = new Map<string, { nome: string; spesa: number; count: number; ultima: Date | null }>();
  for (const b of args.bolle) {
    const d = b.data ?? b.createdAt;
    const t = d.getTime();
    if (t >= inizio.getTime()) {
      acquisti += b.totale;
      nBolle++;
      addSerie(bucket(d), "acquisti", b.totale);
      const nome = risolviFornitore(args.fornitori, b.fornitore) ?? "Senza fornitore";
      const chiave = chiaveFornitore(nome) || "—";
      const f = perFornitore.get(chiave) ?? { nome, spesa: 0, count: 0, ultima: null };
      f.spesa += b.totale;
      f.count += 1;
      if (!f.ultima || d > f.ultima) f.ultima = d;
      perFornitore.set(chiave, f);
    } else if (hasPrec && t >= inizioPrec.getTime()) {
      acquistiPrec += b.totale;
    }
  }

  // --- Magazzino -------------------------------------------------------------
  let valoreMag = 0;
  let valoreMagLordo = 0;
  const valoreCat = new Map<string, { valore: number; count: number }>();
  const righeValore: { id: string; nome: string; categoria: string; valore: number }[] = [];
  let senzaPrezzo = 0;
  let senzaFornitore = 0;
  let sogliaDefault = 0;
  for (const p of args.products) {
    const v = costoUnit(p) * p.quantita;
    valoreMag += v;
    valoreMagLordo += v * (1 + p.ivaRate / 100);
    const c = valoreCat.get(p.categoria) ?? { valore: 0, count: 0 };
    c.valore += v;
    c.count += 1;
    valoreCat.set(p.categoria, c);
    if (v > 0) righeValore.push({ id: p.id, nome: p.prodotto, categoria: p.categoria, valore: v });
    if (p.prezzoUnit <= 0) senzaPrezzo++;
    if (!p.fornitore?.trim()) senzaFornitore++;
    if (p.sogliaMin === 3) sogliaDefault++;
  }
  righeValore.sort((a, b) => b.valore - a.valore);
  const top10Valore = righeValore.slice(0, 10).reduce((s, r) => s + r.valore, 0);

  // --- Riordino: solo articoli che si vendono davvero ------------------------
  const daOrdinareGruppi = new Map<string, { fornitore: string; righe: RigaOrdine[]; costo: number }>();
  const esaurimento: RigaOrdine[] = [];
  let sottoSogliaInattivi = 0;
  for (const p of args.products) {
    const consumo60 = perProdotto60.get(p.id) ?? 0;
    const perGiorno = consumo60 / 60;
    const sotto = p.quantita <= p.sogliaMin;
    if (perGiorno <= 0) {
      if (sotto) sottoSogliaInattivi++;
      continue;
    }
    const copertura = p.quantita / perGiorno;
    if (!sotto && copertura >= 10) continue;
    // Obiettivo: riportare a soglia e coprire ~14 giorni di consumo.
    const target = Math.max(p.sogliaMin, Math.ceil(perGiorno * 14));
    const daOrdinare = Math.max(1, Math.ceil(target - p.quantita));
    const riga: RigaOrdine = {
      id: p.id,
      nome: p.prodotto,
      categoria: p.categoria,
      giacenza: p.quantita,
      soglia: p.sogliaMin,
      perGiorno,
      giorniCopertura: copertura,
      daOrdinare,
      costo: daOrdinare * costoUnit(p),
    };
    const nomeF = risolviFornitore(args.fornitori, p.fornitore) ?? "Senza fornitore";
    const k = chiaveFornitore(nomeF) || "—";
    const g = daOrdinareGruppi.get(k) ?? { fornitore: nomeF, righe: [], costo: 0 };
    g.righe.push(riga);
    g.costo += riga.costo;
    daOrdinareGruppi.set(k, g);
    if (copertura < 7) esaurimento.push(riga);
  }
  const daOrdinare = [...daOrdinareGruppi.values()]
    .map((g) => ({ ...g, righe: g.righe.sort((a, b) => (a.giorniCopertura ?? 0) - (b.giorniCopertura ?? 0)) }))
    .sort((a, b) => b.costo - a.costo);
  esaurimento.sort((a, b) => (a.giorniCopertura ?? 0) - (b.giorniCopertura ?? 0));

  // --- Scorte ferme: giacenza valorizzata, nessuno scarico da ≥ 90 giorni ----
  const limiteFermo = now.getTime() - 90 * GIORNO_MS;
  const scorteFerme = args.products
    .filter((p) => p.quantita > 0 && costoUnit(p) > 0 && p.createdAt.getTime() < limiteFermo)
    .map((p) => ({ p, ultimo: ultimoScarico.get(p.id) }))
    .filter(({ ultimo }) => !ultimo || ultimo.getTime() < limiteFermo)
    .map(({ p, ultimo }) => ({
      id: p.id,
      nome: p.prodotto,
      categoria: p.categoria,
      valore: costoUnit(p) * p.quantita,
      giorni: ultimo ? Math.floor((now.getTime() - ultimo.getTime()) / GIORNO_MS) : -1, // -1 = mai
    }))
    .sort((a, b) => b.valore - a.valore);

  // --- Serie temporale ordinata e riempita -----------------------------------
  const chiavi = [...serieMap.keys()].sort();
  const serie: Serie[] = chiavi.map((k) => ({
    label: modo === "mese" ? etichettaMese(k) : etichettaGiorno(k),
    consumo: serieMap.get(k)!.consumo,
    acquisti: serieMap.get(k)!.acquisti,
  }));

  const topConsumo = [...perProdotto.entries()]
    .filter(([, v]) => v.pezzi > 0)
    .map(([id, v]) => {
      const p = prodById.get(id)!;
      return {
        id,
        nome: p.prodotto,
        categoria: p.categoria,
        pezzi: v.pezzi,
        valore: v.valore,
        variazione: hasPrec && v.pezziPrec > 0 ? ((v.pezzi - v.pezziPrec) / v.pezziPrec) * 100 : null,
      };
    })
    .sort((a, b) => b.pezzi - a.pezzi)
    .slice(0, 10);

  const consumoCategoria = [...perCategoria.entries()]
    .map(([name, v]) => ({ name, ...v, quota: consumoValore > 0 ? (v.valore / consumoValore) * 100 : 0 }))
    .sort((a, b) => b.valore - a.valore)
    .slice(0, 8);

  const consumoGiornaliero = consumoValore / giorni;

  return {
    periodo: { key: cfg.key, label: cfg.label, giorni, precedente: hasPrec },
    kpi: {
      valoreMagazzino: valoreMag,
      valoreMagazzinoLordo: valoreMagLordo,
      nArticoli: args.products.length,
      consumoValore,
      consumoValorePrec: hasPrec ? consumoValorePrec : null,
      consumoPezzi,
      acquisti,
      acquistiPrec: hasPrec ? acquistiPrec : null,
      nBolle,
      coperturaGiorni: consumoGiornaliero > 0 ? valoreMag / consumoGiornaliero : null,
      ammancoValore,
      ammancoPezzi,
    },
    serie,
    topConsumo,
    consumoCategoria,
    giorniSettimana: dow,
    daOrdinare,
    inEsaurimento: esaurimento.slice(0, 8),
    sottoSogliaInattivi,
    scorteFerme: scorteFerme.slice(0, 10),
    scorteFermeTotale: scorteFerme.reduce((s, r) => s + r.valore, 0),
    valoreCategoria: [...valoreCat.entries()]
      .map(([name, v]) => ({ name, ...v, quota: valoreMag > 0 ? (v.valore / valoreMag) * 100 : 0 }))
      .sort((a, b) => b.valore - a.valore)
      .slice(0, 10),
    concentrazioneTop10: valoreMag > 0 ? (top10Valore / valoreMag) * 100 : 0,
    topValore: righeValore.slice(0, 8),
    acquistiFornitore: [...perFornitore.values()]
      .map((f) => ({ name: f.nome, spesa: f.spesa, count: f.count, ultima: f.ultima }))
      .sort((a, b) => b.spesa - a.spesa)
      .slice(0, 8),
    ultimeBolle: [...args.bolle]
      .sort((a, b) => (b.data ?? b.createdAt).getTime() - (a.data ?? a.createdAt).getTime())
      .slice(0, 5)
      .map((b) => ({
        numero: b.numero,
        fornitore: risolviFornitore(args.fornitori, b.fornitore),
        data: b.data ?? b.createdAt,
        totale: b.totale,
      })),
    ammanchi: [...ammanchiMap.entries()]
      .map(([id, v]) => ({ id, nome: prodById.get(id)!.prodotto, ...v }))
      .sort((a, b) => b.valore - a.valore)
      .slice(0, 8),
    qualita: { senzaPrezzo, senzaFornitore, sogliaDefault },
    hasMovimenti: args.movimenti.length > 0,
    hasBolle: args.bolle.length > 0,
  };
}
