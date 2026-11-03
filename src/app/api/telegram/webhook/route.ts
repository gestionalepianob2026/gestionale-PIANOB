import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { gestisciUpdate, type TgUpdate } from "@/lib/telegram-consumi";
import { telegramConfigurato } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Telegram chiama questo indirizzo a ogni messaggio del gruppo. L'autenticità
// si verifica con il segreto che abbiamo registrato insieme al webhook
// (intestazione X-Telegram-Bot-Api-Secret-Token): senza, chiunque potrebbe
// inviare finti messaggi e scaricare il magazzino.
export async function POST(request: Request) {
  if (!telegramConfigurato())
    return NextResponse.json({ error: "Bot non configurato" }, { status: 503 });

  const atteso = createHash("sha256").update(process.env.TELEGRAM_WEBHOOK_SECRET!).digest();
  const ricevuto = createHash("sha256")
    .update(request.headers.get("x-telegram-bot-api-secret-token") ?? "")
    .digest();
  if (!timingSafeEqual(atteso, ricevuto))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  if (!update || typeof update.update_id !== "number")
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });

  try {
    await gestisciUpdate(update);
  } catch (e) {
    // sempre 200: un errore nostro non deve far riprovare Telegram all'infinito
    console.error("[telegram] errore update", e);
  }
  return NextResponse.json({ ok: true });
}
