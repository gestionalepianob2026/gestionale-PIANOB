// Un fornitore scritto "Giesse", "giesse" o " GIESSE " è lo stesso fornitore.
// Il confronto ignora maiuscole/minuscole, accenti, punteggiatura e spazi doppi;
// nel database si usa sempre la grafia più frequente (quella "canonica").

import { normalizzaTermine } from "@/lib/consumi";

/** Chiave di confronto di un fornitore (vuota se il nome è vuoto). */
export function chiaveFornitore(nome: string | null | undefined): string {
  return normalizzaTermine(nome ?? "");
}

/**
 * Sceglie la grafia da mostrare tra più varianti: prima quelle scritte "bene"
 * (maiuscole e minuscole miste, es. "Giesse" meglio di "giesse" o "GIESSE"),
 * poi la più frequente.
 */
function sceglie(varianti: Map<string, number>): string {
  let best = "";
  let bestScore = -1;
  for (const [nome, n] of varianti) {
    const curata = /[A-Z]/.test(nome) && /[a-z]/.test(nome) ? 100000 : 0;
    const score = curata + n;
    if (score > bestScore) {
      best = nome;
      bestScore = score;
    }
  }
  return best;
}

export type MappaFornitori = Map<string, string>; // chiave → grafia canonica

/** Costruisce la mappa chiave → grafia canonica a partire dagli articoli a catalogo. */
export async function caricaFornitori(db: unknown): Promise<MappaFornitori> {
  const righe = (await (db as {
    product: {
      groupBy: (a: {
        by: ["fornitore"];
        where: { fornitore: { not: null } };
        _count: true;
      }) => Promise<{ fornitore: string | null; _count: number }[]>;
    };
  }).product.groupBy({
    by: ["fornitore"],
    where: { fornitore: { not: null } },
    _count: true,
  })) as { fornitore: string | null; _count: number }[];

  const perChiave = new Map<string, Map<string, number>>();
  for (const r of righe) {
    const nome = (r.fornitore ?? "").trim();
    const k = chiaveFornitore(nome);
    if (!k) continue;
    const v = perChiave.get(k) ?? new Map<string, number>();
    v.set(nome, (v.get(nome) ?? 0) + r._count);
    perChiave.set(k, v);
  }
  const out: MappaFornitori = new Map();
  for (const [k, v] of perChiave) out.set(k, sceglie(v));
  return out;
}

/** Restituisce la grafia canonica se il fornitore esiste già, altrimenti il nome ripulito. */
export function risolviFornitore(
  mappa: MappaFornitori,
  nome: string | null | undefined,
): string | null {
  const pulito = (nome ?? "").replace(/\s+/g, " ").trim();
  if (!pulito) return null;
  return mappa.get(chiaveFornitore(pulito)) ?? pulito;
}

/** Toglie i doppioni (per maiuscole ecc.) da un elenco di nomi, per i menu a tendina. */
export function fornitoriUnici(nomi: (string | null | undefined)[]): string[] {
  const conteggi = new Map<string, Map<string, number>>();
  for (const n of nomi) {
    const nome = (n ?? "").trim();
    const k = chiaveFornitore(nome);
    if (!k) continue;
    const v = conteggi.get(k) ?? new Map<string, number>();
    v.set(nome, (v.get(nome) ?? 0) + 1);
    conteggi.set(k, v);
  }
  return [...conteggi.values()]
    .map(sceglie)
    .sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
}

