"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconCamera,
  IconSpinner,
  IconScan,
  IconTrash,
  IconPlus,
  IconCheck,
  IconClose,
  IconAlert,
  IconDoc,
} from "@/components/icons";

type Riga = {
  prodotto: string;
  categoria: string;
  fornitore: string;
  prezzoUnit: string;
  ivaRate: string;
  quantita: string;
};

type Meta = { numero: string; fornitore: string; data: string };

const empty = (): Riga => ({
  prodotto: "",
  categoria: "Altro",
  fornitore: "",
  prezzoUnit: "",
  ivaRate: "22",
  quantita: "1",
});

const inputCls =
  "w-full rounded-[9px] border border-line bg-tint px-3 py-2 text-[13.5px] text-ink outline-none transition focus:border-ink/30 focus:bg-white tabular-nums";

export function ScanClient({
  categorie,
  aiEnabled,
}: {
  categorie: string[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta>({ numero: "", fornitore: "", data: "" });
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function pickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    const isPdf =
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    // Anteprima immagine solo per le foto; per i PDF mostriamo il nome file
    setPreview(isPdf ? null : URL.createObjectURL(f));
    setError(null);
  }

  async function analyze() {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/scan", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Errore durante l'analisi");
        if (data.code === "NO_API_KEY") {
          // Permette comunque l'inserimento manuale delle righe
          setRighe([empty()]);
        }
        return;
      }
      setMeta({
        numero: data.numero ?? "",
        fornitore: data.fornitore ?? "",
        data: data.data ?? "",
      });
      setRighe(
        (data.righe ?? []).map((r: Record<string, unknown>) => ({
          prodotto: String(r.prodotto ?? ""),
          categoria: String(r.categoria ?? "Altro"),
          fornitore: String(r.fornitore ?? data.fornitore ?? ""),
          prezzoUnit: String(r.prezzoUnit ?? ""),
          ivaRate: String(r.ivaRate ?? "22"),
          quantita: String(r.quantita ?? "1"),
        })),
      );
      if (!data.righe || data.righe.length === 0) {
        setError("Nessuna riga rilevata. Aggiungile manualmente o riprova.");
        setRighe([empty()]);
      }
    } catch {
      setError("Errore di rete durante l'analisi.");
    } finally {
      setAnalyzing(false);
    }
  }

  function setRiga(i: number, k: keyof Riga, v: string) {
    setRighe((rs) => rs!.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  }
  function removeRiga(i: number) {
    setRighe((rs) => rs!.filter((_, j) => j !== i));
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setRighe(null);
    setMeta({ numero: "", fornitore: "", data: "" });
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function confirm() {
    const valide = (righe ?? []).filter((r) => r.prodotto.trim());
    if (valide.length === 0) {
      setError("Aggiungi almeno un prodotto.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/bolle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: meta.numero || null,
          fornitore: meta.fornitore || null,
          data: meta.data || null,
          righe: valide.map((r) => ({
            prodotto: r.prodotto,
            categoria: r.categoria,
            fornitore: r.fornitore || null,
            prezzoUnit: Number(r.prezzoUnit.replace(",", ".")) || 0,
            ivaRate: Number(r.ivaRate) || 22,
            quantita: Number(r.quantita.replace(",", ".")) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setToast(`${data.count} prodotti aggiunti al magazzino`);
      setTimeout(() => {
        router.push("/inventario");
        router.refresh();
      }, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[30px] font-semibold tracking-tight">Scansiona bolla</h1>
      <p className="mt-1 text-[13px] text-muted2">
        Carica una foto o un PDF della bolla/fattura: l&apos;AI compila i campi,
        tu controlli e confermi.
      </p>

      {!aiEnabled && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warnbg/60 px-4 py-3 text-[12.5px] text-[#92400e]">
          <IconAlert width={16} height={16} className="mt-0.5 shrink-0" />
          <span>
            La lettura automatica non è ancora attiva. Puoi caricare foto o PDF e
            inserire le righe manualmente; per l&apos;analisi automatica aggiungi
            la chiave <code className="font-mono">ANTHROPIC_API_KEY</code> nel
            file <code className="font-mono">.env</code>.
          </span>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
      />

      {!righe && (
        <div className="mt-5">
          {!file ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line bg-tint py-16 text-center transition hover:border-ink/30"
            >
              <span className="grid size-14 place-items-center rounded-2xl bg-brand text-black">
                <IconCamera width={26} height={26} />
              </span>
              <span className="text-[15px] font-semibold">
                Carica una foto o un PDF della bolla
              </span>
              <span className="text-[12.5px] text-muted2">
                Foto (JPG, PNG) o PDF · galleria, fotocamera o file
              </span>
            </button>
          ) : (
            <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              {preview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={preview}
                  alt="Anteprima bolla"
                  className="mx-auto max-h-[360px] w-auto rounded-xl object-contain"
                />
              ) : (
                <div className="flex items-center gap-3 rounded-xl bg-tint p-4">
                  <span className="grid size-11 place-items-center rounded-xl bg-white text-ink">
                    <IconDoc width={22} height={22} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">
                      {file.name}
                    </p>
                    <p className="text-[12px] text-muted2">
                      PDF pronto per l&apos;analisi
                    </p>
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl border border-line px-4 py-3 text-[13px] font-semibold text-slate transition hover:bg-line2"
                >
                  Cambia file
                </button>
                <button
                  onClick={analyze}
                  disabled={analyzing}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:opacity-60"
                >
                  {analyzing ? (
                    <>
                      <IconSpinner width={18} height={18} /> Analisi in corso…
                    </>
                  ) : (
                    <>
                      <IconScan width={18} height={18} /> Analizza con AI
                    </>
                  )}
                </button>
              </div>
              {error && (
                <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[13px] font-medium text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {righe && (
        <div className="mt-5 flex flex-col gap-4">
          {/* Meta documento */}
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)] sm:grid-cols-3">
            <MetaField label="N. documento">
              <input
                value={meta.numero}
                onChange={(e) => setMeta((m) => ({ ...m, numero: e.target.value }))}
                className={inputCls}
                placeholder="—"
              />
            </MetaField>
            <MetaField label="Fornitore">
              <input
                value={meta.fornitore}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, fornitore: e.target.value }))
                }
                className={inputCls}
              />
            </MetaField>
            <MetaField label="Data">
              <input
                type="date"
                value={meta.data}
                onChange={(e) => setMeta((m) => ({ ...m, data: e.target.value }))}
                className={inputCls}
              />
            </MetaField>
          </div>

          {/* Righe */}
          <datalist id="scan-cats">
            {categorie.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="flex flex-col gap-3">
            {righe.map((r, i) => (
              <div
                key={i}
                className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]"
              >
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wide text-muted2">
                    RIGA {i + 1}
                  </span>
                  <button
                    onClick={() => removeRiga(i)}
                    className="flex items-center gap-1 text-[12px] font-medium text-danger hover:underline"
                  >
                    <IconTrash width={14} height={14} /> Rimuovi
                  </button>
                </div>
                <div className="flex flex-col gap-2.5">
                  <input
                    value={r.prodotto}
                    onChange={(e) => setRiga(i, "prodotto", e.target.value)}
                    placeholder="Prodotto"
                    className={inputCls}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      value={r.categoria}
                      onChange={(e) => setRiga(i, "categoria", e.target.value)}
                      placeholder="Categoria"
                      list="scan-cats"
                      className={inputCls}
                    />
                    <input
                      value={r.fornitore}
                      onChange={(e) => setRiga(i, "fornitore", e.target.value)}
                      placeholder="Fornitore"
                      className={inputCls}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <LabeledMini label="Prezzo netto €">
                      <input
                        inputMode="decimal"
                        value={r.prezzoUnit}
                        onChange={(e) => setRiga(i, "prezzoUnit", e.target.value)}
                        className={inputCls}
                        placeholder="0,00"
                      />
                    </LabeledMini>
                    <LabeledMini label="IVA %">
                      <input
                        inputMode="numeric"
                        value={r.ivaRate}
                        onChange={(e) => setRiga(i, "ivaRate", e.target.value)}
                        className={inputCls}
                      />
                    </LabeledMini>
                    <LabeledMini label="Quantità">
                      <input
                        inputMode="numeric"
                        value={r.quantita}
                        onChange={(e) => setRiga(i, "quantita", e.target.value)}
                        className={inputCls}
                      />
                    </LabeledMini>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => setRighe((rs) => [...rs!, empty()])}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line py-3 text-[13px] font-semibold text-slate transition hover:border-ink/30 hover:bg-tint"
            >
              <IconPlus width={16} height={16} /> Aggiungi riga
            </button>
          </div>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-xl border border-line px-5 py-3.5 text-[14px] font-semibold text-slate transition hover:bg-line2"
            >
              <IconClose width={16} height={16} /> Rifai scansione
            </button>
            <button
              onClick={confirm}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? (
                <IconSpinner width={18} height={18} />
              ) : (
                <IconCheck width={18} height={18} />
              )}
              Conferma e aggiungi {righe.filter((r) => r.prodotto.trim()).length}{" "}
              prodotti
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink px-4 py-3 text-[13px] font-medium text-white shadow-xl lg:bottom-8">
          <IconCheck width={16} height={16} className="text-brand" />
          {toast}
        </div>
      )}
    </div>
  );
}

function MetaField({
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

function LabeledMini({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium text-muted2">{label}</span>
      {children}
    </label>
  );
}
