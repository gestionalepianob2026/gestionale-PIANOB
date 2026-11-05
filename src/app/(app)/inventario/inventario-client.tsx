"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  fmtEur,
  fmtNum,
  prezzoLordo,
  valoreRiga,
  isLow,
  type ProductDTO,
} from "@/lib/format";
import {
  IconSearch,
  IconPlus,
  IconScan,
  IconClose,
  IconAlert,
  IconDownload,
} from "@/components/icons";
import { CategoriaFiltro, matchCategoria } from "@/components/CategoriaFiltro";
import { ProductDrawer } from "./product-drawer";

const PAGE = 200; // quanti articoli mostrare per volta

export function InventarioClient({
  initialProducts,
  isAdmin,
}: {
  initialProducts: ProductDTO[];
  isAdmin: boolean;
}) {
  const params = useSearchParams();
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(params.get("low") === "1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);

  // Reset alla prima "pagina" quando cambiano ricerca o filtri
  // (pattern React: aggiorna lo stato durante il render, senza effect).
  const filterKey = `${search}|${activeCat ?? ""}|${activeSub ?? ""}|${lowOnly}`;
  const [prevKey, setPrevKey] = useState(filterKey);
  if (filterKey !== prevKey) {
    setPrevKey(filterKey);
    setVisible(PAGE);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!matchCategoria(p, activeCat, activeSub)) return false;
      if (lowOnly && !isLow(p)) return false;
      if (q) {
        const hay = `${p.prodotto} ${p.fornitore ?? ""} ${p.zona ?? ""} ${
          p.tipologia ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, search, activeCat, activeSub, lowOnly]);

  const totValue = useMemo(
    () =>
      filtered.reduce(
        (s, p) => s + valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita),
        0,
      ),
    [filtered],
  );

  const selected = products.find((p) => p.id === selectedId) ?? null;

  function onUpdated(updated: ProductDTO) {
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }
  function onDeleted(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setSelectedId(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Inventario</h1>
          <p className="mt-1 text-[13px] text-muted2">
            {filtered.length} articoli · {fmtEur(totValue)} valore
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- endpoint di download, non una pagina */}
          <a
            href="/api/products/export"
            className="flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-[13px] font-semibold shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-ink/20"
          >
            <IconDownload width={17} height={17} /> Esporta CSV
          </a>
          <Link
            href="/aggiungi"
            className="flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-[13px] font-semibold shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-ink/20"
          >
            <IconPlus width={17} height={17} /> Manuale
          </Link>
          <Link
            href="/scansiona"
            className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-black transition hover:bg-brand-dark"
          >
            <IconScan width={17} height={17} /> Scansiona
          </Link>
        </div>
      </div>

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
          placeholder="Cerca prodotto, fornitore, zona…"
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
        leading={
          <Chip active={lowOnly} onClick={() => setLowOnly((v) => !v)} danger>
            <IconAlert width={14} height={14} /> Sotto scorta
          </Chip>
        }
      />

      {/* Tabella desktop */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] md:block">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] font-semibold tracking-wide text-muted2">
              <th className="px-4 py-3">PRODOTTO</th>
              <th className="px-3 py-3">CATEGORIA</th>
              <th className="px-3 py-3">TIPO · ZONA</th>
              <th className="px-3 py-3">FORNITORE</th>
              <th className="px-3 py-3 text-right">PREZZO</th>
              <th className="px-3 py-3 text-right">Q.TÀ</th>
              <th className="px-4 py-3 text-right">TOTALE</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, visible).map((p) => {
              const low = isLow(p);
              return (
                <tr
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="cursor-pointer border-b border-line2 last:border-0 hover:bg-tint"
                >
                  <td className="max-w-[280px] px-4 py-2.5 font-medium">
                    <span className="line-clamp-1">{p.prodotto}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{p.categoria}</td>
                  <td className="px-3 py-2.5 text-muted2">
                    {[p.tipologia, p.zona].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{p.fornitore ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtEur(prezzoLordo(p.prezzoUnit, p.ivaRate))}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums ${
                        low ? "bg-danger/10 text-danger" : "text-ink"
                      }`}
                    >
                      {fmtNum(p.quantita)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {fmtEur(valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyRow />}
      </div>

      {/* Lista mobile */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {filtered.slice(0, visible).map((p) => {
          const low = isLow(p);
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,.04)]"
            >
              <div className="min-w-0">
                <p className="line-clamp-1 text-[14px] font-medium">{p.prodotto}</p>
                <p className="mt-0.5 text-[12px] text-muted2">
                  {p.categoria}
                  {p.fornitore ? ` · ${p.fornitore}` : ""}
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {fmtEur(prezzoLordo(p.prezzoUnit, p.ivaRate))} / pz
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span
                  className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                    low ? "bg-danger/10 text-danger" : "bg-line2 text-ink"
                  }`}
                >
                  {fmtNum(p.quantita)} pz
                </span>
                <p className="mt-1.5 text-[13px] font-semibold tabular-nums">
                  {fmtEur(valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita))}
                </p>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted2">
            Nessun articolo trovato.
          </div>
        )}
      </div>

      {/* Mostra altro */}
      {filtered.length > visible && (
        <div className="flex flex-col items-center gap-2 pt-1">
          <button
            onClick={() => setVisible((v) => v + PAGE)}
            className="rounded-xl border border-line bg-white px-5 py-2.5 text-[13px] font-semibold shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-ink/20"
          >
            Mostra altri {Math.min(PAGE, filtered.length - visible)}
          </button>
          <p className="text-[12px] text-muted2">
            Visualizzati {visible} di {filtered.length}
          </p>
        </div>
      )}

      {selected && (
        <ProductDrawer
          product={selected}
          onClose={() => setSelectedId(null)}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          canDelete={isAdmin}
        />
      )}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition ${
        active
          ? danger
            ? "border-danger bg-danger text-white"
            : "border-ink bg-ink text-white"
          : "border-line bg-white text-slate hover:border-ink/20"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyRow() {
  return (
    <div className="px-4 py-10 text-center text-[13px] text-muted2">
      Nessun articolo trovato.
    </div>
  );
}
