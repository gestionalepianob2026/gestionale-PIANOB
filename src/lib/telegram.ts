// Client minimo per le API Bot di Telegram (nessuna dipendenza esterna).
// Gli errori di rete non fanno mai fallire l'elaborazione: vengono solo loggati.

export function telegramConfigurato(): boolean {
  return (
    (process.env.TELEGRAM_BOT_TOKEN ?? "").includes(":") &&
    (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").length >= 16
  );
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type Tastiera = { text: string; callback_data: string }[][];

async function chiama(metodo: string, body: Record<string, unknown>): Promise<unknown> {
  const base = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
  try {
    const res = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: unknown; description?: string }
      | null;
    if (!json?.ok) {
      // "message is not modified" è normale quando si preme due volte lo stesso pulsante
      if (!/not modified/i.test(json?.description ?? ""))
        console.warn(`[telegram] ${metodo}: ${json?.description ?? res.status}`);
      return null;
    }
    return json.result;
  } catch (e) {
    console.warn(`[telegram] ${metodo} fallita`, e instanceof Error ? e.message : e);
    return null;
  }
}

export function inviaMessaggio(
  chatId: string,
  testoHtml: string,
  opzioni: { rispondiA?: number; tastiera?: Tastiera } = {},
) {
  return chiama("sendMessage", {
    chat_id: chatId,
    text: testoHtml.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(opzioni.rispondiA
      ? { reply_parameters: { message_id: opzioni.rispondiA, allow_sending_without_reply: true } }
      : {}),
    ...(opzioni.tastiera?.length ? { reply_markup: { inline_keyboard: opzioni.tastiera } } : {}),
  });
}

export function modificaMessaggio(
  chatId: string,
  messageId: number,
  testoHtml: string,
  tastiera?: Tastiera,
) {
  return chiama("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: testoHtml.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: tastiera ?? [] },
  });
}

export function rispondiCallback(id: string, testo?: string) {
  return chiama("answerCallbackQuery", { callback_query_id: id, ...(testo ? { text: testo.slice(0, 190) } : {}) });
}

export function cancellaMessaggio(chatId: string, messageId: number) {
  return chiama("deleteMessage", { chat_id: chatId, message_id: messageId });
}
