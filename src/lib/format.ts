// Helper di calcolo e formattazione condivisi (lato server e client)

export const eur = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
});

export function fmtEur(n: number): string {
  return eur.format(Number.isFinite(n) ? n : 0);
}

export function fmtNum(n: number): string {
  // quantità: niente decimali se intero
  return Number.isInteger(n)
    ? String(n)
    : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n);
}

/** IVA unitaria a partire da imponibile e aliquota %. */
export function ivaAmount(prezzoUnit: number, ivaRate: number): number {
  return prezzoUnit * (ivaRate / 100);
}

/** Prezzo unitario lordo (IVA inclusa). */
export function prezzoLordo(prezzoUnit: number, ivaRate: number): number {
  return prezzoUnit + ivaAmount(prezzoUnit, ivaRate);
}

/** Valore di riga lordo = prezzo lordo × giacenza. */
export function valoreRiga(
  prezzoUnit: number,
  ivaRate: number,
  quantita: number,
): number {
  return prezzoLordo(prezzoUnit, ivaRate) * quantita;
}

export type ProductDTO = {
  id: string;
  prodotto: string;
  categoria: string;
  tipologia: string | null;
  zona: string | null;
  fornitore: string | null;
  prezzoUnit: number;
  ivaRate: number;
  quantita: number;
  sogliaMin: number;
};

export function isLow(p: { quantita: number; sogliaMin: number }): boolean {
  return p.quantita <= p.sogliaMin;
}
