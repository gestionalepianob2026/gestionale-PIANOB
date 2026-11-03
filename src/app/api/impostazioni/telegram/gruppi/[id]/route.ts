import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Disattiva un gruppo: il bot smette di scaricare il magazzino da lì.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (user.role !== "ADMIN")
    return NextResponse.json({ error: "Solo l'amministratore può farlo." }, { status: 403 });
  const { id } = await ctx.params;
  try {
    await prisma.telegramChat.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Gruppo non trovato" }, { status: 404 });
  }
}
