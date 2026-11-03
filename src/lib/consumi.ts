// Helper per la sottrazione consumi da messaggio (es. WhatsApp dei dipendenti).

/** Normalizza un soprannome per il confronto/alias: minuscolo, accenti via, spazi singoli. */
export function normalizzaTermine(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // toglie accenti
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punteggiatura -> spazio
    .replace(/\s+/g, " ")
    .trim();
}

export type RigaMessaggio = { qta: number; termine: string; raw: string };

// --- Abbinamento locale deterministico (senza AI) ---------------------------
// Serve a riconoscere i termini "chiari" senza chiamare l'API: solo quando il
// prodotto è certo (nome esatto o unico candidato) si abbina qui; tutto ciò che
// resta ambiguo viene lasciato all'AI. Così si risparmiano chiamate.

export type ProdottoIndicizzato = { id: string; norm: string; words: string[] };

/** Pre-normalizza i nomi prodotto una volta sola per il confronto veloce. */
export function preparaIndice(
  prodotti: { id: string; prodotto: string }[],
): ProdottoIndicizzato[] {
  return prodotti.map((p) => {
    const norm = normalizzaTermine(p.prodotto);
    return { id: p.id, norm, words: norm.split(" ").filter(Boolean) };
  });
}

/** true se il token `t` combacia con la parola `w` (esatto o prefisso ≥3 char). */
function tokenMatch(t: string, w: string): boolean {
  if (t === w) return true;
  if (t.length >= 3 && w.startsWith(t)) return true;
  if (w.length >= 3 && t.startsWith(w)) return true;
  return false;
}

/**
 * Prova ad abbinare un termine a un prodotto SENZA AI.
 * Ritorna il match solo se è certo:
 *  - nome prodotto uguale al termine (score 1), oppure
 *  - un unico prodotto contiene tutti i token del termine (score 0.9), oppure
 *  - un unico prodotto inizia col termine (score 0.9).
 * Se ci sono zero o più candidati (ambiguo) ritorna null → deciderà l'AI.
 */
export function abbinaLocale(
  termine: string,
  indice: ProdottoIndicizzato[],
): { productId: string; score: number } | null {
  const norm = normalizzaTermine(termine);
  if (!norm) return null;
  const tks = norm.split(" ").filter(Boolean);
  if (tks.length === 0) return null;

  // 1) match esatto sul nome normalizzato
  const esatti = indice.filter((p) => p.norm === norm);
  if (esatti.length >= 1) return { productId: esatti[0].id, score: 1 };

  // 2) tutti i token del termine presenti nel nome, con candidato UNICO
  const contiene = indice.filter((p) =>
    tks.every((t) => p.words.some((w) => tokenMatch(t, w))),
  );
  if (contiene.length === 1) return { productId: contiene[0].id, score: 0.9 };

  // 3) il nome prodotto inizia col termine, con candidato UNICO
  const prefix = indice.filter((p) => p.norm.startsWith(norm));
  if (prefix.length === 1) return { productId: prefix[0].id, score: 0.9 };

  return null;
}

/**
 * Parsa un messaggio (incollato o scritto in chat) in righe { quantità, soprannome }.
 * Riconosce "12 san pell", "3 mango mara", "16x panna", "san pell 12", "coca x2",
 * "2,5 vino", elenchi puntati ("- 3 aperol") e più prodotti sulla stessa riga
 * separati da virgola o punto e virgola ("12 coca, 3 sprite").
 * Scarta le righe senza una quantità (nomi mittente, orari, saluti).
 */
export function parseMessaggio(testo: string): {
  righe: RigaMessaggio[];
  ignorate: string[];
} {
  const righe: RigaMessaggio[] = [];
  const ignorate: string[] = [];

  const QTA = String.raw`(\d{1,4}(?:[.,]\d{1,2})?)`;
  const NOME = String.raw`(\p{L}[\p{L}\p{N}\s.'/-]*?)`;
  const qtaPrima = new RegExp(String.raw`^${QTA}(?:[x×*]\s*|\s+[x×*]\s+|\s+)${NOME}\s*$`, "u");
  const qtaDopo = new RegExp(String.raw`^${NOME}\s+[x×*]?\s*${QTA}\s*$`, "u");

  for (const rawLine of testo.split(/\r?\n/)) {
    // via l'intestazione di export chat "[12:30, 3/11/2026] Marco:" e i pallini d'elenco
    const line = rawLine
      .replace(/^\s*\[[^\]]{3,40}\]\s*[^:\d]{1,30}:\s*/u, "")
      .replace(/^\s*[-•*·–—>]+\s*/u, "")
      .trim();
    if (!line) continue;
    // più voci sulla stessa riga: ";" oppure "," seguita da spazio (la virgola decimale no)
    for (const parte of line.split(/\s*;\s*|\s*,\s+/)) {
      const p = parte.trim();
      if (!p) continue;
      const m = p.match(qtaPrima) ?? p.match(qtaDopo);
      if (!m) {
        ignorate.push(p);
        continue;
      }
      // qtaPrima ha (qta, nome), qtaDopo ha (nome, qta)
      const primaIlNumero = /^\d/.test(p);
      const qta = Number((primaIlNumero ? m[1] : m[2]).replace(",", "."));
      const termine = (primaIlNumero ? m[2] : m[1]).trim();
      if (!qta || qta <= 0 || !termine) {
        ignorate.push(p);
        continue;
      }
      righe.push({ qta, termine, raw: p });
    }
  }

  return { righe, ignorate };
}

// --- Ricerca tollerante ai refusi (per il selettore manuale) -----------------

/** Distanza di Levenshtein con uscita anticipata oltre `max`. */
function distanza(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minRow = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
      if (cur[j] < minRow) minRow = cur[j];
    }
    if (minRow > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Cerca prodotti per `query`: prima per parole contenute (ordine libero),
 * poi, se non trova nulla, con tolleranza ai refusi ("cocha" → "Coca Cola").
 * Serve solo a PROPORRE candidati: l'abbinamento resta una scelta dell'utente.
 */
export function cercaProdotti<T extends { prodotto: string }>(
  prodotti: T[],
  query: string,
  limite = 50,
): T[] {
  const norm = normalizzaTermine(query);
  if (!norm) return prodotti.slice(0, limite);
  const tks = norm.split(" ").filter(Boolean);

  const esatti = prodotti.filter((p) => {
    const n = normalizzaTermine(p.prodotto);
    return tks.every((t) => n.includes(t));
  });
  if (esatti.length > 0) {
    // prima i prodotti in cui il termine inizia una parola ("cola" → Coca Cola
    // prima di "Agricola"), poi gli altri
    const inizio = (p: T) => {
      const w = normalizzaTermine(p.prodotto).split(" ");
      return tks.every((t) => w.some((x) => x.startsWith(t))) ? 0 : 1;
    };
    return [...esatti].sort((a, b) => inizio(a) - inizio(b)).slice(0, limite);
  }

  // Fuzzy. Una "unità" del prodotto è una parola o l'unione di 2-3 parole
  // consecutive (così "cocacola" ≈ "coca cola", "san pelegrino" ≈ "sanpellegrino").
  const punteggiati: { p: T; score: number }[] = [];
  const congiunto = tks.join("");
  for (const p of prodotti) {
    const words = normalizzaTermine(p.prodotto).split(" ").filter(Boolean);
    const unita = [...words];
    for (let n = 2; n <= 3; n++)
      for (let k = 0; k + n <= words.length; k++)
        unita.push(words.slice(k, k + n).join(""));

    // Costo di un token contro un'unità: parola intera = d, prefisso = d + 0.5
    const costo = (t: string, max: number) => {
      let best = max + 1;
      for (const u of unita) {
        const pieno = distanza(t, u, max);
        const pref =
          u.length > t.length ? distanza(t, u.slice(0, t.length), max) + 0.5 : max + 1;
        const d = Math.min(pieno, pref);
        if (d < best) best = d;
        if (best === 0) break;
      }
      return best;
    };

    // A) ogni token somiglia a una parte del nome
    let a = 0;
    for (const t of tks) {
      const max = t.length <= 4 ? 1 : 2;
      const c = costo(t, max);
      if (c > max) {
        a = Infinity;
        break;
      }
      a += c;
    }
    // B) tutta la query unita somiglia a una parte del nome
    const maxB = congiunto.length <= 4 ? 1 : 2;
    const b = tks.length > 1 ? costo(congiunto, maxB) : Infinity;

    const score = Math.min(a, b > maxB ? Infinity : b);
    if (Number.isFinite(score)) punteggiati.push({ p, score });
  }
  punteggiati.sort((a, b) => a.score - b.score);
  return punteggiati.slice(0, limite).map((x) => x.p);
}

// --- Abbinamento descrizione fornitore → articolo del catalogo ---------------

export type CandidatoCatalogo = { id: string; score: number };

function tokenSimile(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.startsWith(a)) return true;
  if (b.length >= 3 && a.startsWith(b)) return true;
  return false;
}

/**
 * Propone i prodotti del catalogo più simili a una descrizione di bolla
 * (es. "COCA COLA 33CL VAP" → "Coca Cola cl. 33"). Punteggio di Dice sui token,
 * penalizzato se le misure/numeri (33, 75, 1) non coincidono.
 */
export function candidatiCatalogo(
  descrizione: string,
  indice: ProdottoIndicizzato[],
  max = 3,
): CandidatoCatalogo[] {
  const q = normalizzaTermine(descrizione)
    // "33cl" → "33 cl", "0,75l" già normalizzato in "0 75l"
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
  if (q.length === 0) return [];
  const qNum = q.filter((t) => /^\d+$/.test(t));

  const out: CandidatoCatalogo[] = [];
  for (const p of indice) {
    const pw = p.norm
      .replace(/(\d)([a-z])/g, "$1 $2")
      .split(" ")
      .filter(Boolean);
    if (pw.length === 0) continue;
    let comuni = 0;
    for (const t of q) if (pw.some((w) => tokenSimile(t, w))) comuni++;
    if (comuni === 0) continue;
    let score = (2 * comuni) / (q.length + pw.length);
    const pNum = pw.filter((t) => /^\d+$/.test(t));
    if (qNum.length && pNum.length && !qNum.some((n) => pNum.includes(n)))
      score = Math.min(score, 0.55); // misure diverse: probabilmente un altro formato
    if (score >= 0.4) out.push({ id: p.id, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}
