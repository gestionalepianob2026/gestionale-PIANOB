"use client";

import { useMemo, useState } from "react";
import { fmtNum, type ProductDTO } from "@/lib/format";
import { ProductPicker } from "@/components/ProductPicker";
import {
  IconClose,
  IconSpinner,
  IconAlert,
} from "@/components/icons";

type Fonte = "alias" | "diretto" | "ai" | "nessuno";
type RigaConsumo = {
  termine: string;
  qta: number;
  raw: string;
  productId: string | null;
  prodotto: string | null;
  categoria: string | null;
  confidenza: number;
  fonte: Fonte;
};

const ESEMPIO = `3 mango mara
2 pesca
5 panna
12 san pell
4 crodino
12 coca zero`;

export function MessaggioTab({
  products,
  onApplied,
  onToast,
}: {
  products: ProductDTO[];
  onApplied: (upd: { id: string; quantita: number }[]) => void;
  onToast: (msg: string) => void;
}) {
  const [testo, setTesto] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [righe, setRighe] = useState<RigaConsumo[] | null>(null);
  const [ignorate, setIgnorate] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  async function analizza() {
    if (!testo.trim()) return;
    setAnalyzing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/consumi/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setRighe(data.righe as RigaConsumo[]);
      setIgnorate(data.ignorate ?? []);
      setInfo(data.messaggioAI ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante l'analisi");
    } finally {
      setAnalyzing(false);
    }
  }

  function setQta(i: number, v: string) {
    const n = Number(v.replace(",", "."));
    setRighe((rs) =>
      rs
        ? rs.map((r, idx) =>
            idx === i ? { ...r, qta: Number.isFinite(n) ? n : 0 } : r,
          )
        : rs,
    );
  }

  function assegna(i: number, p: ProductDTO) {
    const termine = righe?.[i]?.termine;
    // Memorizza SUBITO l'abbinamento (non solo allo scarico): la prossima volta
    // lo stesso soprannome verrà riconosciuto da solo.
    if (termine) {
      fetch("/api/consumi/alias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termine, productId: p.id }),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          setRighe((rs) =>
            rs
              ? rs.map((r) =>
                  r.termine === termine && r.productId === p.id
                    ? { ...r, fonte: "alias" }
                    : r,
                )
              : rs,
          );
          onToast(`Memorizzato: «${termine}» = ${p.prodotto}`);
        })
        .catch(() =>
          setInfo(
            "Non sono riuscito a memorizzare l'abbinamento: verrà riprovato quando confermi lo scarico.",
          ),
        );
    }
    setRighe((rs) =>
      rs
        ? rs.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  productId: p.id,
                  prodotto: p.prodotto,
                  categoria: p.categoria,
                  fonte: "nessuno",
                  confidenza: 1,
                }
              : r,
          )
        : rs,
    );
    setPickerFor(null);
  }

  function rimuovi(i: number) {
    setRighe((rs) => (rs ? rs.filter((_, idx) => idx !== i) : rs));
  }

  const pronte = righe?.filter((r) => r.productId && r.qta > 0) ?? [];
  const daAbbinare = righe?.filter((r) => !r.productId).length ?? 0;

  async function applica() {
    if (pronte.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/consumi/applica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          righe: pronte.map((r) => ({
            productId: r.productId,
            qta: r.qta,
            // Non impara alias da suggerimenti AI poco sicuri (evita di
            // memorizzare per sempre un abbinamento sbagliato).
            termine:
              r.fonte === "ai" && r.confidenza < 0.7 ? undefined : r.termine,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      onApplied(data.products);
      onToast(
        `${data.count} prodotti scaricati${data.aliasSalvati ? ` · ${data.aliasSalvati} soprannomi memorizzati` : ""}`,
      );
      setRighe(null);
      setIgnorate([]);
      setTesto("");
      setInfo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted2">
        Incolla qui il messaggio dei ragazzi con i prodotti consumati (uno per
        riga, es. <span className="font-medium text-muted">12 san pell</span>).
        L&apos;AI riconosce i soprannomi e prepara lo scarico; tu controlli e
        confermi.
      </p>

      <div className="relative">
        <textarea
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          rows={6}
          placeholder={ESEMPIO}
          className="w-full resize-y rounded-xl border border-line bg-tint px-3.5 py-3 text-[14px] leading-relaxed outline-none transition focus:border-ink/30 focus:bg-white"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={analizza}
          disabled={analyzing || !testo.trim()}
          className="flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-ink/90 disabled:opacity-50"
        >
          {analyzing && <IconSpinner width={17} height={17} />}
          Analizza messaggio
        </button>
        {testo && (
          <button
            onClick={() => {
              setTesto("");
              setRighe(null);
              setIgnorate([]);
              setInfo(null);
              setError(null);
            }}
            className="text-[13px] font-medium text-muted hover:text-ink"
          >
            Pulisci
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
      {info && (
        <p className="flex items-start gap-2 rounded-lg bg-warnbg px-3 py-2 text-[13px] font-medium text-warn">
          <IconAlert width={15} height={15} className="mt-0.5 shrink-0" />
          {info}
        </p>
      )}

      {righe && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">
              {righe.length} righe riconosciute
            </h3>
            {daAbbinare > 0 && (
              <span className="rounded-full bg-danger/10 px-2.5 py-1 text-[12px] font-semibold text-danger">
                {daAbbinare} da abbinare
              </span>
            )}
          </div>

          {righe.map((r, i) => {
            const prod = r.productId ? byId.get(r.productId) : null;
            const nuova = prod ? Math.max(0, prod.quantita - r.qta) : null;
            return (
              <div
                key={i}
                className={`rounded-2xl border bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,.04)] ${
                  r.productId ? "border-line" : "border-danger/40"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={r.qta}
                    onChange={(e) => setQta(i, e.target.value)}
                    className="w-16 rounded-lg border border-line bg-tint px-2 py-2 text-center text-[15px] font-semibold tabular-nums outline-none focus:border-ink/30 focus:bg-white"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-muted2">
                      «{r.termine}»
                    </p>
                    {r.prodotto ? (
                      <p className="truncate text-[14px] font-medium">
                        {r.prodotto}
                      </p>
                    ) : (
                      <p className="text-[14px] font-medium text-danger">
                        Nessun prodotto abbinato
                      </p>
                    )}
                    <div className="mt-0.5 flex items-center gap-2">
                      <FonteBadge fonte={r.fonte} conf={r.confidenza} matched={!!r.productId} />
                      {nuova !== null && (
                        <span className="text-[11.5px] text-muted2">
                          {fmtNum(prod!.quantita)} → {fmtNum(nuova)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => setPickerFor(i)}
                      className="rounded-lg border border-line px-2.5 py-2 text-[12px] font-semibold text-muted transition hover:border-ink/20 hover:text-ink"
                    >
                      {r.productId ? "Cambia" : "Scegli"}
                    </button>
                    <button
                      onClick={() => rimuovi(i)}
                      className="grid size-8 place-items-center rounded-lg text-muted2 hover:bg-line2 hover:text-danger"
                    >
                      <IconClose width={15} height={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {ignorate.length > 0 && (
            <details className="rounded-xl border border-line bg-tint px-3.5 py-2.5">
              <summary className="cursor-pointer text-[12.5px] font-medium text-muted">
                {ignorate.length} righe ignorate (senza quantità)
              </summary>
              <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-muted2">
                {ignorate.map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            onClick={applica}
            disabled={applying || pronte.length === 0}
            className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying && <IconSpinner width={18} height={18} />}
            Sottrai dal magazzino ({pronte.length})
          </button>
        </div>
      )}

      {pickerFor !== null && (
        <ProductPicker
          products={products}
          termine={righe?.[pickerFor]?.termine ?? ""}
          onPick={(p) => assegna(pickerFor, p)}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

function FonteBadge({
  fonte,
  conf,
  matched,
}: {
  fonte: Fonte;
  conf: number;
  matched: boolean;
}) {
  if (!matched)
    return (
      <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10.5px] font-semibold text-danger">
        DA ABBINARE
      </span>
    );
  if (fonte === "alias")
    return (
      <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[10.5px] font-semibold text-ok">
        MEMORIZZATO
      </span>
    );
  if (fonte === "diretto")
    return (
      <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[10.5px] font-semibold text-ok">
        RICONOSCIUTO
      </span>
    );
  const pct = Math.round(conf * 100);
  const cls =
    conf >= 0.8
      ? "bg-ok/10 text-ok"
      : conf >= 0.5
        ? "bg-warnbg text-warn"
        : "bg-danger/10 text-danger";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>
      AI {pct}%
    </span>
  );
}
