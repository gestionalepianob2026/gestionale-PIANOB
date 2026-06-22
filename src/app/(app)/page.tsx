import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { fmtEur, fmtNum, valoreRiga, isLow } from "@/lib/format";
import { IconScan, IconAlert, IconBox, IconDoc, IconChevron } from "@/components/icons";

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

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Buongiorno";
  if (h < 18) return "Buon pomeriggio";
  return "Buonasera";
}

export default async function DashboardPage() {
  const [user, products, lastBolla] = await Promise.all([
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
      },
    }),
    prisma.bolla.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  const now = new Date();
  let vTot = 0;
  const cats = new Map<string, { count: number; value: number }>();
  const low: typeof products = [];

  for (const p of products) {
    const v = valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita);
    vTot += v;
    const c = cats.get(p.categoria) ?? { count: 0, value: 0 };
    c.count += 1;
    c.value += v;
    cats.set(p.categoria, c);
    if (isLow(p)) low.push(p);
  }

  const catList = [...cats.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value);

  const lowSorted = [...low].sort((a, b) => a.quantita - b.quantita);

  const stats = {
    vTot,
    nProd: products.length,
    nCat: cats.size,
    nLow: low.length,
  };

  const dateStr = now.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Intestazione */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12.5px] font-medium capitalize text-muted2">
            {dateStr}
          </p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-tight text-ink">
            {greeting(now)}, {user?.name.split(" ")[0] ?? "crew"}
          </h1>
        </div>
        <Link
          href="/scansiona"
          className="flex items-center gap-2.5 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-black transition hover:bg-brand-dark"
        >
          <IconScan width={19} height={19} />
          Scansiona bolla
        </Link>
      </div>

      {/* Riquadri statistiche */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="VALORE MAGAZZINO"
          value={fmtEur(stats.vTot)}
          hint={`IVA inclusa · ${stats.nProd} articoli`}
        />
        <StatCard
          label="ARTICOLI"
          value={String(stats.nProd)}
          hint={`${stats.nCat} categorie`}
        />
        <StatCard
          label="SOTTO SCORTA"
          value={String(stats.nLow)}
          hint="da riordinare"
          danger={stats.nLow > 0}
        />
        <StatCard
          label="ULTIMA BOLLA"
          value={
            lastBolla?.data
              ? lastBolla.data.toLocaleDateString("it-IT", {
                  day: "2-digit",
                  month: "2-digit",
                })
              : "—"
          }
          hint={lastBolla?.fornitore ?? "nessuna ancora"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Distribuzione valore */}
        <section className="lg:col-span-2 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Distribuzione valore
          </h2>
          <div className="mt-4 flex flex-col gap-3.5">
            {catList.slice(0, 8).map((c, i) => {
              const pct = stats.vTot ? (c.value / stats.vTot) * 100 : 0;
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
                  <span className="w-10 shrink-0 text-right text-[12px] text-muted2">
                    {c.count}
                  </span>
                  <span className="w-24 shrink-0 text-right text-[13px] font-semibold tabular-nums">
                    {fmtEur(c.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Da riordinare */}
        <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <IconAlert width={17} height={17} className="text-danger" />
              Da riordinare
            </h2>
            <Link
              href="/inventario?low=1"
              className="text-[12.5px] font-medium text-muted hover:text-ink"
            >
              Vedi tutto
            </Link>
          </div>

          {lowSorted.length === 0 ? (
            <p className="mt-6 text-center text-[13px] text-muted2">
              Tutto sotto controllo 🎉
            </p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-line2">
              {lowSorted.slice(0, 6).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {p.prodotto}
                    </p>
                    <p className="text-[11.5px] text-muted2">{p.categoria}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-danger/10 px-2.5 py-1 text-[12px] font-semibold text-danger">
                    {fmtNum(p.quantita)} pz
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Scorciatoie */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ShortcutCard
          href="/inventario"
          icon={<IconBox width={20} height={20} />}
          title="Inventario"
          desc={`${stats.nProd} articoli · ${fmtEur(stats.vTot)}`}
        />
        <ShortcutCard
          href="/scansiona"
          icon={<IconDoc width={20} height={20} />}
          title="Scansiona bolla"
          desc="Carica una foto e compila in automatico"
        />
      </div>
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

function ShortcutCard({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3.5 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-ink/20"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-tint text-ink">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="truncate text-[12.5px] text-muted2">{desc}</p>
      </div>
      <IconChevron width={18} height={18} className="text-muted2" />
    </Link>
  );
}
