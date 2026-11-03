// Collega il bot Telegram al sito online (o lo scollega).
//   npm run telegram:webhook -- https://tuo-sito.onrender.com
//   npm run telegram:webhook -- --rimuovi
//   npm run telegram:webhook -- --stato
// Legge TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET da .env.local / .env.
import { readFileSync, existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const riga of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const arg = process.argv[2];
if (!token) throw new Error("TELEGRAM_BOT_TOKEN mancante");

const api = async (metodo, body = {}) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
};

if (arg === "--stato") {
  const { result } = await api("getWebhookInfo");
  console.log({ url: result.url || "(nessuno)", inAttesa: result.pending_update_count, ultimoErrore: result.last_error_message ?? null });
} else if (arg === "--rimuovi") {
  console.log(await api("deleteWebhook", { drop_pending_updates: true }));
} else {
  if (!arg?.startsWith("https://")) throw new Error("Indica l'indirizzo HTTPS del sito, es. https://piano-b.onrender.com");
  if (!secret || secret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET mancante o troppo corto (16+ caratteri)");
  const url = arg.replace(/\/+$/, "") + "/api/telegram/webhook";
  console.log(
    await api("setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  );
  console.log("Webhook impostato su", url);
}
