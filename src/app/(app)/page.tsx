import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { fmtEur, fmtNum, valoreRiga, isLow } from "@/lib/format";
import {
  IconScan,
  IconAlert,
  IconBox,
  IconChevron,
  IconClipboard,
  IconChart,
} from "@/components/icons";

export const dynamic = "force-dynamic";

function giorniFa(n: number) {
  return new Date(Date.now() - n * 86400000);
}

function greeting(d: Date) {
  // il server gira in UTC: l'ora va letta nel fuso di Roma
  const h = Number(
    new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "numeric", hourCycle: "h23" }).format(d),
  );
  if (h < 12) return "Buongiorno";
  if (h < 18) return "Buon pomeriggio";
  return "Buonasera";
}

export default async function DashboardPage() {
  const d90 = giorniFa(90);
  const [user, products, lastBolla, usati90] = await Promise.all([
    getSession(),
    prisma.product.findMany({
      select: {
        id: true,
        prodotto: true,
        categoria: true,
        prezzoUnit: true,
        ivaRate: true,
        quantita: true,
        sogliaMin: true,
        fornitore: true,
      },
    }),
    prisma.bolla.findFirst({ orderBy: { createdAt: "desc" } }),
    // consumo per articolo: mette in cima a "Da riordinare" ciò che si usa davvero
    prisma.movimento.groupBy({
      by: ["productId"],
      where: { tipo: "SCARICO", createdAt: { gte: d90 } },
      _sum: { quantita: true },
    }),
  ]);

  const uso = new Map(usati90.map((u) => [u.productId, u._sum.quantita ?? 0]));

  const now = new Date();
  let vTot = 0;
  const low: typeof products = [];
  for (const p of products) {
    vTot += valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita);
    if (isLow(p)) low.push(p);
  }

  const priorita = (p: (typeof products)[number]) => {
    if ((uso.get(p.id) ?? 0) > 0) return 0;
    return p.quantita > 0 ? 1 : 2;
  };
  const lowSorted = [...low].sort(
    (a, b) =>
      priorita(a) - priorita(b) ||
      (uso.get(b.id) ?? 0) - (uso.get(a.id) ?? 0) ||
      a.quantita - b.quantita,
  );
  const mostrati = lowSorted.slice(0, 5);

  const dateStr = now.toLocaleDateString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      {/* Saluto */}
      <div>
        <p className="text-[12.5px] font-medium capitalize text-muted2">{dateStr}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
          {greeting(now)}, {user?.name.split(" ")[0] ?? "crew"}
        </h1>
      </div>

      {/* Cerca un prodotto */}
      <form action="/inventario" method="get" className="relative">
        <input
          name="q"
          type="search"
          placeholder="Cerca un prodotto in magazzino…"
          autoComplete="off"
          className="w-full rounded-2xl border border-line bg-white px-4 py-4 text-[15px] text-ink shadow-[0_1px_2px_rgba(16,24,40,.04)] outline-none transition placeholder:text-muted2 focus:border-ink/30"
        />
      </form>

      {/* Azioni rapide */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/scansiona"
          className="flex flex-col justify-between gap-6 rounded-2xl bg-brand p-5 text-black transition hover:bg-brand-dark"
        >
          <IconScan width={26} height={26} />
          <div>
            <p className="text-[17px] font-semibold leading-tight">Scansiona bolla</p>
            <p className="mt-0.5 text-[12.5px] text-black/60">Foto, PDF o Excel</p>
          </div>
        </Link>
        <Link
          href="/giacenza"
          className="flex flex-col justify-between gap-6 rounded-2xl bg-ink p-5 text-white transition hover:bg-black/85"
        >
          <IconClipboard width={26} height={26} />
          <div>
            <p className="text-[17px] font-semibold leading-tight">Consumi</p>
            <p className="mt-0.5 text-[12.5px] text-white/60">Scarica i prodotti usati</p>
          </div>
        </Link>
        <TileLink href="/inventario" icon={<IconBox width={20} height={20} />} title="Inventario" />
        <TileLink href="/statistiche" icon={<IconChart width={20} height={20} />} title="Statistiche" />
      </div>

      {/* Numeri essenziali */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="MAGAZZINO" value={fmtEur(vTot)} hint={`${fmtNum(products.length)} articoli`} />
        <Kpi
          label="SOTTO SCORTA"
          value={fmtNum(low.length)}
          hint={low.length === 0 ? "tutto ok" : "da riordinare"}
          danger={low.length > 0}
        />
        <Kpi
          label="ULTIMA BOLLA"
          value={
            lastBolla
              ? (lastBolla.data ?? lastBolla.createdAt).toLocaleDateString("it-IT", {
                  timeZone: "Europe/Rome",
                  day: "2-digit",
                  month: "2-digit",
                })
              : "—"
          }
          hint={lastBolla?.fornitore ?? "nessuna ancora"}
        />
      </div>

      {/* Da riordinare */}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <IconAlert width={17} height={17} className="text-danger" />
            Da riordinare
          </h2>
          <Link href="/statistiche" className="text-[12.5px] font-medium text-muted hover:text-ink">
            Ordini per fornitore
          </Link>
        </div>

        {mostrati.length === 0 ? (
          <p className="mt-5 text-center text-[13px] text-muted2">Tutto sotto controllo 🎉</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-line2">
            {mostrati.map((p) => {
              const finito = p.quantita <= 0;
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{p.prodotto}</p>
                    <p className="truncate text-[11.5px] text-muted2">{p.fornitore ?? p.categoria}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                      finito ? "bg-danger/10 text-danger" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {finito ? "Finito" : `${fmtNum(p.quantita)} pz`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {low.length > mostrati.length && (
          <Link
            href="/inventario?low=1"
            className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-tint py-2.5 text-[13px] font-medium text-slate transition hover:text-ink"
          >
            Vedi tutti i {fmtNum(low.length)} articoli sotto scorta
            <IconChevron width={15} height={15} />
          </Link>
        )}
      </section>
    </div>
  );
}

function Kpi({
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
    <div className="overflow-hidden rounded-2xl border border-line bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <p className="truncate text-[10px] font-semibold tracking-wide text-muted2">{label}</p>
      <p
        className={`mt-1 truncate text-[clamp(16px,4.6vw,22px)] font-semibold leading-tight tracking-tight tabular-nums ${
          danger ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted2">{hint}</p>
    </div>
  );
}

function TileLink({ href, icon, title }: { href: string; icon: React.ReactNode; title: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-ink/25"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-tint text-ink">{icon}</span>
      <p className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{title}</p>
      <IconChevron width={17} height={17} className="shrink-0 text-muted2" />
    </Link>
  );
}
