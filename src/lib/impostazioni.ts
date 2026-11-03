import { prisma } from "@/lib/prisma";

export const CHIAVE_CODICE_TELEGRAM = "telegram.codiceAttivazione";

/** Parola d'ordine per /attiva: quella scelta nel gestionale, altrimenti la variabile d'ambiente. */
export async function codiceAttivazioneTelegram(): Promise<string> {
  const riga = await prisma.impostazione.findUnique({ where: { chiave: CHIAVE_CODICE_TELEGRAM } });
  return riga?.valore || process.env.TELEGRAM_SETUP_CODE || "";
}
