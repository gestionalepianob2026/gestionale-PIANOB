"use client";

import { useEffect } from "react";
import { fmtEur, fmtNum, prezzoLordo, valoreRiga, isLow, type ProductDTO } from "@/lib/format";
import { IconClose, IconSearch } from "@/components/icons";

// Tabella a tutto schermo in stile foglio Excel: tutte le colonne, griglia,
// intestazione fissa, prima colonna fissa. Mostra tutte le righe filtrate.
export function TabellaSchermoIntero({
  rows,
  search,
  onSearch,
  filtro,
  onSelect,
  onClose,
}: {
  rows: ProductDTO[];
  search: string;
  onSearch: (v: string) => void;
  filtro: React.ReactNode;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const totale = rows.reduce((s, p) => s + valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita), 0);
  const th =
    "sticky top-0 z-20 border border-line bg-tint px-3 py-2 text-left text-[12px] font-semibold tracking-wide text-muted whitespace-nowrap";
  const td = "border border-line px-3 py-1.5 align-top";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="text-[20px] font-semibold">Inventario</h2>
        <span className="text-[13px] text-muted2">
          {rows.length} articoli · {fmtEur(totale)} valore
        </span>
        <div className="relative ml-auto w-full max-w-md">
          <IconSearch
            width={16}
            height={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted2"
          />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Cerca prodotto, fornitore…"
            className="w-full rounded-lg border border-line bg-tint py-2 pl-9 pr-3 text-[14px] outline-none focus:border-ink/30 focus:bg-white"
          />
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
        >
          <IconClose width={16} height={16} /> Chiudi
        </button>
      </div>

      <div className="border-b border-line px-4 py-2.5">{filtro}</div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`${th} left-0 z-30 min-w-[320px]`}>PRODOTTO</th>
              <th className={th}>CATEGORIA</th>
              <th className={th}>SOTTOCATEGORIA</th>
              <th className={th}>ZONA</th>
              <th className={th}>FORNITORE</th>
              <th className={`${th} text-right`}>NETTO</th>
              <th className={`${th} text-right`}>IVA</th>
              <th className={`${th} text-right`}>PREZZO IVATO</th>
              <th className={`${th} text-right`}>Q.TÀ</th>
              <th className={`${th} text-right`}>TOTALE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const low = isLow(p);
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={`cursor-pointer hover:bg-brand/10 ${i % 2 ? "bg-tint/60" : "bg-white"}`}
                >
                  <td className={`${td} sticky left-0 z-10 min-w-[320px] bg-inherit font-medium`}>
                    {p.prodotto}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{p.categoria}</td>
                  <td className={`${td} whitespace-nowrap`}>{p.tipologia ?? ""}</td>
                  <td className={`${td} whitespace-nowrap`}>{p.zona ?? ""}</td>
                  <td className={`${td} min-w-[160px]`}>{p.fornitore ?? ""}</td>
                  <td className={`${td} text-right tabular-nums`}>{fmtEur(p.prezzoUnit)}</td>
                  <td className={`${td} text-right tabular-nums`}>{fmtNum(p.ivaRate)}%</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {fmtEur(prezzoLordo(p.prezzoUnit, p.ivaRate))}
                  </td>
                  <td
                    className={`${td} text-right font-semibold tabular-nums ${
                      low ? "bg-danger/10 text-danger" : ""
                    }`}
                  >
                    {fmtNum(p.quantita)}
                  </td>
                  <td className={`${td} text-right font-semibold tabular-nums`}>
                    {fmtEur(valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-10 text-center text-[13px] text-muted2">Nessun articolo trovato.</div>
        )}
      </div>
    </div>
  );
}
