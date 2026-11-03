"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtNum, type ProductDTO } from "@/lib/format";
import { ProductPicker } from "@/components/ProductPicker";
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

type Candidato = { id: string; prodotto: string; quantita: number };
type Riga = {
  prodotto: string;
  categoria: string;
  fornitore: string;
  prezzoUnit: string;
  ivaRate: string;
  quantita: string;
  um: string;
  dubbia: boolean;
  nota: string | null;
  productId: string | null; // articolo esistente da caricare (null = nuovo articolo)
  certo: boolean; // abbinamento sicuro (alias/nome identico) o solo proposto
  candidati: Candidato[];
};
type Meta = { numero: string; fornitore: string; data: string };

const empty = (): Riga => ({
  prodotto: "",
  categoria: "Altro",
  fornitore: "",
  prezzoUnit: "",
  ivaRate: "22",
  quantita: "1",
  um: "",
  dubbia: false,
  nota: null,
  productId: null,
  certo: true,
  candidati: [],
});

const inputCls =
  "w-full rounded-[9px] border border-line bg-tint px-3 py-2 text-[13.5px] text-ink outline-none transition focus:border-ink/30 focus:bg-white tabular-nums";

const ACCEPT =
  "image/*,application/pdf,.pdf,.xlsx,.csv,.txt,.xml,.p7m";
const MAX_FILES = 6;

function isImage(f: File) {
  return f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(f.name);
}

/**
 * Riduce le foto del telefono (spesso 5-12 MB) a max 2400 px / JPEG: l'AI le
 * legge meglio e più in fretta, rientrano nel limite di 5 MB dell'API e si
 * corregge l'orientamento EXIF. Se qualcosa va storto restituisce l'originale.
 */
async function comprimiImmagine(f: File): Promise<File> {
  if (!isImage(f) || /\.gif$/i.test(f.name)) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    const MAX = 2400;
    const scala = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (scala === 1 && f.size < 1_500_000 && /jpe?g/i.test(f.type)) {
      bmp.close();
      return f;
    }
    const w = Math.round(bmp.width * scala);
    const h = Math.round(bmp.height * scala);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.88),
    );
    if (!blob || blob.size >= f.size * 1.05) return blob && blob.size < f.size ? new File([blob], f.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : f;
    return new File([blob], f.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return f;
  }
}

function numOr(v: string, def: number) {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : def;
}

export function ScanClient({
  categorie,
  products,
  aiEnabled,
}: {
  categorie: string[];
  products: ProductDTO[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [fonte, setFonte] = useState<"ai" | "xml" | null>(null);
  const [meta, setMeta] = useState<Meta>({ numero: "", fornitore: "", data: "" });
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setPreparing(true);
    try {
      const nuovi: File[] = [];
      const anteprime: Record<string, string> = {};
      for (const f of Array.from(list)) {
        const pronto = await comprimiImmagine(f);
        nuovi.push(pronto);
        if (isImage(pronto)) anteprime[pronto.name + pronto.size] = URL.createObjectURL(pronto);
      }
      setFiles((prev) => [...prev, ...nuovi].slice(0, MAX_FILES));
      setPreviews((p) => ({ ...p, ...anteprime }));
      if (files.length + nuovi.length > MAX_FILES)
        setError(`Massimo ${MAX_FILES} file per volta: ho tenuto i primi ${MAX_FILES}.`);
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeFile(i: number) {
    setFiles((fs) => fs.filter((_, j) => j !== i));
  }

  async function analyze() {
    if (files.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/scan", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Errore durante l'analisi");
        if (data.code === "NO_API_KEY") setRighe([empty()]); // inserimento manuale
        return;
      }
      setFonte(data.fonte ?? "ai");
      setAvvisi(Array.isArray(data.avvisi) ? data.avvisi : []);
      setMeta({
        numero: data.numero ?? "",
        fornitore: data.fornitore ?? "",
        data: data.data ?? "",
      });
      const lette: Riga[] = (data.righe ?? []).map((r: Record<string, unknown>) => {
        const match = r.match as { id: string; certo: boolean } | null;
        return {
          prodotto: String(r.prodotto ?? ""),
          categoria: String(r.categoria ?? "Altro"),
          fornitore: String(r.fornitore ?? data.fornitore ?? ""),
          prezzoUnit: r.prezzoUnit ? String(r.prezzoUnit).replace(".", ",") : "",
          ivaRate: String(r.ivaRate ?? "22"),
          quantita: String(r.quantita ?? "1").replace(".", ","),
          um: String(r.um ?? ""),
          dubbia: r.dubbia === true,
          nota: (r.nota as string | null) ?? null,
          productId: match?.id ?? null,
          certo: match?.certo ?? true,
          candidati: (r.candidati as Candidato[]) ?? [],
        };
      });
      setRighe(lette.length ? lette : [empty()]);
      if (lette.length === 0)
        setError("Nessuna riga rilevata. Aggiungile a mano o riprova con una foto più nitida.");
    } catch {
      setError("Errore di rete durante l'analisi.");
    } finally {
      setAnalyzing(false);
    }
  }

  function setRiga(i: number, patch: Partial<Riga>) {
    setRighe((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function removeRiga(i: number) {
    setRighe((rs) => rs!.filter((_, j) => j !== i));
  }

  function reset() {
    setFiles([]);
    setPreviews({});
    setRighe(null);
    setAvvisi([]);
    setFonte(null);
    setMeta({ numero: "", fornitore: "", data: "" });
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const valide = (righe ?? []).filter((r) => r.prodotto.trim() && numOr(r.quantita, 0) > 0);
  const nAgg = valide.filter((r) => r.productId).length;
  const nNuovi = valide.length - nAgg;
  const totale = valide.reduce(
    (s, r) => s + numOr(r.prezzoUnit, 0) * (1 + numOr(r.ivaRate, 22) / 100) * numOr(r.quantita, 0),
    0,
  );

  async function confirm() {
    if (valide.length === 0) {
      setError("Aggiungi almeno un prodotto con quantità.");
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
            prezzoUnit: numOr(r.prezzoUnit, 0),
            ivaRate: numOr(r.ivaRate, 22),
            quantita: numOr(r.quantita, 0),
            productId: r.productId,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setToast(
        `${data.aggiornati} articoli caricati in giacenza${data.nuovi ? ` · ${data.nuovi} nuovi inseriti` : ""}`,
      );
      setTimeout(() => {
        router.push("/inventario");
        router.refresh();
      }, 1100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[30px] font-semibold tracking-tight">Scansiona bolla</h1>
      <p className="mt-1 text-[13px] text-muted2">
        Carica foto (anche scritte a mano), PDF, Excel/CSV o fattura elettronica
        XML: il software legge le righe e le carica sugli articoli già in
        magazzino. Tu controlli e confermi.
      </p>

      {!aiEnabled && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warnbg/60 px-4 py-3 text-[12.5px] text-[#92400e]">
          <IconAlert width={16} height={16} className="mt-0.5 shrink-0" />
          <span>
            La lettura AI non è attiva (manca la chiave API sul server).
            Le fatture elettroniche XML funzionano comunque; per foto, PDF ed
            Excel serve la chiave.
          </span>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {!righe && (
        <div className="mt-5">
          {files.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={preparing}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line bg-tint py-16 text-center transition hover:border-ink/30"
            >
              <span className="grid size-14 place-items-center rounded-2xl bg-brand text-black">
                {preparing ? <IconSpinner width={26} height={26} /> : <IconCamera width={26} height={26} />}
              </span>
              <span className="text-[15px] font-semibold">
                Carica foto, PDF, Excel o fattura XML
              </span>
              <span className="px-4 text-[12.5px] text-muted2">
                Puoi selezionare più foto/pagine dello stesso documento · galleria, fotocamera o file
              </span>
            </button>
          ) : (
            <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              <ul className="flex flex-col gap-2">
                {files.map((f, i) => {
                  const src = previews[f.name + f.size];
                  return (
                    <li key={i} className="flex items-center gap-3 rounded-xl bg-tint p-2.5">
                      {src ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={src} alt="" className="size-14 rounded-lg object-cover" />
                      ) : (
                        <span className="grid size-14 place-items-center rounded-lg bg-white text-ink">
                          <IconDoc width={22} height={22} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold">{f.name}</p>
                        <p className="text-[11.5px] text-muted2">
                          {(f.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        onClick={() => removeFile(i)}
                        className="grid size-8 place-items-center rounded-lg text-muted2 hover:bg-line2 hover:text-danger"
                        aria-label="Rimuovi file"
                      >
                        <IconClose width={15} height={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex flex-wrap gap-3">
                {files.length < MAX_FILES && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={preparing || analyzing}
                    className="flex items-center gap-2 rounded-xl border border-line px-4 py-3 text-[13px] font-semibold text-slate transition hover:bg-line2"
                  >
                    {preparing ? <IconSpinner width={16} height={16} /> : <IconPlus width={16} height={16} />}
                    Aggiungi pagina/file
                  </button>
                )}
                <button
                  onClick={analyze}
                  disabled={analyzing || preparing}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:opacity-60"
                >
                  {analyzing ? (
                    <>
                      <IconSpinner width={18} height={18} /> Lettura in corso…
                    </>
                  ) : (
                    <>
                      <IconScan width={18} height={18} /> Leggi il documento
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
          {fonte === "xml" && (
            <p className="rounded-xl bg-ok/10 px-4 py-2.5 text-[12.5px] font-medium text-ok">
              Fattura elettronica letta direttamente dal file: dati esatti, nessuna stima.
            </p>
          )}
          {avvisi.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-warn/30 bg-warnbg/60 px-4 py-3 text-[12.5px] text-[#92400e]">
              {avvisi.map((a, i) => (
                <p key={i} className="flex items-start gap-2">
                  <IconAlert width={15} height={15} className="mt-0.5 shrink-0" />
                  <span>{a}</span>
                </p>
              ))}
            </div>
          )}

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
                onChange={(e) => setMeta((m) => ({ ...m, fornitore: e.target.value }))}
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

          <datalist id="scan-cats">
            {categorie.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="flex flex-col gap-3">
            {righe.map((r, i) => {
              const prod = r.productId ? byId.get(r.productId) : undefined;
              const q = numOr(r.quantita, 0);
              return (
                <div
                  key={i}
                  className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)] ${
                    r.dubbia ? "border-warn/60" : "border-line"
                  }`}
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

                  {r.dubbia && r.nota && (
                    <p className="mb-2.5 flex items-start gap-2 rounded-lg bg-warnbg px-3 py-2 text-[12px] font-medium text-[#92400e]">
                      <IconAlert width={14} height={14} className="mt-0.5 shrink-0" />
                      {r.nota}
                    </p>
                  )}
                  {!r.dubbia && r.nota && (
                    <p className="mb-2.5 text-[12px] text-muted2">{r.nota}</p>
                  )}

                  <div className="flex flex-col gap-2.5">
                    <input
                      value={r.prodotto}
                      onChange={(e) => setRiga(i, { prodotto: e.target.value })}
                      placeholder="Prodotto"
                      className={inputCls}
                    />

                    {/* Abbinamento al magazzino */}
                    <div className="rounded-xl bg-tint px-3 py-2.5">
                      {prod ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                              r.certo ? "bg-ok/10 text-ok" : "bg-warnbg text-warn"
                            }`}
                          >
                            {r.certo ? "ARTICOLO IN MAGAZZINO" : "DA CONFERMARE"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {prod.prodotto}
                          </span>
                          <span className="text-[12px] tabular-nums text-muted2">
                            {fmtNum(prod.quantita)} → {fmtNum(prod.quantita + q)}
                          </span>
                        </div>
                      ) : (
                        <span className="rounded-full bg-line2 px-2 py-0.5 text-[10.5px] font-semibold text-muted">
                          NUOVO ARTICOLO
                        </span>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {r.candidati.slice(0, 3).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setRiga(i, { productId: c.id, certo: true })}
                            className="max-w-full truncate rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-medium text-slate transition hover:border-ink/30"
                            title={`Usa: ${c.prodotto}`}
                          >
                            {c.prodotto}
                          </button>
                        ))}
                        <button
                          onClick={() => setPickerFor(i)}
                          className="rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-muted transition hover:border-ink/30 hover:text-ink"
                        >
                          {prod ? "Cambia articolo" : "Cerca in magazzino"}
                        </button>
                        {prod && (
                          <button
                            onClick={() => setRiga(i, { productId: null, certo: true })}
                            className="rounded-lg px-2 py-1 text-[11.5px] font-medium text-muted2 hover:text-danger"
                          >
                            Crea come nuovo
                          </button>
                        )}
                      </div>
                    </div>

                    {!prod && (
                      <div className="grid grid-cols-2 gap-2.5">
                        <input
                          value={r.categoria}
                          onChange={(e) => setRiga(i, { categoria: e.target.value })}
                          placeholder="Categoria"
                          list="scan-cats"
                          className={inputCls}
                        />
                        <input
                          value={r.fornitore}
                          onChange={(e) => setRiga(i, { fornitore: e.target.value })}
                          placeholder="Fornitore"
                          className={inputCls}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-4 gap-2.5">
                      <LabeledMini label="Quantità">
                        <input
                          inputMode="decimal"
                          value={r.quantita}
                          onChange={(e) => setRiga(i, { quantita: e.target.value })}
                          className={inputCls}
                        />
                      </LabeledMini>
                      <LabeledMini label="Unità">
                        <input
                          value={r.um}
                          onChange={(e) => setRiga(i, { um: e.target.value })}
                          className={inputCls}
                          placeholder="PZ"
                        />
                      </LabeledMini>
                      <LabeledMini label="Prezzo netto €">
                        <input
                          inputMode="decimal"
                          value={r.prezzoUnit}
                          onChange={(e) => setRiga(i, { prezzoUnit: e.target.value, dubbia: false })}
                          className={inputCls}
                          placeholder="0,00"
                        />
                      </LabeledMini>
                      <LabeledMini label="IVA %">
                        <input
                          inputMode="numeric"
                          value={r.ivaRate}
                          onChange={(e) => setRiga(i, { ivaRate: e.target.value })}
                          className={inputCls}
                        />
                      </LabeledMini>
                    </div>
                  </div>
                </div>
              );
            })}
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

          <div className="flex items-center justify-between rounded-xl bg-tint px-4 py-3 text-[13px]">
            <span className="text-muted2">
              {nAgg} in giacenza · {nNuovi} nuovi
            </span>
            <span className="font-semibold tabular-nums">
              Totale IVA incl. ≈ {totale.toFixed(2).replace(".", ",")} €
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-xl border border-line px-5 py-3.5 text-[14px] font-semibold text-slate transition hover:bg-line2"
            >
              <IconClose width={16} height={16} /> Ricomincia
            </button>
            <button
              onClick={confirm}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? <IconSpinner width={18} height={18} /> : <IconCheck width={18} height={18} />}
              Conferma e carica {valide.length} {valide.length === 1 ? "riga" : "righe"}
            </button>
          </div>
        </div>
      )}

      {pickerFor !== null && righe?.[pickerFor] && (
        <ProductPicker
          products={products}
          termine={righe[pickerFor].prodotto}
          onPick={(p) => {
            setRiga(pickerFor, { productId: p.id, certo: true });
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
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

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-muted2">{label}</span>
      {children}
    </label>
  );
}

function LabeledMini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium text-muted2">{label}</span>
      {children}
    </label>
  );
}
