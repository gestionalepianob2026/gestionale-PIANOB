"use client";

import { useMemo, useState } from "react";
import { fmtNum, isLow, type ProductDTO } from "@/lib/format";
import {
  IconSearch,
  IconClose,
  IconArrowUp,
  IconArrowDown,
  IconCheck,
  IconSpinner,
  IconDownload,
} from "@/components/icons";
import { MessaggioTab } from "./messaggio-tab";
import { CategoriaFiltro, matchCategoria } from "@/components/CategoriaFiltro";

type Tipo = "CARICO" | "SCARICO";
type Draft = { tipo: Tipo; value: number };
type Mode = "MANUALE" | "MESSAGGIO";

const LIMIT = 120;

function parseNum(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function nuovaGiacenza(attuale: number, d: Draft): number {
  if (d.tipo === "CARICO") return attuale + d.value;
  return Math.max(0, attuale - d.value); // SCARICO
}

export function GiacenzaClient({
  initialProducts,
}: {
  initialProducts: ProductDTO[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [mode, setMode] = useState<Mode>("MESSAGGIO");
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [qtyInput, setQtyInput] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!matchCategoria(p, activeCat, activeSub)) return false;
      if (q) {
        const hay = `${p.prodotto} ${p.fornitore ?? ""} ${p.categoria}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, search, activeCat, activeSub]);

  const draftEntries = Object.entries(drafts);
  const nDraft = draftEntries.length;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function applyUpdates(upd: { id: string; quantita: number }[]) {
    const map = new Map(upd.map((x) => [x.id, x.quantita]));
    setProducts((prev) =>
      prev.map((p) => (map.has(p.id) ? { ...p, quantita: map.get(p.id)! } : p)),
    );
  }

  function setMovDraft(p: ProductDTO, tipo: "CARICO" | "SCARICO") {
    const v = parseNum(qtyInput[p.id] ?? "");
    if (v === undefined || v <= 0) return;
    setDrafts((d) => ({ ...d, [p.id]: { tipo, value: v } }));
    setQtyInput((q) => ({ ...q, [p.id]: "" }));
  }

  function removeDraft(id: string) {
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    setQtyInput((q) => ({ ...q, [id]: "" }));
  }

  async function submit() {
    if (nDraft === 0) return;
    setSaving(true);
    setError(null);
    try {
      const movimenti = draftEntries.map(([productId, d]) => ({
        productId,
        tipo: d.tipo,
        quantita: d.value,
      }));
      const res = await fetch("/api/movimenti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimenti }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      applyUpdates(data.products);
      setDrafts({});
      setQtyInput({});
      showToast(
        `${data.count} ${data.count === 1 ? "movimento registrato" : "movimenti registrati"} · giacenze aggiornate`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
    } finally {
      setSaving(false);
    }
  }

  const showLista = mode === "MANUALE";

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Consumi</h1>
          <p className="mt-1 text-[13px] text-muted2">
            Togli i prodotti usati nel turno, oppure incolla il messaggio dei
            ragazzi e li scala in automatico.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- endpoint di download, non una pagina */}
        <a
          href="/api/products/export"
          className="flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-[13px] font-semibold shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-ink/20"
        >
          <IconDownload width={17} height={17} /> Esporta CSV
        </a>
      </div>

      {/* Tabs modalità */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-line2 p-1">
        <TabBtn active={mode === "MESSAGGIO"} onClick={() => setMode("MESSAGGIO")}>
          Da messaggio
        </TabBtn>
        <TabBtn active={mode === "MANUALE"} onClick={() => setMode("MANUALE")}>
          Manuale
        </TabBtn>
      </div>

      {mode === "MESSAGGIO" ? (
        <MessaggioTab
          products={products}
          onApplied={applyUpdates}
          onToast={showToast}
        />
      ) : (
        <>
          {/* Search */}
          <div className="relative">
            <IconSearch
              width={18}
              height={18}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted2"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca prodotto, fornitore…"
              className="w-full rounded-xl border border-line bg-tint py-3 pl-11 pr-10 text-sm outline-none transition focus:border-ink/30 focus:bg-white"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted2 hover:text-ink"
              >
                <IconClose width={16} height={16} />
              </button>
            )}
          </div>

          {/* Filtri: macro-categorie e sottocategorie */}
          <CategoriaFiltro
            products={products}
            cat={activeCat}
            sub={activeSub}
            onChange={(c, sc) => {
              setActiveCat(c);
              setActiveSub(sc);
            }}
          />
        </>
      )}

      {/* Coda movimenti in attesa (modalità manuale) */}
      {showLista && nDraft > 0 && (
        <section className="rounded-2xl border border-brand-dark/40 bg-brand/10 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold">
              In coda · {nDraft} {nDraft === 1 ? "modifica" : "modifiche"}
            </h2>
            <button
              onClick={() => {
                setDrafts({});
                setQtyInput({});
              }}
              className="text-[12.5px] font-medium text-muted hover:text-ink"
            >
              Svuota
            </button>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5">
            {draftEntries.map(([id, d]) => {
              const p = byId.get(id);
              if (!p) return null;
              const nuova = nuovaGiacenza(p.quantita, d);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {p.prodotto}
                    </p>
                    <p className="text-[11.5px] text-muted2">
                      <TipoLabel tipo={d.tipo} /> · {fmtNum(p.quantita)} →{" "}
                      <span className="font-semibold text-ink">
                        {fmtNum(nuova)}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => removeDraft(id)}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted2 hover:bg-line2 hover:text-danger"
                  >
                    <IconClose width={15} height={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      {/* Lista prodotti (modalità manuale) */}
      {showLista && (
        <div className="flex flex-col gap-2.5">
          {filtered.slice(0, LIMIT).map((p) => {
            const draft = drafts[p.id];
            const low = isLow(p);
            return (
              <div
                key={p.id}
                className={`rounded-2xl border bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,.04)] ${
                  draft ? "border-brand-dark/50" : "border-line"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-[14px] font-medium">
                      {p.prodotto}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted2">
                      {p.categoria}
                      {p.fornitore ? ` · ${p.fornitore}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10.5px] font-semibold tracking-wide text-muted2">
                      GIACENZA
                    </p>
                    <p
                      className={`text-[18px] font-semibold tabular-nums ${
                        low ? "text-danger" : "text-ink"
                      }`}
                    >
                      {fmtNum(p.quantita)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={qtyInput[p.id] ?? ""}
                    onChange={(e) =>
                      setQtyInput((q) => ({ ...q, [p.id]: e.target.value }))
                    }
                    placeholder="q.tà"
                    className="w-20 rounded-xl border border-line bg-tint px-3 py-2.5 text-center text-[15px] font-semibold tabular-nums outline-none focus:border-ink/30 focus:bg-white"
                  />
                  <button
                    onClick={() => setMovDraft(p, "SCARICO")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-white py-2.5 text-[13px] font-semibold text-danger transition hover:border-danger/40 hover:bg-danger/5"
                  >
                    <IconArrowDown width={16} height={16} /> Togli
                  </button>
                  <button
                    onClick={() => setMovDraft(p, "CARICO")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-white py-2.5 text-[13px] font-semibold text-ok transition hover:border-ok/40 hover:bg-ok/5"
                  >
                    <IconArrowUp width={16} height={16} /> Aggiungi
                  </button>
                </div>

                {draft && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
                    <IconCheck
                      width={14}
                      height={14}
                      className="text-brand-dark"
                    />
                    In coda: <TipoLabel tipo={draft.tipo} /> · nuova giacenza{" "}
                    <span className="font-semibold text-ink">
                      {fmtNum(nuovaGiacenza(p.quantita, draft))}
                    </span>
                  </p>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted2">
              Nessun prodotto trovato.
            </div>
          )}
          {filtered.length > LIMIT && (
            <p className="px-2 py-1 text-center text-[12px] text-muted2">
              Mostrati i primi {LIMIT} di {filtered.length} — affina la ricerca
              per trovarne altri.
            </p>
          )}
        </div>
      )}

      {/* Barra registra (sticky, modalità manuale) */}
      {showLista && nDraft > 0 && (
        <div className="fixed inset-x-0 bottom-[60px] z-40 px-4 lg:bottom-6 lg:left-64">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-2xl border border-line bg-ink px-4 py-3 text-white shadow-xl lg:px-5">
            <span className="text-[13px] font-medium">
              {nDraft} {nDraft === 1 ? "modifica" : "modifiche"} da salvare
            </span>
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-black transition hover:bg-brand-dark disabled:opacity-60"
            >
              {saving && <IconSpinner width={17} height={17} />}
              Salva giacenze
            </button>
          </div>
        </div>
      )}

      {/* Toast esito */}
      {toast && (
        <div className="fixed inset-x-0 bottom-[60px] z-50 flex justify-center px-4 lg:bottom-6 lg:left-64">
          <div className="flex items-center gap-2 rounded-xl bg-ok px-4 py-2.5 text-[13px] font-semibold text-white shadow-xl">
            <IconCheck width={16} height={16} />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

function TipoLabel({ tipo }: { tipo: Tipo }) {
  const map = {
    CARICO: { t: "Aggiunto", c: "text-ok" },
    SCARICO: { t: "Tolto", c: "text-danger" },
  } as const;
  const { t, c } = map[tipo];
  return <span className={`font-semibold ${c}`}>{t}</span>;
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg py-2.5 text-[13px] font-semibold transition ${
        active ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
