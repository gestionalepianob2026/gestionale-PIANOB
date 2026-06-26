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
