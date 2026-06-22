"use client";

import { useState } from "react";
import {
  fmtEur,
  prezzoLordo,
  valoreRiga,
  isLow,
  type ProductDTO,
} from "@/lib/format";
import {
  IconClose,
  IconTrash,
  IconAlert,
  IconSpinner,
  IconArrowUp,
  IconArrowDown,
} from "@/components/icons";

export function ProductDrawer({
  product,
  onClose,
  onUpdated,
  onDeleted,
}: {
  product: ProductDTO;
  onClose: () => void;
  onUpdated: (p: ProductDTO) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState<ProductDTO>(product);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const low = isLow(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(product);

  function set<K extends keyof ProductDTO>(k: K, v: ProductDTO[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function bumpQty(delta: number) {
    setForm((f) => ({ ...f, quantita: Math.max(0, f.quantita + delta) }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      onUpdated({ ...form, ...data.product });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Eliminare “${product.prodotto}” dall'inventario?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDeleted(product.id);
    } catch {
      setError("Impossibile eliminare l'articolo");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-[440px] flex-col overflow-y-auto bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold tracking-wide text-muted2">
              {form.categoria}
            </span>
            <h2 className="mt-0.5 text-[18px] font-semibold leading-tight tracking-tight">
              {form.prodotto}
            </h2>
            {low && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-[11.5px] font-semibold text-danger">
                <IconAlert width={13} height={13} /> SOTTO SCORTA
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-line2"
          >
            <IconClose width={18} height={18} />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          {/* Giacenza */}
          <div className="rounded-2xl border border-line bg-tint p-4">
            <p className="text-[14px] font-semibold">Giacenza</p>
            <p className="text-[12px] text-muted2">
              Aggiorna le unità in magazzino
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => bumpQty(-1)}
                className="grid size-11 place-items-center rounded-xl border border-line bg-white text-ink transition hover:border-ink/30"
              >
                <IconArrowDown width={18} height={18} />
              </button>
              <input
                type="number"
                value={form.quantita}
                onChange={(e) => set("quantita", Math.max(0, Number(e.target.value)))}
                className="w-24 rounded-xl border border-line bg-white py-2.5 text-center text-[22px] font-semibold tabular-nums outline-none focus:border-ink/30"
              />
              <button
                onClick={() => bumpQty(1)}
                className="grid size-11 place-items-center rounded-xl border border-line bg-white text-ink transition hover:border-ink/30"
              >
                <IconArrowUp width={18} height={18} />
              </button>
              <span className="ml-1 text-[13px] text-muted2">pezzi</span>
            </div>
          </div>

          {/* Valori calcolati */}
          <div className="grid grid-cols-2 gap-3">
            <Box label="Prezzo (IVA incl.)" value={fmtEur(prezzoLordo(form.prezzoUnit, form.ivaRate))} />
            <Box
              label="Valore in magazzino"
              value={fmtEur(valoreRiga(form.prezzoUnit, form.ivaRate, form.quantita))}
            />
          </div>

          {/* Campi modificabili */}
          <div className="flex flex-col gap-3.5">
            <Field label="Prodotto">
              <input
                value={form.prodotto}
                onChange={(e) => set("prodotto", e.target.value)}
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Categoria">
                <input
                  value={form.categoria}
                  onChange={(e) => set("categoria", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Fornitore">
                <input
                  value={form.fornitore ?? ""}
                  onChange={(e) => set("fornitore", e.target.value || null)}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipologia">
                <input
                  value={form.tipologia ?? ""}
                  onChange={(e) => set("tipologia", e.target.value || null)}
                  className={inputCls}
                  placeholder="Rosso, Bianco…"
                />
              </Field>
              <Field label="Zona">
                <input
                  value={form.zona ?? ""}
                  onChange={(e) => set("zona", e.target.value || null)}
                  className={inputCls}
                  placeholder="Sicilia…"
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Prezzo netto €">
                <input
                  type="number"
                  step="0.01"
                  value={form.prezzoUnit}
                  onChange={(e) => set("prezzoUnit", Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
              <Field label="IVA %">
                <input
                  type="number"
                  value={form.ivaRate}
                  onChange={(e) => set("ivaRate", Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
              <Field label="Soglia min.">
                <input
                  type="number"
                  value={form.sogliaMin}
                  onChange={(e) => set("sogliaMin", Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}

          <button
            onClick={remove}
            disabled={deleting}
            className="flex items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-[13px] font-semibold text-danger transition hover:bg-danger/5 disabled:opacity-60"
          >
            <IconTrash width={16} height={16} /> Elimina articolo
          </button>
        </div>

        {/* Footer salva */}
        <div className="sticky bottom-0 mt-auto border-t border-line bg-white px-5 py-4">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <IconSpinner width={18} height={18} />}
            {dirty ? "Salva modifiche" : "Nessuna modifica"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-[9px] border border-line bg-tint px-3 py-2.5 text-[13.5px] text-ink outline-none transition focus:border-ink/30 focus:bg-white";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-muted2">
        {label}
      </span>
      {children}
    </label>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="text-[11px] font-medium text-muted2">{label}</p>
      <p className="mt-0.5 text-[16px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
