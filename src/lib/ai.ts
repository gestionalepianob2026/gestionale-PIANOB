import Anthropic from "@anthropic-ai/sdk";

// Due fornitori di AI intercambiabili, scelti da variabile d'ambiente:
//  - AI_PROVIDER=openai | anthropic (se assente: usa quello di cui c'è la chiave;
//    se ci sono entrambe, Anthropic).
// Modelli: uno "forte" per leggere i documenti (precisione su grafia e numeri) e
// uno economico per abbinare i soprannomi dei consumi. Sovrascrivibili da .env.
export const MODEL_SCAN = process.env.ANTHROPIC_MODEL_SCAN || "claude-sonnet-5-5";
export const MODEL_CONSUMI = process.env.ANTHROPIC_MODEL_CONSUMI || "claude-haiku-5-5";
export const OPENAI_MODEL_SCAN = process.env.OPENAI_MODEL_SCAN || "gpt-5.5";
export const OPENAI_MODEL_CONSUMI = process.env.OPENAI_MODEL_CONSUMI || "gpt-5.4-mini";

const chiaveVera = (k: string | undefined) => (k ?? "").length > 20;

export type Provider = "anthropic" | "openai";

/** Fornitore AI in uso (null se nessuna chiave valida è configurata). */
export function aiProvider(): Provider | null {
  const forzato = (process.env.AI_PROVIDER ?? "").toLowerCase();
  const haA = chiaveVera(process.env.ANTHROPIC_API_KEY);
  const haO = chiaveVera(process.env.OPENAI_API_KEY);
  if (forzato === "openai") return haO ? "openai" : null;
  if (forzato === "anthropic") return haA ? "anthropic" : null;
  if (haA) return "anthropic";
  if (haO) return "openai";
  return null;
}

/** true se c'è una chiave valida per il fornitore scelto. */
export function aiConfigurata(): boolean {
  return aiProvider() !== null;
}

export function getClient(): Anthropic {
  // 2 tentativi automatici su 429/5xx/rete; timeout generoso per i PDF lunghi.
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 110_000,
  });
}

// --- Chiamata unica "genera JSON secondo uno schema" -------------------------

export type Parte =
  | { tipo: "testo"; testo: string }
  | { tipo: "immagine"; mediaType: string; base64: string }
  | { tipo: "pdf"; nome: string; base64: string };

export type RichiestaJSON = {
  uso: "scan" | "consumi";
  system: string;
  /** Blocco lungo e stabile (es. il catalogo): messo in cache dove il fornitore lo permette. */
  contestoStabile?: string;
  parti: Parte[];
  schema: Record<string, unknown>;
  nomeSchema: string;
  maxTokens: number;
  sforzo: "low" | "medium" | "high";
};

export type RispostaJSON = {
  testo: string;
  esito: "ok" | "troncato" | "rifiutato";
};

export class OpenAIHttpError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
  ) {
    super(message);
  }
}

async function chiamaOpenAI(r: RichiestaJSON): Promise<RispostaJSON> {
  const modello = r.uso === "scan" ? OPENAI_MODEL_SCAN : OPENAI_MODEL_CONSUMI;
  const contenuto = r.parti.map((p) => {
    if (p.tipo === "testo") return { type: "text", text: p.testo };
    if (p.tipo === "immagine")
      return {
        type: "image_url",
        image_url: { url: `data:${p.mediaType};base64,${p.base64}`, detail: "high" },
      };
    return {
      type: "file",
      file: { filename: p.nome || "documento.pdf", file_data: `data:application/pdf;base64,${p.base64}` },
    };
  });
  // Prefisso identico a ogni richiesta (istruzioni + catalogo): OpenAI lo mette in cache da solo.
  const system = r.contestoStabile ? `${r.system}\n\n${r.contestoStabile}` : r.system;

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: modello,
        messages: [
          { role: "system", content: system },
          { role: "user", content: contenuto },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: r.nomeSchema, strict: true, schema: r.schema },
        },
        max_completion_tokens: r.maxTokens,
        reasoning_effort: r.sforzo,
      }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
      throw new OpenAIHttpError(504, "timeout", "timeout");
    throw new OpenAIHttpError(502, "rete", e instanceof Error ? e.message : "rete");
  }

  const json = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
    choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  } | null;

  if (!res.ok || !json)
    throw new OpenAIHttpError(res.status, json?.error?.code ?? null, json?.error?.message ?? `HTTP ${res.status}`);

  console.info(
    `[ai:${r.uso}] ${modello} in=${json.usage?.prompt_tokens ?? 0} cache=${json.usage?.prompt_tokens_details?.cached_tokens ?? 0} out=${json.usage?.completion_tokens ?? 0}`,
  );
  const scelta = json.choices?.[0];
  if (scelta?.message?.refusal) return { testo: "", esito: "rifiutato" };
  return {
    testo: scelta?.message?.content ?? "",
    esito: scelta?.finish_reason === "length" ? "troncato" : "ok",
  };
}

async function chiamaAnthropic(r: RichiestaJSON): Promise<RispostaJSON> {
  const modello = r.uso === "scan" ? MODEL_SCAN : MODEL_CONSUMI;
  const content: Anthropic.ContentBlockParam[] = r.parti.map((p) => {
    if (p.tipo === "testo") return { type: "text", text: p.testo };
    if (p.tipo === "immagine")
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: p.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: p.base64,
        },
      };
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: p.base64 },
    };
  });
  const system: Anthropic.TextBlockParam[] = r.contestoStabile
    ? [
        { type: "text", text: r.system },
        { type: "text", text: r.contestoStabile, cache_control: { type: "ephemeral" } },
      ]
    : [{ type: "text", text: r.system, cache_control: { type: "ephemeral" } }];

  const msg = await getClient().messages.create({
    model: modello,
    max_tokens: r.maxTokens,
    system,
    output_config: {
      // consumi: nessun parametro di sforzo (compito semplice)
      ...(r.uso === "scan" ? { effort: r.sforzo } : {}),
      format: { type: "json_schema", schema: r.schema },
    },
    messages: [{ role: "user", content }],
  });
  console.info(
    `[ai:${r.uso}] ${modello} in=${msg.usage.input_tokens} cache_r=${msg.usage.cache_read_input_tokens ?? 0} cache_w=${msg.usage.cache_creation_input_tokens ?? 0} out=${msg.usage.output_tokens}`,
  );
  if (msg.stop_reason === "refusal") return { testo: "", esito: "rifiutato" };
  const testo = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { testo, esito: msg.stop_reason === "max_tokens" ? "troncato" : "ok" };
}

/** Chiede all'AI in uso un JSON conforme allo schema. Lancia errori da passare a aiErrorMessage. */
export async function generaJSON(r: RichiestaJSON): Promise<RispostaJSON> {
  const p = aiProvider();
  if (p === "openai") return chiamaOpenAI(r);
  if (p === "anthropic") return chiamaAnthropic(r);
  throw new Error("AI non configurata");
}

/** Messaggio comprensibile per l'utente a partire da un errore dell'AI. */
export function aiErrorMessage(e: unknown): { message: string; status: number } {
  if (e instanceof OpenAIHttpError) {
    if (e.status === 401)
      return { message: "La chiave OpenAI non è valida: controlla OPENAI_API_KEY.", status: 503 };
    if (e.status === 403)
      return { message: "La chiave OpenAI non ha il permesso di usare questo modello.", status: 503 };
    if (e.status === 429 && /quota|billing|credit/i.test(`${e.code} ${e.message}`))
      return { message: "Credito OpenAI esaurito: ricarica l'account per usare l'AI.", status: 503 };
    if (e.status === 429)
      return { message: "Troppe richieste all'AI in questo momento: riprova tra un minuto.", status: 429 };
    if (e.status === 400)
      return {
        message:
          "Il file non è stato accettato dall'AI (troppo grande, danneggiato o formato non leggibile).",
        status: 400,
      };
    if (e.status === 504)
      return { message: "L'AI ci ha messo troppo a rispondere: riprova (o usa file più leggeri).", status: 504 };
    if (e.status >= 500 || e.code === "rete")
      return { message: "Il servizio AI è momentaneamente non disponibile: riprova.", status: 502 };
    return { message: "Errore durante l'analisi con l'AI.", status: 502 };
  }
  if (e instanceof Anthropic.AuthenticationError)
    return {
      message: "La chiave Anthropic non è valida: controlla ANTHROPIC_API_KEY.",
      status: 503,
    };
  if (e instanceof Anthropic.PermissionDeniedError)
    return {
      message: "La chiave Anthropic non ha il permesso di usare questo modello.",
      status: 503,
    };
  if (e instanceof Anthropic.RateLimitError)
    return {
      message: "Troppe richieste all'AI in questo momento: riprova tra un minuto.",
      status: 429,
    };
  if (e instanceof Anthropic.BadRequestError) {
    const m = String(e.message || "");
    if (/credit|balance|billing/i.test(m))
      return {
        message: "Credito Anthropic esaurito: ricarica l'account per usare l'AI.",
        status: 503,
      };
    return {
      message:
        "Il file non è stato accettato dall'AI (troppo grande, danneggiato o formato non leggibile).",
      status: 400,
    };
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError)
    return {
      message: "L'AI ci ha messo troppo a rispondere: riprova (o usa file più leggeri).",
      status: 504,
    };
  if (e instanceof Anthropic.APIConnectionError)
    return { message: "Impossibile contattare l'AI: controlla la connessione.", status: 502 };
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)
    return { message: "Il servizio AI è momentaneamente non disponibile: riprova.", status: 502 };
  return { message: "Errore durante l'analisi con l'AI.", status: 502 };
}
