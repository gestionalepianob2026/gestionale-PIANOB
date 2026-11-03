// Bot Telegram: i ragazzi scrivono i consumi nel gruppo ("12 san pell") e il
// magazzino si scarica da solo.
//
// Il bot è aperto a tutti i gruppi: non serve /attiva.
// Regole di sicurezza (si scarica solo ciò che è CERTO):
//  - scarico automatico solo se il prodotto è un alias già imparato o un nome
//    inequivocabile (l'AI si limita a suggerire il pulsante giusto);
//  - tutto il resto resta "in attesa" e il gruppo sceglie il prodotto con un
//    tocco su un pulsante (la scelta viene memorizzata per la volta dopo);
//  - ogni scarico si annulla con un pulsante (entro 24 ore);
//  - lo stesso messaggio non scarica mai due volte (chiave unica chat+messaggio).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bloccaGiacenze } from "@/lib/giacenza";
import { cercaProdotti, normalizzaTermine, parseMessaggio } from "@/lib/consumi";
import { abbinaRighe } from "@/lib/abbina-consumi";
import {
  cancellaMessaggio,
  escapeHtml,
  inviaMessaggio,
  modificaMessaggio,
  rispondiCallback,
  type Tastiera,
} from "@/lib/telegram";

// --- tipi minimi dell'aggiornamento Telegram --------------------------------
type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string };
type TgMessage = {
  message_id: number;
  chat: { id: number; type: string; title?: string; first_name?: string };
  from?: TgUser;
  text?: string;
  caption?: string;
};
type TgCallback = { id: string; from: TgUser; message?: TgMessage; data?: string };
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallback };

const QTA_MAX_AUTO = 60; // sopra questa quantità si chiede conferma (refuso tipo "coca 33")
const MAX_RIGHE = 30;
const MAX_IN_ATTESA = 6;
const FINESTRA_ANNULLO_MS = 24 * 3600 * 1000;

const nomeUtente = (u?: TgUser) =>
  [u?.first_name, u?.last_name].filter(Boolean).join(" ").slice(0, 40) || "un collega";


const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n);

// --- ingresso ----------------------------------------------------------------

export async function gestisciUpdate(u: TgUpdate): Promise<void> {
  if (u.callback_query) return gestisciCallback(u.callback_query);
  if (u.message) return gestisciMessaggio(u.message);
  // altri tipi (messaggi modificati, ingressi nel gruppo, ecc.): ignorati
}

async function gestisciMessaggio(m: TgMessage): Promise<void> {
  const testo = (m.text ?? m.caption ?? "").trim();
  if (!testo || m.from?.is_bot) return;
  const chatId = String(m.chat.id);

  const cmd = testo.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (cmd) return comando(m, chatId, cmd[1].toLowerCase(), (cmd[2] ?? "").trim());

  // Registra automaticamente il gruppo se non esiste ancora
  const titolo = m.chat.title ?? m.chat.first_name ?? null;
  await prisma.telegramChat.upsert({
    where: { chatId },
    create: { chatId, titolo },
    update: { titolo },
  });

  try {
    await elaboraConsumi(m, chatId, testo);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // già elaborato
    console.error("[telegram] elaborazione fallita", e);
    await inviaMessaggio(
      chatId,
      "⚠️ Non sono riuscito a registrare questo messaggio. Riprova tra poco o scarica a mano dal gestionale.",
      { rispondiA: m.message_id },
    );
  }
}

const AIUTO = `<b>Scarico consumi PIANO B</b>
Scrivete nel gruppo cosa avete consumato, una voce per riga:
<code>12 san pell
3 aperol
coca zero x6</code>
Scarico io il magazzino e rispondo con il riepilogo. Se non sono sicuro di un prodotto vi chiedo di sceglierlo con un tocco. Con «↩️ Annulla» si disfa tutto.`;

async function comando(m: TgMessage, chatId: string, cmd: string, arg: string): Promise<void> {
  const rispondi = (t: string) => inviaMessaggio(chatId, t, { rispondiA: m.message_id });

  if (cmd === "id") {
    await rispondi(`ID di questa chat: <code>${chatId}</code>`);
    return;
  }

  if (cmd === "attiva" || cmd === "start" || cmd === "aiuto" || cmd === "help") {
    await rispondi(AIUTO);
    return;
  }
  if (cmd === "disattiva") {
    await prisma.telegramChat.deleteMany({ where: { chatId } });
    await rispondi("Gruppo rimosso dal registro.");
  }
}

// --- elaborazione di un messaggio di consumi ---------------------------------

type Decisione =
  | { tipo: "auto"; productId: string }
  | { tipo: "attesa"; candidati: string[] }
  | { tipo: "saltata" };

async function elaboraConsumi(m: TgMessage, chatId: string, testo: string): Promise<void> {
  const { righe: parsed } = parseMessaggio(testo.slice(0, 2000));
  if (parsed.length === 0) return; // chiacchiere: nessuna risposta

  const gia = await prisma.telegramMessaggio.findUnique({
    where: { chatId_messageId: { chatId, messageId: m.message_id } },
    select: { id: true },
  });
  if (gia) return;

  const righe = parsed.slice(0, MAX_RIGHE);
  const { righe: abbinate } = await abbinaRighe(righe);
  const catalogo = await prisma.product.findMany({ select: { id: true, prodotto: true } });

  let inAttesa = 0;
  const decisioni: Decisione[] = abbinate.map((r) => {
    const sicuro =
      !!r.productId &&
      r.qta <= QTA_MAX_AUTO &&
      // L'AI da sola non basta: può essere sicura al 95% e sbagliare formato
      // (es. «san pell» 25 cl invece di 50 cl). Propone, ma decide un tocco.
      (r.fonte === "alias" || r.fonte === "diretto");
    if (sicuro) return { tipo: "auto", productId: r.productId! };

    const candidati = [
      ...new Set([
        ...(r.productId ? [r.productId] : []),
        ...cercaProdotti(catalogo, r.termine, 4).map((p) => p.id),
      ]),
    ].slice(0, 3);
    if (candidati.length === 0 || inAttesa >= MAX_IN_ATTESA) return { tipo: "saltata" };
    inAttesa++;
    return { tipo: "attesa", candidati };
  });

  const mittente = nomeUtente(m.from);
  const idMsg = await prisma.$transaction(
    async (tx) => {
      // la chiave unica (chat, messaggio) blocca un secondo scarico dello stesso messaggio
      const msg = await tx.telegramMessaggio.create({
        data: { chatId, messageId: m.message_id, mittente, testo: testo.slice(0, 2000) },
      });
      const giac = await bloccaGiacenze(
        tx,
        decisioni.flatMap((d) => (d.tipo === "auto" ? [d.productId] : [])),
      );

      for (const [i, r] of abbinate.entries()) {
        const d = decisioni[i];
        if (d.tipo === "auto" && giac.has(d.productId)) {
          const mov = await scarica(tx, giac, d.productId, r.qta, `Telegram · ${mittente}`);
          await tx.telegramRiga.create({
            data: {
              messaggioId: msg.id,
              termine: r.termine,
              qta: r.qta,
              stato: "APPLICATA",
              productId: d.productId,
              movimentoId: mov,
            },
          });
        } else {
          const cand = d.tipo === "attesa" ? d.candidati : [];
          await tx.telegramRiga.create({
            data: {
              messaggioId: msg.id,
              termine: r.termine,
              qta: r.qta,
              stato: cand.length ? "IN_ATTESA" : "SALTATA",
              candidati: cand.length ? JSON.stringify(cand) : null,
            },
          });
        }
      }
      return msg.id;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const { testo: t, tastiera } = await costruisciRiepilogo(idMsg);
  await inviaMessaggio(chatId, t, { rispondiA: m.message_id, tastiera });
}

/** Scarica `qta` dal prodotto (giacenza già bloccata). Ritorna l'id del movimento. */
async function scarica(
  tx: Prisma.TransactionClient,
  giac: Map<string, number>,
  productId: string,
  qta: number,
  note: string,
): Promise<string> {
  const qtaPrima = giac.get(productId) ?? 0;
  const qtaDopo = Math.max(0, qtaPrima - qta);
  const mov = await tx.movimento.create({
    data: { productId, tipo: "SCARICO", quantita: qta, qtaPrima, qtaDopo, note },
    select: { id: true },
  });
  await tx.product.update({ where: { id: productId }, data: { quantita: qtaDopo } });
  giac.set(productId, qtaDopo);
  return mov.id;
}

// --- riepilogo con pulsanti --------------------------------------------------

function elencoCandidati(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function costruisciRiepilogo(messaggioId: string): Promise<{ testo: string; tastiera: Tastiera }> {
  const msg = await prisma.telegramMessaggio.findUniqueOrThrow({
    where: { id: messaggioId },
    include: { righe: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  const ids = new Set<string>();
  for (const r of msg.righe) {
    if (r.productId) ids.add(r.productId);
    elencoCandidati(r.candidati).forEach((c) => ids.add(c));
  }
  const [prodotti, movimenti] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, prodotto: true, sogliaMin: true },
    }),
    prisma.movimento.findMany({
      where: { id: { in: msg.righe.flatMap((r) => (r.movimentoId ? [r.movimentoId] : [])) } },
      select: { id: true, qtaPrima: true, qtaDopo: true },
    }),
  ]);
  const prod = new Map(prodotti.map((p) => [p.id, p]));
  const mov = new Map(movimenti.map((x) => [x.id, x]));

  const linee: string[] = [];
  const tastiera: Tastiera = [];
  let applicate = 0;
  for (const r of msg.righe) {
    const p = r.productId ? prod.get(r.productId) : undefined;
    const q = fmt(r.qta);
    const termine = escapeHtml(r.termine);
    if (r.stato === "APPLICATA" && p) {
      applicate++;
      const x = r.movimentoId ? mov.get(r.movimentoId) : undefined;
      const giacenza = x ? ` (${fmt(x.qtaPrima)} → ${fmt(x.qtaDopo)})` : "";
      const allarme = x && x.qtaDopo <= 0 ? " 🔴 finito" : x && x.qtaDopo <= p.sogliaMin ? " ⚠️ sotto scorta" : "";
      const scarto = x && x.qtaPrima < r.qta ? " ❗in magazzino ce n'erano meno" : "";
      linee.push(`✅ ${q} × ${escapeHtml(p.prodotto)}${giacenza}${allarme}${scarto}`);
    } else if (r.stato === "ANNULLATA") {
      linee.push(`↩️ <s>${q} × ${p ? escapeHtml(p.prodotto) : termine}</s> annullato`);
    } else if (r.stato === "IN_ATTESA") {
      linee.push(`⏳ ${q} × «${termine}» — quale prodotto?`);
      for (const c of elencoCandidati(r.candidati)) {
        const cp = prod.get(c);
        if (cp)
          tastiera.push([{ text: `«${r.termine}» → ${cp.prodotto}`.slice(0, 60), callback_data: `r:${r.id}:${c}` }]);
      }
      tastiera.push([{ text: `Salta «${r.termine}»`.slice(0, 60), callback_data: `x:${r.id}` }]);
    } else {
      linee.push(`⏭ ${q} × «${termine}» — non scaricato (prodotto non trovato)`);
    }
  }

  const titolo = msg.annullato
    ? `↩️ <b>Scarico di ${escapeHtml(msg.mittente ?? "")} ANNULLATO</b>`
    : `📦 <b>Scarico di ${escapeHtml(msg.mittente ?? "")}</b>`;
  if (!msg.annullato && applicate > 0)
    tastiera.push([{ text: "↩️ Annulla scarico", callback_data: `u:${msg.id}` }]);
  return { testo: `${titolo}\n${linee.join("\n")}`, tastiera };
}

// --- pulsanti ----------------------------------------------------------------

async function gestisciCallback(cq: TgCallback): Promise<void> {
  const m = cq.message;
  if (!m || !cq.data) return void (await rispondiCallback(cq.id));
  const chatId = String(m.chat.id);
  const [azione, a, b] = cq.data.split(":");
  let esito = "";
  let messaggioId: string | null = null;

  try {
    if (azione === "r" && a && b) {
      const r = await prisma.telegramRiga.findUnique({
        where: { id: a },
        include: { messaggio: { select: { id: true, chatId: true, mittente: true } } },
      });
      if (!r || r.messaggio.chatId !== chatId) return void (await rispondiCallback(cq.id, "Non trovato."));
      messaggioId = r.messaggio.id;
      esito = await prisma.$transaction(
        async (tx) => {
          // "prenota" la riga: un secondo tocco (o un collega) la trova già gestita
          const claim = await tx.telegramRiga.updateMany({
            where: { id: r.id, stato: "IN_ATTESA" },
            data: { stato: "APPLICATA", productId: b },
          });
          if (claim.count === 0) return "Già gestito.";
          if (!elencoCandidati(r.candidati).includes(b)) throw new Error("prodotto non proposto");
          const giac = await bloccaGiacenze(tx, [b]);
          if (!giac.has(b)) throw new Error("prodotto non trovato");
          const mov = await scarica(tx, giac, b, r.qta, `Telegram · ${r.messaggio.mittente ?? ""}`);
          await tx.telegramRiga.update({ where: { id: r.id }, data: { movimentoId: mov } });
          // scelta umana → si impara il soprannome per la prossima volta
          const termine = normalizzaTermine(r.termine);
          if (termine && termine.length <= 80)
            await tx.alias.upsert({
              where: { termine },
              create: { termine, productId: b },
              update: { productId: b, usi: { increment: 1 } },
            });
          return "Scaricato e memorizzato ✅";
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } else if (azione === "x" && a) {
      const r = await prisma.telegramRiga.findUnique({
        where: { id: a },
        include: { messaggio: { select: { id: true, chatId: true } } },
      });
      if (!r || r.messaggio.chatId !== chatId) return void (await rispondiCallback(cq.id, "Non trovato."));
      messaggioId = r.messaggio.id;
      await prisma.telegramRiga.updateMany({ where: { id: r.id, stato: "IN_ATTESA" }, data: { stato: "SALTATA" } });
      esito = "Saltato.";
    } else if (azione === "u" && a) {
      const msg = await prisma.telegramMessaggio.findUnique({ where: { id: a } });
      if (!msg || msg.chatId !== chatId) return void (await rispondiCallback(cq.id, "Non trovato."));
      messaggioId = msg.id;
      esito = await annulla(msg.id, msg.createdAt);
    } else {
      return void (await rispondiCallback(cq.id));
    }
  } catch (e) {
    console.error("[telegram] pulsante fallito", e);
    return void (await rispondiCallback(cq.id, "Errore: riprova."));
  }

  await rispondiCallback(cq.id, esito);
  if (messaggioId) {
    const { testo, tastiera } = await costruisciRiepilogo(messaggioId);
    await modificaMessaggio(chatId, m.message_id, testo, tastiera);
  }
}

/** Disfa lo scarico: rimette in magazzino quanto era stato tolto e cancella i movimenti. */
async function annulla(messaggioId: string, creato: Date): Promise<string> {
  if (Date.now() - creato.getTime() > FINESTRA_ANNULLO_MS)
    return "Troppo tardi per annullare (oltre 24 ore): correggi dal gestionale.";
  return prisma.$transaction(
    async (tx) => {
      const claim = await tx.telegramMessaggio.updateMany({
        where: { id: messaggioId, annullato: false },
        data: { annullato: true },
      });
      if (claim.count === 0) return "Già annullato.";
      const righe = await tx.telegramRiga.findMany({ where: { messaggioId } });
      const movimenti = await tx.movimento.findMany({
        where: { id: { in: righe.flatMap((r) => (r.movimentoId ? [r.movimentoId] : [])) } },
      });
      const giac = await bloccaGiacenze(tx, movimenti.map((x) => x.productId));
      for (const x of movimenti) {
        // si restituisce solo ciò che era stato davvero tolto (la giacenza non scende sotto 0)
        const resa = Math.max(0, x.qtaPrima - x.qtaDopo);
        if (giac.has(x.productId))
          await tx.product.update({
            where: { id: x.productId },
            data: { quantita: (giac.get(x.productId) ?? 0) + resa },
          });
        giac.set(x.productId, (giac.get(x.productId) ?? 0) + resa);
        await tx.movimento.delete({ where: { id: x.id } });
      }
      await tx.telegramRiga.updateMany({
        where: { messaggioId, stato: "APPLICATA" },
        data: { stato: "ANNULLATA" },
      });
      await tx.telegramRiga.updateMany({
        where: { messaggioId, stato: "IN_ATTESA" },
        data: { stato: "SALTATA" },
      });
      return "Scarico annullato ↩️";
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
