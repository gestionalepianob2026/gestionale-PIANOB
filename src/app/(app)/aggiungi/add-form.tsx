"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtEur, prezzoLordo } from "@/lib/format";
import { IconSpinner, IconCheck, IconScan } from "@/components/icons";

const inputCls =
  "w-full rounded-[10px] border border-line bg-tint px-3.5 py-3 text-sm text-ink outline-none transition focus:border-ink/30 focus:bg-white";
const labelCls = "text-[12.5px] font-medium text-slate";

export function AddForm({
  categorie,
  fornitori,
}: {
  categorie: string[];
  fornitori: string[];
}) {
  const router = useRouter();
  const [f, setF] = useState({
    prodotto: "",
    categoria: "",
    tipologia: "",
    zona: "",
    fornitore: "",
    prezzoUnit: "",
    ivaRate: "22",
    quantita: "0",
    sogliaMin: "3",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const prezzoNet = Number(f.prezzoUnit.replace(",", ".")) || 0;
  const iva = Number(f.ivaRate) || 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.prodotto.trim() || !f.categoria.trim()) {
      setError("Prodotto e categoria sono obbligatori");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setDone(true);
      setTimeout(() => {
        router.push("/inventario");
        router.refresh();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">
            Aggiungi articolo
          </h1>
          <p className="mt-1 text-[13px] text-muted2">
            Inserimento manuale di un nuovo prodotto in magazzino.
          </p>
        </div>
        <Link
          href="/scansiona"
          className="flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-[13px] font-semibold shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-ink/20"
        >
          <IconScan width={17} height={17} /> Usa la scansione bolla
        </Link>
      </div>

      <form
        onSubmit={submit}
        className="mt-6 flex flex-col gap-5 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)] sm:p-6"
      >
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Prodotto *</span>
          <input
            value={f.prodotto}
            onChange={set("prodotto")}
            className={inputCls}
            placeholder="Es. Acqua Panna 50 cl"
            autoFocus
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Categoria *</span>
            <input
              value={f.categoria}
              onChange={set("categoria")}
              className={inputCls}
              placeholder="Vini, Bevande, Gin…"
              list="cats"
            />
            <datalist id="cats">
              {categorie.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Fornitore</span>
            <input
              value={f.fornitore}
              onChange={set("fornitore")}
              className={inputCls}
              placeholder="Es. Degiorgio"
              list="forns"
            />
            <datalist id="forns">
              {fornitori.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Tipologia (vini)</span>
            <input
              value={f.tipologia}
              onChange={set("tipologia")}
              className={inputCls}
              placeholder="Rosso, Bianco, Bollicina…"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Zona (vini)</span>
            <input
              value={f.zona}
              onChange={set("zona")}
              className={inputCls}
              placeholder="Sicilia, Borgogna…"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Prezzo netto €</span>
            <input
              inputMode="decimal"
              value={f.prezzoUnit}
              onChange={set("prezzoUnit")}
              className={inputCls}
              placeholder="0,00"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>IVA %</span>
            <input
              inputMode="numeric"
              value={f.ivaRate}
              onChange={set("ivaRate")}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Quantità</span>
            <input
              inputMode="numeric"
              value={f.quantita}
              onChange={set("quantita")}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Soglia min.</span>
            <input
              inputMode="numeric"
              value={f.sogliaMin}
              onChange={set("sogliaMin")}
              className={inputCls}
            />
          </label>
        </div>

        {prezzoNet > 0 && (
          <p className="text-[13px] text-muted">
            Prezzo IVA inclusa:{" "}
            <span className="font-semibold text-ink">
              {fmtEur(prezzoLordo(prezzoNet, iva))}
            </span>
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Link
            href="/inventario"
            className="rounded-xl border border-line px-5 py-3.5 text-center text-[14px] font-semibold text-slate transition hover:bg-line2"
          >
            Annulla
          </Link>
          <button
            type="submit"
            disabled={loading || done}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:opacity-60"
          >
            {loading && <IconSpinner width={18} height={18} />}
            {done && <IconCheck width={18} height={18} />}
            {done ? "Aggiunto!" : loading ? "Salvataggio…" : "Aggiungi al magazzino"}
          </button>
        </div>
      </form>
    </div>
  );
}
