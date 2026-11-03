// Limite semplice ai tentativi (in memoria): frena chi prova password a raffica.
// Basta per un'istanza singola (Render free); se si scala su più istanze va
// spostato su un archivio condiviso.

type Voce = { n: number; scade: number };
const tentativi = new Map<string, Voce>();

const FINESTRA_MS = 15 * 60 * 1000;

/** Registra un tentativo FALLITO. */
export function registraFallimento(chiave: string): void {
  const ora = Date.now();
  const v = tentativi.get(chiave);
  if (!v || v.scade < ora) {
    tentativi.set(chiave, { n: 1, scade: ora + FINESTRA_MS });
    return;
  }
  v.n += 1;
}

/** Secondi di attesa rimanenti se la chiave è bloccata, altrimenti 0. */
export function bloccoRimanente(chiave: string, max: number): number {
  const v = tentativi.get(chiave);
  if (!v) return 0;
  const ora = Date.now();
  if (v.scade < ora) {
    tentativi.delete(chiave);
    return 0;
  }
  return v.n >= max ? Math.ceil((v.scade - ora) / 1000) : 0;
}

export function azzera(chiave: string): void {
  tentativi.delete(chiave);
}

// pulizia periodica per non crescere all'infinito
if (typeof setInterval !== "undefined") {
  const t = setInterval(() => {
    const ora = Date.now();
    for (const [k, v] of tentativi) if (v.scade < ora) tentativi.delete(k);
  }, 10 * 60 * 1000);
  (t as { unref?: () => void }).unref?.();
}
