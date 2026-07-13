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
 * Parsa un messaggio incollato in righe { quantità, soprannome }.
 * Riconosce righe tipo "12 san pell", "3 mango mara", "16x panna".
 * Scarta righe senza una quantità iniziale (nomi mittente, orari, intestazioni).
 */
export function parseMessaggio(testo: string): {
  righe: RigaMessaggio[];
  ignorate: string[];
} {
  const righe: RigaMessaggio[] = [];
  const ignorate: string[] = [];

  for (const rawLine of testo.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // quantità iniziale, poi (opz.) x/×/*, poi spazio, poi un nome che inizia per lettera
    const m = line.match(/^(\d{1,4})\s*[x×*]?\s+(\p{L}[\p{L}\p{N}\s.'/-]*?)\s*$/u);
    if (!m) {
      ignorate.push(line);
      continue;
    }
    const qta = Number(m[1]);
    const termine = m[2].trim();
    if (!qta || qta <= 0 || !termine) {
      ignorate.push(line);
      continue;
    }
    righe.push({ qta, termine, raw: line });
  }

  return { righe, ignorate };
}
