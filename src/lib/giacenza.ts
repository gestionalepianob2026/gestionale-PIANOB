// Letture "bloccanti" delle giacenze dentro una transazione.
//
// Senza blocco, due scarichi simultanei (es. due colleghi, o più messaggi del
// bot Telegram insieme) leggono la stessa giacenza e il secondo sovrascrive il
// primo: uno scarico va perso. `FOR UPDATE` fa aspettare il secondo finché il
// primo non ha finito, così legge il valore già aggiornato.

import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Legge (e blocca fino a fine transazione) le giacenze degli articoli indicati. */
export async function bloccaGiacenze(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  const unici = [...new Set(ids)].sort(); // ordine fisso → niente deadlock tra transazioni
  if (unici.length === 0) return new Map();
  const righe = await tx.$queryRaw<{ id: string; quantita: number }[]>(
    Prisma.sql`SELECT "id", "quantita" FROM "Product" WHERE "id" IN (${Prisma.join(unici)}) ORDER BY "id" FOR UPDATE`,
  );
  return new Map(righe.map((r) => [r.id, Number(r.quantita)]));
}
