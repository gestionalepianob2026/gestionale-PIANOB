import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { CHIAVE_CODICE_TELEGRAM, codiceAttivazioneTelegram } from "@/lib/impostazioni";
import { telegramConfigurato } from "@/lib/telegram";

// Solo l'amministratore vede e cambia la parola d'ordine del bot Telegram.
async function soloAdmin() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (user.role !== "ADMIN")
    return NextResponse.json({ error: "Solo l'amministratore può farlo." }, { status: 403 });
  return null;
}

export async function GET() {
  const no = await soloAdmin();
  if (no) return no;
  const [codice, gruppi] = await Promise.all([
    codiceAttivazioneTelegram(),
    prisma.telegramChat.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  return NextResponse.json({
    botConfigurato: telegramConfigurato(),
    codice,
    gruppi: gruppi.map((g) => ({ id: g.id, titolo: g.titolo, createdAt: g.createdAt })),
  });
}

export async function PUT(request: Request) {
  const no = await soloAdmin();
  if (no) return no;
  const body = await request.json().catch(() => ({}));
  const codice = typeof body.codice === "string" ? body.codice.trim() : "";
  if (codice.length < 4 || codice.length > 40 || /\s/.test(codice))
    return NextResponse.json(
      { error: "La parola d'ordine deve avere da 4 a 40 caratteri, senza spazi." },
      { status: 400 },
    );
  await prisma.impostazione.upsert({
    where: { chiave: CHIAVE_CODICE_TELEGRAM },
    create: { chiave: CHIAVE_CODICE_TELEGRAM, valore: codice },
    update: { valore: codice },
  });
  return NextResponse.json({ ok: true, codice });
}
