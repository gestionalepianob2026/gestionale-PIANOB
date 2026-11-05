"use client";

import { useMemo } from "react";

// Macro-categorie nell'ordine voluto dal locale. CARTOPLASTICA è sempre mostrata
// (per ora vuota); eventuali altre categorie create a mano vanno in coda.
export const ORDINE_CATEGORIE = [
  "CUCINA",
  "STRUZZICHERIA",
  "CAFFETTERIA",
  "BEVANDE",
  "ALCOLICI",
  "VINI",
  "CARTOPLASTICA",
];

// Valore speciale per "prodotti senza sottocategoria"
export const SENZA_SOTTO = "__senza__";

type Prod = { categoria: string; tipologia: string | null };

export function matchCategoria(p: Prod, cat: string | null, sub: string | null) {
  if (cat && p.categoria !== cat) return false;
  if (cat && sub) {
    if (sub === SENZA_SOTTO) return !p.tipologia;
    return p.tipologia === sub;
  }
  return true;
}

export function CategoriaFiltro({
  products,
  cat,
  sub,
  onChange,
  leading,
}: {
  products: Prod[];
  cat: string | null;
  sub: string | null;
  onChange: (cat: string | null, sub: string | null) => void;
  /** chip extra prima delle categorie (es. "Sotto scorta") */
  leading?: React.ReactNode;
}) {
  const { macro, subs } = useMemo(() => {
    const m = new Map<string, number>(ORDINE_CATEGORIE.map((c) => [c, 0]));
    const s = new Map<string, number>();
    for (const p of products) {
      m.set(p.categoria, (m.get(p.categoria) ?? 0) + 1);
      if (cat && p.categoria === cat) {
        const k = p.tipologia || SENZA_SOTTO;
        s.set(k, (s.get(k) ?? 0) + 1);
      }
    }
    const extra = [...m.keys()].filter((c) => !ORDINE_CATEGORIE.includes(c)).sort();
    return {
      macro: [...ORDINE_CATEGORIE, ...extra].map((name) => ({ name, count: m.get(name) ?? 0 })),
      subs: [...s.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) =>
          a.name === SENZA_SOTTO ? 1 : b.name === SENZA_SOTTO ? -1 : b.count - a.count,
        ),
    };
  }, [products, cat]);

  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {leading}
        <Pill active={!cat} onClick={() => onChange(null, null)}>
          Tutti
        </Pill>
        {macro.map((c) => (
          <Pill
            key={c.name}
            active={cat === c.name}
            onClick={() => onChange(cat === c.name ? null : c.name, null)}
          >
            {c.name}
            <span className={cat === c.name ? "text-white/70" : "text-muted2"}>{c.count}</span>
          </Pill>
        ))}
      </div>

      {cat && subs.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <Pill small active={!sub} onClick={() => onChange(cat, null)}>
            Tutti i {cat.toLowerCase()}
          </Pill>
          {subs.map((s) => (
            <Pill
              small
              key={s.name}
              active={sub === s.name}
              onClick={() => onChange(cat, sub === s.name ? null : s.name)}
            >
              {s.name === SENZA_SOTTO ? "Altro" : s.name}
              <span className={sub === s.name ? "text-white/70" : "text-muted2"}>{s.count}</span>
            </Pill>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({
  children,
  active,
  onClick,
  small,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition ${
        small ? "px-3 py-1.5 text-[12px]" : "px-3.5 py-2 text-[12.5px]"
      } ${
        active
          ? small
            ? "border-brand-dark bg-brand text-black"
            : "border-ink bg-ink text-white"
          : "border-line bg-white text-slate hover:border-ink/20"
      }`}
    >
      {children}
    </button>
  );
}
