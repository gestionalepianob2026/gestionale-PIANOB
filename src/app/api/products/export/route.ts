import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { prezzoLordo, valoreRiga } from "@/lib/format";

// Numero in formato italiano (virgola decimale) senza separatore migliaia,
// così Excel/IT lo interpreta come numero.
function n2(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2).replace(".", ",");
}
function nq(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2)).replace(".", ",");
}

// Campo CSV: raddoppia le virgolette ed avvolge se necessario.
function cell(v: string): string {
  const s = v ?? "";
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const user = await getSession();
  if (!user) return new Response("Non autorizzato", { status: 401 });

  const products = await prisma.product.findMany({
    orderBy: [{ categoria: "asc" }, { prodotto: "asc" }],
  });

  const headers = [
    "Prodotto",
    "Categoria",
    "Tipologia",
    "Zona",
    "Fornitore",
    "Prezzo netto",
    "IVA %",
    "Prezzo lordo",
    "Quantità",
    "Soglia min",
    "Valore magazzino",
  ];

  const lines = [headers.join(";")];
  for (const p of products) {
    lines.push(
      [
        cell(p.prodotto),
        cell(p.categoria),
        cell(p.tipologia ?? ""),
        cell(p.zona ?? ""),
        cell(p.fornitore ?? ""),
        n2(p.prezzoUnit),
        nq(p.ivaRate),
        n2(prezzoLordo(p.prezzoUnit, p.ivaRate)),
        nq(p.quantita),
        nq(p.sogliaMin),
        n2(valoreRiga(p.prezzoUnit, p.ivaRate, p.quantita)),
      ].join(";"),
    );
  }

  // BOM UTF-8 così Excel mostra correttamente gli accenti.
  const csv = "﻿" + lines.join("\r\n");
  const oggi = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="giacenza-pianob-${oggi}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
