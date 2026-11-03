"use client";

import { useState } from "react";
import { IconCheck, IconSpinner, IconTrash } from "@/components/icons";

type Gruppo = { id: string; titolo: string | null; createdAt: string };

export function ImpostazioniClient({
  botConfigurato,
  codiceIniziale,
  gruppiIniziali,
}: {
  botConfigurato: boolean;
  codiceIniziale: string;
  gruppiIniziali: Gruppo[];
}) {
  const [codice, setCodice] = useState(codiceIniziale);
  const [salvato, setSalvato] = useState(codiceIniziale);
  const [mostra, setMostra] = useState(false);
  const [gruppi, setGruppi] = useState(gruppiIniziali);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; testo: string } | null>(null);

  async function salva() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/impostazioni/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setSalvato(data.codice);
      setCodice(data.codice);
      setMsg({ ok: true, testo: "Parola d'ordine salvata." });
    } catch (e) {
      setMsg({ ok: false, testo: e instanceof Error ? e.message : "Errore nel salvataggio" });
    } finally {
      setSaving(false);
    }
  }

  async function disattiva(g: Gruppo) {
    if (!confirm(`Disattivare «${g.titolo ?? "gruppo"}»? Il bot smetterà di scaricare il magazzino da lì.`))
      return;
    const res = await fetch(`/api/impostazioni/telegram/gruppi/${g.id}`, { method: "DELETE" });
    if (res.ok) setGruppi((gs) => gs.filter((x) => x.id !== g.id));
    else setMsg({ ok: false, testo: "Non sono riuscito a disattivare il gruppo." });
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
      <div>
        <h1 className="text-[30px] font-semibold tracking-tight">Impostazioni</h1>
        <p className="mt-1 text-[13px] text-muted2">Riservate all&apos;amministratore.</p>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="text-[16px] font-semibold tracking-tight">Bot Telegram</h2>
        <p className="mt-1 text-[13px] text-muted2">
          I ragazzi scrivono i consumi nel gruppo e il magazzino si scarica da solo. Per collegare
          un gruppo, scrivi lì <span className="font-medium text-muted">/attiva</span> seguito dalla
          parola d&apos;ordine qui sotto.
        </p>

        {!botConfigurato && (
          <p className="mt-3 rounded-lg bg-warnbg px-3 py-2 text-[13px] font-medium text-warn">
            Il bot non è ancora collegato al server (mancano le variabili TELEGRAM_BOT_TOKEN e
            TELEGRAM_WEBHOOK_SECRET). La parola d&apos;ordine si può già scegliere.
          </p>
        )}

        <label className="mt-5 block text-[12.5px] font-semibold text-muted">
          Parola d&apos;ordine per attivare un gruppo
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            type={mostra ? "text" : "password"}
            value={codice}
            onChange={(e) => setCodice(e.target.value.replace(/\s/g, ""))}
            maxLength={40}
            autoComplete="off"
            placeholder="es. bancone2026"
            className="min-w-0 flex-1 rounded-xl border border-line bg-tint px-3.5 py-2.5 text-[14px] outline-none transition focus:border-ink/30 focus:bg-white"
          />
          <button
            type="button"
            onClick={() => setMostra((m) => !m)}
            className="rounded-xl border border-line px-3.5 py-2.5 text-[13px] font-semibold text-muted transition hover:text-ink"
          >
            {mostra ? "Nascondi" : "Mostra"}
          </button>
          <button
            onClick={salva}
            disabled={saving || codice === salvato || codice.length < 4}
            className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-ink/90 disabled:opacity-50"
          >
            {saving ? <IconSpinner width={16} height={16} /> : <IconCheck width={16} height={16} />}
            Salva
          </button>
        </div>
        <p className="mt-2 text-[12px] text-muted2">
          Da 4 a 40 caratteri, senza spazi. Cambiarla non disattiva i gruppi già collegati: vale
          solo per quelli nuovi.
        </p>
        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-[13px] font-medium ${
              msg.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
            }`}
          >
            {msg.testo}
          </p>
        )}

        <h3 className="mt-6 text-[14px] font-semibold">Gruppi collegati</h3>
        {gruppi.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted2">Nessun gruppo ancora collegato.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-line2">
            {gruppi.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{g.titolo ?? "Chat senza nome"}</p>
                  <p className="text-[11.5px] text-muted2">
                    collegato il{" "}
                    {new Date(g.createdAt).toLocaleDateString("it-IT", { timeZone: "Europe/Rome" })}
                  </p>
                </div>
                <button
                  onClick={() => disattiva(g)}
                  title="Disattiva"
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted2 hover:bg-line2 hover:text-danger"
                >
                  <IconTrash width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
