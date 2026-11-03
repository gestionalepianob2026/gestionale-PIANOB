"use client";

import { useMemo, useState } from "react";
import { fmtNum, type ProductDTO } from "@/lib/format";
import { cercaProdotti } from "@/lib/consumi";
import { IconSearch, IconClose } from "@/components/icons";

export function ProductPicker({
  products,
  termine,
  onPick,
  onClose,
}: {
  products: ProductDTO[];
  termine: string;
  onPick: (p: ProductDTO) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(termine);
  // Ricerca per parole, tollerante ai refusi ("cocha" → Coca Cola).
  const filtered = useMemo(() => cercaProdotti(products, q, 50), [products, q]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="border-b border-line p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">Scegli il prodotto</h3>
            <button
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-line2"
            >
              <IconClose width={17} height={17} />
            </button>
          </div>
          <div className="relative mt-3">
            <IconSearch
              width={17}
              height={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted2"
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca prodotto…"
              className="w-full rounded-xl border border-line bg-tint py-2.5 pl-10 pr-3 text-sm outline-none focus:border-ink/30 focus:bg-white"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-tint"
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium">{p.prodotto}</p>
                <p className="text-[11.5px] text-muted2">
                  {p.categoria}
                  {p.fornitore ? ` · ${p.fornitore}` : ""}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-line2 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums">
                {fmtNum(p.quantita)}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="p-6 text-center text-[13px] text-muted2">
              Nessun prodotto trovato.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
