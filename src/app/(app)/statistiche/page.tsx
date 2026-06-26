import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtEur, fmtNum, valoreRiga, isLow } from "@/lib/format";
import {
  IconChart,
  IconTrend,
  IconTruck,
  IconBox,
  IconAlert,
  IconArrowDown,
  IconClipboard,
} from "@/components/icons";

export const dynamic = "force-dynamic";

const CAT_COLORS = [
  "#0A0A0A",
  "#DCFC5C",
  "#0EA5E9",
  "#A855F7",
  "#16A34A",
  "#D97706",
  "#DC2626",
  "#6B7280",
];

const MESI = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
];

export default async function StatistichePage() {
  const [products, bolle, movimenti] = await Promise.all([
    prisma.product.findMany({
      select: {
        prodotto: true,
        categoria: true,
        fornitore: true,
        prezzoUnit: true,
        ivaRate: true,
        quantita: true,
        sogliaMin: true,
      },
    }),
    prisma.bolla.findMany({
      select: {
        fornitore: true,
        data: true,
        totale: true,
        createdAt: true,
      },
    }),
    prisma.movimento.findMany({
      select: {
        tipo: true,
        quantita: true,
        qtaPrima: true,
        qtaDopo: true,
        createdAt: true,
        product: { select: { prodotto: true, categoria: true } },
      },
    }),
  ]);

  // —— Magazzino: valore, categorie, IVA, top articoli, sotto scorta ——
  let vTot = 0;
  let nLow = 0;
  const cats = new Map<string, { count: number; value: number }>();
  const iva = new Map<number, { imponibile: number; iva: number }>();
  const topArt: { nome: string; categoria: string; value: number }[] = [];

  for (const p of products) {
    const v = valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita);
    vTot += v;
    if (isLow(p)) nLow += 1;

    const c = cats.get(p.categoria) ?? { count: 0, value: 0 };
    c.count += 1;
    c.value += v;
    cats.set(p.categoria, c);

    const imp = p.prezzoUnit * p.quantita;
    const i = iva.get(p.ivaRate) ?? { imponibile: 0, iva: 0 };
    i.imponibile += imp;
    i.iva += imp * (p.ivaRate / 100);
    iva.set(p.ivaRate, i);

    topArt.push({ nome: p.prodotto, categoria: p.categoria, value: v });
  }

  const catList = [...cats.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value);

  const ivaList = [...iva.entries()]
    .map(([rate, v]) => ({ rate, ...v, totale: v.imponibile + v.iva }))
    .sort((a, b) => a.rate - b.rate);

  const topArticoli = topArt
    .filter((a) => a.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // —— Acquisti (bolle): spesa totale, andamento mensile, fornitori ——
  let spesaTot = 0;
  const perMese = new Map<string, number>(); // "YYYY-MM" -> spesa
  const perFornitore = new Map<string, { spesa: number; count: number }>();

  for (const b of bolle) {
    spesaTot += b.totale;
    const d = b.data ?? b.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    perMese.set(key, (perMese.get(key) ?? 0) + b.totale);

    const f = (b.fornitore ?? "").trim() || "Senza fornitore";
    const cur = perFornitore.get(f) ?? { spesa: 0, count: 0 };
    cur.spesa += b.totale;
    cur.count += 1;
    perFornitore.set(f, cur);
  }

  const mesiList = [...perMese.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([key, spesa]) => {
      const [y, m] = key.split("-").map(Number);
      return { label: `${MESI[m]} ${String(y).slice(2)}`, spesa };
    });
  const maxMese = Math.max(1, ...mesiList.map((m) => m.spesa));

  const fornitoriList = [...perFornitore.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.spesa - a.spesa)
    .slice(0, 8);

  const hasBolle = bolle.length > 0;

  // —— Consumi reali (movimenti di fine turno) ——
  let consumoTot = 0; // pezzi usciti
  let caricoTot = 0; // pezzi entrati
  const consumoMese = new Map<string, number>();
  const consumoCat = new Map<string, number>();
  const consumoProd = new Map<string, { categoria: string; qta: number }>();

  for (const m of movimenti) {
    const uscita = Math.max(0, m.qtaPrima - m.qtaDopo); // scarico o rettifica in meno
    const entrata = Math.max(0, m.qtaDopo - m.qtaPrima); // carico o rettifica in più
    caricoTot += entrata;
    if (uscita <= 0) continue;
    consumoTot += uscita;

    const d = m.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    consumoMese.set(key, (consumoMese.get(key) ?? 0) + uscita);

    const cat = m.product?.categoria ?? "—";
    consumoCat.set(cat, (consumoCat.get(cat) ?? 0) + uscita);

    const nome = m.product?.prodotto ?? "—";
    const cur = consumoProd.get(nome) ?? { categoria: cat, qta: 0 };
    cur.qta += uscita;
    consumoProd.set(nome, cur);
  }

  const consumoMesiList = [...consumoMese.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([key, qta]) => {
      const [y, m] = key.split("-").map(Number);
      return { label: `${MESI[m]} ${String(y).slice(2)}`, qta };
    });
  const maxConsumoMese = Math.max(1, ...consumoMesiList.map((m) => m.qta));

  const consumoCatList = [...consumoCat.entries()]
    .map(([name, qta]) => ({ name, qta }))
    .sort((a, b) => b.qta - a.qta)
    .slice(0, 8);

  const topConsumo = [...consumoProd.entries()]
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.qta - a.qta)
    .slice(0, 8);

  const hasMovimenti = movimenti.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Intestazione */}
      <div>
        <p className="flex items-center gap-2 text-[12.5px] font-medium text-muted2">
          <IconChart width={16} height={16} />
          Statistiche
        </p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight text-ink">
          Consumi e acquisti
        </h1>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="VALORE MAGAZZINO"
          value={fmtEur(vTot)}
          hint={`IVA inclusa · ${products.length} articoli`}
        />
        <StatCard
          label="SPESA ACQUISTI"
          value={fmtEur(spesaTot)}
          hint={`${bolle.length} bolle registrate`}
        />
        <StatCard
          label="SCONTRINO MEDIO"
          value={fmtEur(hasBolle ? spesaTot / bolle.length : 0)}
          hint="per bolla"
        />
        <StatCard
          label="SOTTO SCORTA"
          value={String(nLow)}
          hint="da riordinare"
          danger={nLow > 0}
        />
      </div>

      {/* Consumi reali (movimenti di fine turno) */}
      {!hasMovimenti ? (
        <section className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-line bg-tint p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <IconArrowDown width={17} height={17} />
            Consumi reali
          </h2>
          <p className="text-[13px] text-muted2">
            Nessun movimento ancora registrato. Usa <b>Consumi</b> per scalare i
            prodotti usati: i consumi reali appariranno qui.
          </p>
          <Link
            href="/giacenza"
            className="mt-1 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-black transition hover:bg-brand-dark"
          >
            <IconClipboard width={16} height={16} /> Vai a Consumi
          </Link>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="CONSUMATO (PEZZI)"
              value={fmtNum(consumoTot)}
              hint={`${movimenti.length} movimenti`}
            />
            <StatCard
              label="CARICATO (PEZZI)"
              value={fmtNum(caricoTot)}
              hint="rifornimenti registrati"
            />
            <StatCard
              label="SALDO NETTO"
              value={fmtNum(caricoTot - consumoTot)}
              hint="carichi − scarichi"
              danger={caricoTot - consumoTot < 0}
            />
            <StatCard
              label="CONSUMO MEDIO/MESE"
              value={fmtNum(
                consumoMesiList.length
                  ? Math.round(consumoTot / consumoMesiList.length)
                  : 0,
              )}
              hint="pezzi al mese"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <section className="lg:col-span-2 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                <IconArrowDown width={17} height={17} className="text-danger" />
                Consumi per mese
              </h2>
              <div className="mt-5 flex h-48 items-end gap-2">
                {consumoMesiList.map((m) => (
                  <div
                    key={m.label}
                    className="flex flex-1 flex-col items-center gap-2"
                  >
                    <span className="text-[10px] font-semibold tabular-nums text-muted2">
                      {fmtNum(Math.round(m.qta))}
                    </span>
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t-md bg-danger/80 transition-all"
                        style={{
                          height: `${Math.max(4, (m.qta / maxConsumoMese) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-medium capitalize text-muted2">
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              <h2 className="text-[15px] font-semibold tracking-tight">
                Più consumati
              </h2>
              <ul className="mt-4 flex flex-col divide-y divide-line2">
                {topConsumo.map((a, i) => (
                  <li
                    key={`${a.nome}-${i}`}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="w-4 shrink-0 text-[12px] font-bold tabular-nums text-muted2">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">
                          {a.nome}
                        </p>
                        <p className="text-[11.5px] text-muted2">{a.categoria}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-danger">
                      −{fmtNum(a.qta)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {consumoCatList.length > 0 && (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              <h2 className="text-[15px] font-semibold tracking-tight">
                Consumo per categoria
              </h2>
              <div className="mt-4 flex flex-col gap-3.5">
                {consumoCatList.map((c, i) => {
                  const pct = consumoTot ? (c.qta / consumoTot) * 100 : 0;
                  return (
                    <div key={c.name} className="flex items-center gap-3">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: CAT_COLORS[i % CAT_COLORS.length] }}
                      />
                      <span className="w-28 shrink-0 truncate text-[13px] font-medium">
                        {c.name}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line2">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: CAT_COLORS[i % CAT_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right text-[13px] font-semibold tabular-nums">
                        {fmtNum(c.qta)} pz
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* Andamento acquisti + Fornitori */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <IconTrend width={17} height={17} />
            Andamento acquisti
          </h2>
          {mesiList.length === 0 ? (
            <Empty text="Nessuna bolla registrata: scansiona una bolla per vedere l'andamento." />
          ) : (
            <div className="mt-5 flex h-48 items-end gap-2">
              {mesiList.map((m) => (
                <div
                  key={m.label}
                  className="flex flex-1 flex-col items-center gap-2"
                >
                  <span className="text-[10px] font-semibold tabular-nums text-muted2">
                    {m.spesa >= 1000
                      ? `${(m.spesa / 1000).toFixed(1)}k`
                      : Math.round(m.spesa)}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-md bg-brand transition-all"
                      style={{
                        height: `${Math.max(4, (m.spesa / maxMese) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-medium capitalize text-muted2">
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <IconTruck width={17} height={17} />
            Spesa per fornitore
          </h2>
          {fornitoriList.length === 0 ? (
            <Empty text="Nessun fornitore ancora." />
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-line2">
              {fornitoriList.map((f) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{f.name}</p>
                    <p className="text-[11.5px] text-muted2">
                      {f.count} {f.count === 1 ? "bolla" : "bolle"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                    {fmtEur(f.spesa)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Valore per categoria + Ripartizione IVA */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <IconBox width={17} height={17} />
            Valore per categoria
          </h2>
          <div className="mt-4 flex flex-col gap-3.5">
            {catList.slice(0, 8).map((c, i) => {
              const pct = vTot ? (c.value / vTot) * 100 : 0;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: CAT_COLORS[i % CAT_COLORS.length] }}
                  />
                  <span className="w-28 shrink-0 truncate text-[13px] font-medium">
                    {c.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line2">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: CAT_COLORS[i % CAT_COLORS.length],
                      }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-muted2">
                    {pct.toFixed(0)}%
                  </span>
                  <span className="w-24 shrink-0 text-right text-[13px] font-semibold tabular-nums">
                    {fmtEur(c.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Ripartizione IVA
          </h2>
          <ul className="mt-4 flex flex-col divide-y divide-line2">
            {ivaList.map((r) => (
              <li key={r.rate} className="flex flex-col gap-0.5 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-tint px-2.5 py-1 text-[12px] font-semibold">
                    IVA {fmtNum(r.rate)}%
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums">
                    {fmtEur(r.totale)}
                  </span>
                </div>
                <p className="text-[11.5px] text-muted2">
                  Imponibile {fmtEur(r.imponibile)} · IVA {fmtEur(r.iva)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Top articoli per valore */}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <IconAlert width={17} height={17} className="text-brand-dark" />
          Articoli a maggior valore di giacenza
        </h2>
        {topArticoli.length === 0 ? (
          <Empty text="Nessun articolo con giacenza valorizzata." />
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {topArticoli.map((a, i) => (
              <li
                key={`${a.nome}-${i}`}
                className="flex items-center justify-between gap-3 border-b border-line2 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-5 shrink-0 text-[12px] font-bold tabular-nums text-muted2">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{a.nome}</p>
                    <p className="text-[11.5px] text-muted2">{a.categoria}</p>
                  </div>
                </div>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                  {fmtEur(a.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <p className="truncate text-[10.5px] font-semibold tracking-wide text-muted2">
        {label}
      </p>
      <p
        className={`mt-1.5 truncate text-[clamp(18px,5.5vw,26px)] font-semibold leading-tight tracking-tight tabular-nums ${
          danger ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[12px] text-muted2">{hint}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="mt-6 text-center text-[13px] text-muted2">{text}</p>
  );
}
