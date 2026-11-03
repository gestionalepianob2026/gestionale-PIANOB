import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtEur, fmtNum } from "@/lib/format";
import { caricaFornitori } from "@/lib/fornitori";
import {
  PERIODI,
  calcolaStatistiche,
  type PeriodoKey,
  type RigaOrdine,
} from "@/lib/statistiche";
import {
  IconChart,
  IconTruck,
  IconBox,
  IconAlert,
  IconClipboard,
} from "@/components/icons";

export const dynamic = "force-dynamic";

const GIORNI_ABBR = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
const fmtData = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "numeric",
  month: "short",
});

function inizioStorico(giorni: number | null): Date | null {
  return giorni === null ? null : new Date(Date.now() - Math.max(giorni * 2, 120) * 86_400_000);
}

export default async function StatistichePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const periodo: PeriodoKey = PERIODI.some((x) => x.key === p) ? (p as PeriodoKey) : "30";
  const cfg = PERIODI.find((x) => x.key === periodo)!;

  // I movimenti servono per il periodo, quello precedente (confronto) e 120 giorni
  // di storico (riordino e scorte ferme).
  const storico = inizioStorico(cfg.giorni);

  const [products, movimenti, bolle, fornitori] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        prodotto: true,
        categoria: true,
        fornitore: true,
        prezzoUnit: true,
        ivaRate: true,
        quantita: true,
        sogliaMin: true,
        createdAt: true,
      },
    }),
    prisma.movimento.findMany({
      where: storico ? { createdAt: { gte: storico } } : undefined,
      select: { productId: true, tipo: true, quantita: true, qtaPrima: true, qtaDopo: true, createdAt: true },
    }),
    prisma.bolla.findMany({
      select: { numero: true, fornitore: true, data: true, totale: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    caricaFornitori(prisma),
  ]);

  const s = calcolaStatistiche({ products, movimenti, bolle, fornitori, periodo });
  const k = s.kpi;
  const maxSerie = Math.max(1, ...s.serie.map((x) => Math.max(x.consumo, x.acquisti)));
  const maxDow = Math.max(1, ...s.giorniSettimana);
  const maxTop = Math.max(1, ...s.topConsumo.map((x) => x.pezzi));
  const nOrdini = s.daOrdinare.reduce((n, g) => n + g.righe.length, 0);
  const costoOrdini = s.daOrdinare.reduce((n, g) => n + g.costo, 0);
  const giornoTop = s.giorniSettimana.indexOf(maxDow);

  return (
    <div className="flex flex-col gap-6">
      {/* Intestazione + periodo */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[12.5px] font-medium text-muted2">
            <IconChart width={16} height={16} /> Statistiche
          </p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-tight text-ink">
            Come sta andando il locale
          </h1>
          <p className="mt-1 text-[12.5px] text-muted2">
            Valori a costo, IVA esclusa, salvo dove indicato. Periodo: ultimi{" "}
            {s.periodo.giorni} giorni.
          </p>
        </div>
        <nav className="flex gap-1 rounded-xl border border-line bg-line2 p-1" aria-label="Periodo">
          {PERIODI.map((x) => (
            <Link
              key={x.key}
              href={`/statistiche?p=${x.key}`}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                x.key === periodo ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {x.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="VALORE MAGAZZINO"
          value={fmtEur(k.valoreMagazzino)}
          hint={`${fmtEur(k.valoreMagazzinoLordo)} IVA incl. · ${k.nArticoli} articoli`}
        />
        <Kpi
          label="CONSUMO"
          value={fmtEur(k.consumoValore)}
          delta={delta(k.consumoValore, k.consumoValorePrec)}
          hint={`${fmtNum(Math.round(k.consumoPezzi))} pezzi usciti`}
        />
        <Kpi
          label="ACQUISTI"
          value={fmtEur(k.acquisti)}
          delta={delta(k.acquisti, k.acquistiPrec)}
          hint={`${k.nBolle} bolle · IVA incl.`}
        />
        <Kpi
          label="COPERTURA"
          value={k.coperturaGiorni === null ? "—" : `${fmtNum(Math.round(k.coperturaGiorni))} gg`}
          hint="giorni di scorta al ritmo attuale"
        />
        <Kpi
          label="AMMANCHI"
          value={fmtEur(k.ammancoValore)}
          hint={k.ammancoPezzi > 0 ? `${fmtNum(Math.round(k.ammancoPezzi))} pezzi in meno al conteggio` : "nessuna differenza"}
          danger={k.ammancoValore > 0}
        />
        <Kpi
          label="CAPITALE FERMO"
          value={fmtEur(s.scorteFermeTotale)}
          hint="merce non scaricata da 90+ giorni"
        />
      </div>

      {/* DA FARE: ordini per fornitore */}
      <Section
        icon={<IconTruck width={17} height={17} className="text-danger" />}
        title="Da ordinare"
        right={
          nOrdini > 0 ? (
            <span className="text-[13px] text-muted2">
              {nOrdini} articoli · stima{" "}
              <span className="font-semibold text-ink">{fmtEur(costoOrdini)}</span> (IVA escl.)
            </span>
          ) : undefined
        }
        sub="Solo articoli che si vendono davvero (consumo negli ultimi 60 giorni) e sono sotto soglia o finiranno entro 10 giorni. Quantità suggerita: porta a soglia e copre ~14 giorni."
      >
        {s.daOrdinare.length === 0 ? (
          <Empty
            text={
              s.hasMovimenti
                ? "Niente da ordinare: le scorte dei prodotti venduti sono a posto."
                : "Registra i consumi (sezione Consumi) per avere i suggerimenti di riordino."
            }
          />
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {s.daOrdinare.slice(0, 8).map((g) => (
              <div key={g.fornitore} className="rounded-xl border border-line">
                <div className="flex items-center justify-between gap-2 border-b border-line2 bg-tint px-3.5 py-2.5">
                  <p className="truncate text-[13.5px] font-semibold">{g.fornitore}</p>
                  <span className="shrink-0 text-[12px] font-semibold tabular-nums text-muted">
                    {fmtEur(g.costo)}
                  </span>
                </div>
                <ul className="divide-y divide-line2">
                  {g.righe.slice(0, 8).map((r) => (
                    <RigaOrdineItem key={r.id} r={r} />
                  ))}
                </ul>
                {g.righe.length > 8 && (
                  <p className="px-3.5 py-2 text-[11.5px] text-muted2">
                    + altri {g.righe.length - 8} articoli
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {s.sottoSogliaInattivi > 0 && (
          <p className="mt-4 rounded-lg bg-tint px-3.5 py-2.5 text-[12px] text-muted">
            Altri <b>{s.sottoSogliaInattivi}</b> articoli sono sotto soglia ma non hanno consumi
            recenti: probabilmente la soglia minima è da rivedere (non vengono proposti per
            l&apos;ordine).
          </p>
        )}
      </Section>

      {s.inEsaurimento.length > 0 && (
        <Section
          icon={<IconAlert width={17} height={17} className="text-warn" />}
          title="Stanno per finire (meno di 7 giorni)"
          sub="Giorni di scorta rimasti al ritmo di consumo degli ultimi 60 giorni."
        >
          <ul className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {s.inEsaurimento.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{r.nome}</p>
                  <p className="text-[11.5px] text-muted2">
                    {fmtNum(r.giacenza)} in giacenza · {r.perGiorno.toFixed(1).replace(".", ",")} al giorno
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ${
                    (r.giorniCopertura ?? 0) < 3 ? "bg-danger/10 text-danger" : "bg-warnbg text-warn"
                  }`}
                >
                  {fmtGiorni(r.giorniCopertura)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Andamento */}
      <Section
        icon={<IconChart width={17} height={17} className="text-muted" />}
        title="Andamento: consumo e acquisti"
        sub="Consumo = merce uscita (a costo). Acquisti = bolle registrate."
      >
        {s.serie.length === 0 ? (
          <Empty text="Nessun movimento o bolla nel periodo." />
        ) : (
          <>
            <div className="mt-5 flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 170 }}>
              {s.serie.map((x) => (
                <div key={x.label} className="flex min-w-[26px] flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-[140px] w-full items-end justify-center gap-[3px]">
                    <div
                      className="w-full max-w-[14px] rounded-t bg-ink"
                      style={{ height: `${Math.max(x.consumo > 0 ? 3 : 0, (x.consumo / maxSerie) * 100)}%` }}
                      title={`${x.label} · consumo ${fmtEur(x.consumo)}`}
                    />
                    <div
                      className="w-full max-w-[14px] rounded-t bg-brand-dark"
                      style={{ height: `${Math.max(x.acquisti > 0 ? 3 : 0, (x.acquisti / maxSerie) * 100)}%` }}
                      title={`${x.label} · acquisti ${fmtEur(x.acquisti)}`}
                    />
                  </div>
                  <span className="whitespace-nowrap text-[10px] text-muted2">{x.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-[12px] text-muted2">
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-ink" /> Consumo</span>
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-brand-dark" /> Acquisti</span>
            </div>
          </>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top consumi */}
        <Section title="Prodotti più consumati" sub="Per pezzi, con variazione rispetto al periodo precedente.">
          {s.topConsumo.length === 0 ? (
            <Empty text="Nessun consumo registrato nel periodo." />
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {s.topConsumo.map((r, i) => (
                <li key={r.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-[13px] font-medium">
                      <span className="mr-2 text-[11.5px] font-bold tabular-nums text-muted2">{i + 1}</span>
                      {r.nome}
                    </p>
                    <p className="shrink-0 text-[13px] font-semibold tabular-nums">
                      {fmtNum(Math.round(r.pezzi))} pz
                      {r.variazione !== null && (
                        <span className={`ml-2 text-[11.5px] font-medium ${r.variazione >= 0 ? "text-ok" : "text-danger"}`}>
                          {r.variazione >= 0 ? "▲" : "▼"} {Math.abs(Math.round(r.variazione))}%
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line2">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${(r.pezzi / maxTop) * 100}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted2">{r.categoria} · {fmtEur(r.valore)} a costo</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Per categoria */}
        <Section title="Consumo per categoria" sub="Quota sul valore consumato.">
          {s.consumoCategoria.length === 0 ? (
            <Empty text="Nessun consumo registrato nel periodo." />
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {s.consumoCategoria.map((c) => (
                <li key={c.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[13px] font-medium">{c.name}</p>
                    <p className="shrink-0 text-[13px] font-semibold tabular-nums">
                      {fmtEur(c.valore)} <span className="text-[11.5px] font-medium text-muted2">· {Math.round(c.quota)}%</span>
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line2">
                    <div className="h-full rounded-full bg-brand-dark" style={{ width: `${c.quota}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted2">{fmtNum(Math.round(c.pezzi))} pezzi</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Giorni della settimana */}
        <Section
          title="Quando si consuma di più"
          sub={maxDow > 1 ? `Giorno più forte: ${GIORNI_ABBR[giornoTop]}. Utile per programmare gli ordini e il personale.` : "Pezzi consumati per giorno della settimana."}
        >
          {k.consumoPezzi === 0 ? (
            <Empty text="Nessun consumo registrato nel periodo." />
          ) : (
            <div className="mt-5 flex h-[150px] items-end gap-2">
              {s.giorniSettimana.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] font-semibold tabular-nums text-muted">{v > 0 ? fmtNum(Math.round(v)) : ""}</span>
                  <div
                    className={`w-full rounded-t ${i === giornoTop ? "bg-brand-dark" : "bg-ink"}`}
                    style={{ height: `${Math.max(v > 0 ? 4 : 0, (v / maxDow) * 100)}px`, maxHeight: 100 }}
                  />
                  <span className="text-[11px] text-muted2">{GIORNI_ABBR[i]}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Acquisti per fornitore */}
        <Section title="Acquisti per fornitore" sub="Spesa IVA inclusa nelle bolle del periodo.">
          {s.acquistiFornitore.length === 0 ? (
            <Empty text={s.hasBolle ? "Nessuna bolla nel periodo." : "Carica le bolle per vedere la spesa per fornitore."} />
          ) : (
            <ul className="mt-4 divide-y divide-line2">
              {s.acquistiFornitore.map((f) => (
                <li key={f.name} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{f.name}</p>
                    <p className="text-[11.5px] text-muted2">
                      {f.count} {f.count === 1 ? "bolla" : "bolle"}
                      {f.ultima ? ` · ultima ${fmtData.format(f.ultima)}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">{fmtEur(f.spesa)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Magazzino */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          icon={<IconBox width={17} height={17} className="text-muted" />}
          title="Dove sono i soldi in magazzino"
          sub={`Valore a costo per categoria. I 10 articoli più costosi da soli pesano il ${Math.round(s.concentrazioneTop10)}% del magazzino.`}
        >
          <ul className="mt-4 flex flex-col gap-3">
            {s.valoreCategoria.map((c) => (
              <li key={c.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium">{c.name}</p>
                  <p className="shrink-0 text-[13px] font-semibold tabular-nums">
                    {fmtEur(c.valore)} <span className="text-[11.5px] font-medium text-muted2">· {Math.round(c.quota)}%</span>
                  </p>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line2">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${c.quota}%` }} />
                </div>
                <p className="mt-0.5 text-[11px] text-muted2">{c.count} articoli</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Scorte ferme"
          sub="In giacenza ma senza scarichi da almeno 90 giorni: soldi immobilizzati da smaltire o non riordinare."
          right={s.scorteFerme.length > 0 ? <span className="text-[13px] font-semibold">{fmtEur(s.scorteFermeTotale)}</span> : undefined}
        >
          {s.scorteFerme.length === 0 ? (
            <Empty text={s.hasMovimenti ? "Nessuna scorta ferma rilevata." : "Servono alcuni consumi registrati per individuare le scorte ferme."} />
          ) : (
            <ul className="mt-4 divide-y divide-line2">
              {s.scorteFerme.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{r.nome}</p>
                    <p className="text-[11.5px] text-muted2">
                      {r.categoria} · {r.giorni < 0 ? "mai scaricato" : `fermo da ${r.giorni} giorni`}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">{fmtEur(r.valore)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Controllo */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          icon={<IconClipboard width={17} height={17} className="text-muted" />}
          title="Ammanchi di inventario"
          sub="Differenze trovate quando la giacenza viene corretta in meno: merce sparita, rotta o non registrata."
        >
          {s.ammanchi.length === 0 ? (
            <Empty text="Nessun ammanco nel periodo." />
          ) : (
            <ul className="mt-4 divide-y divide-line2">
              {s.ammanchi.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <p className="min-w-0 truncate text-[13px] font-medium">{r.nome}</p>
                  <span className="shrink-0 text-[13px] tabular-nums">
                    <span className="text-muted2">{fmtNum(Math.round(r.pezzi))} pz · </span>
                    <span className="font-semibold text-danger">{fmtEur(r.valore)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Dati da completare" sub="Statistiche e riordini sono precisi solo se anagrafica e soglie sono a posto.">
          <ul className="mt-4 flex flex-col gap-2.5 text-[13px]">
            <Qualita n={s.qualita.senzaPrezzo} testo="articoli senza prezzo: il valore del magazzino è sottostimato" href="/inventario" />
            <Qualita n={s.qualita.senzaFornitore} testo="articoli senza fornitore: non finiscono negli ordini per fornitore" href="/inventario" />
            <Qualita n={s.qualita.sogliaDefault} testo="articoli con soglia minima di default (3): adattala ai consumi reali" href="/inventario" />
          </ul>
          {s.ultimeBolle.length > 0 && (
            <>
              <p className="mt-5 text-[11px] font-semibold tracking-wide text-muted2">ULTIME BOLLE</p>
              <ul className="mt-1 divide-y divide-line2">
                {s.ultimeBolle.map((b, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate">
                      {fmtData.format(b.data)} · {b.fornitore ?? "Senza fornitore"}
                      {b.numero ? ` · n. ${b.numero}` : ""}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{fmtEur(b.totale)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function delta(attuale: number, prec: number | null): { pct: number | null; testo: string } | undefined {
  if (prec === null) return undefined;
  if (prec <= 0) return { pct: null, testo: attuale > 0 ? "nuovo rispetto al periodo prima" : "" };
  const pct = ((attuale - prec) / prec) * 100;
  return { pct, testo: `${pct >= 0 ? "+" : ""}${Math.round(pct)}% sul periodo prima` };
}

function fmtGiorni(g: number | null): string {
  if (g === null) return "—";
  if (g < 1) return "< 1 giorno";
  return `${Math.floor(g)} ${Math.floor(g) === 1 ? "giorno" : "giorni"}`;
}

function Kpi({
  label,
  value,
  hint,
  delta,
  danger,
}: {
  label: string;
  value: string;
  hint: string;
  delta?: { pct: number | null; testo: string };
  danger?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <p className="truncate text-[10.5px] font-semibold tracking-wide text-muted2">{label}</p>
      <p
        className={`mt-1.5 truncate text-[clamp(17px,4.6vw,23px)] font-semibold leading-tight tracking-tight tabular-nums ${
          danger ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
      {delta?.testo && (
        <p className="mt-0.5 text-[11.5px] font-medium text-muted">{delta.pct !== null ? (delta.pct >= 0 ? "▲ " : "▼ ") : ""}{delta.testo}</p>
      )}
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted2">{hint}</p>
    </div>
  );
}

function Section({
  title,
  sub,
  icon,
  right,
  children,
}: {
  title: string;
  sub?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          {icon}
          {title}
        </h2>
        {right}
      </div>
      {sub && <p className="mt-0.5 text-[12px] leading-snug text-muted2">{sub}</p>}
      {children}
    </section>
  );
}

function RigaOrdineItem({ r }: { r: RigaOrdine }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium">{r.nome}</p>
        <p className="text-[11px] text-muted2">
          {fmtNum(r.giacenza)} in giacenza · {fmtGiorni(r.giorniCopertura)} di scorta
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-[12px] font-bold tabular-nums text-black">
        ordina {fmtNum(r.daOrdinare)}
      </span>
    </li>
  );
}

function Qualita({ n, testo, href }: { n: number; testo: string; href: string }) {
  if (n === 0)
    return (
      <li className="flex items-start gap-2 text-ok">
        <span>✓</span>
        <span className="text-muted">{testo.split(":")[0]}: tutto a posto</span>
      </li>
    );
  return (
    <li>
      <Link href={href} className="flex items-start gap-2 hover:underline">
        <span className="shrink-0 rounded-full bg-warnbg px-2 py-0.5 text-[12px] font-bold tabular-nums text-warn">{n}</span>
        <span className="text-slate">{testo}</span>
      </Link>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mt-6 text-center text-[13px] text-muted2">{text}</p>;
}
