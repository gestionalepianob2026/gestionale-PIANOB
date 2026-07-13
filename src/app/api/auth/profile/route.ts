import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession, signSession, sessionCookie } from "@/lib/auth";

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user)
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });

  const data: { name?: string; password?: string } = {};

  // Cambio nome
  if (name !== undefined) {
    if (!name)
      return NextResponse.json(
        { error: "Il nome non può essere vuoto" },
        { status: 400 },
      );
    if (name !== user.name) data.name = name;
  }

  // Cambio password: richiede quella attuale corretta
  if (newPassword) {
    if (newPassword.length < 6)
      return NextResponse.json(
        { error: "La nuova password deve avere almeno 6 caratteri" },
        { status: 400 },
      );
    if (!(await bcrypt.compare(currentPassword, user.password)))
      return NextResponse.json(
        { error: "Password attuale non corretta" },
        { status: 400 },
      );
    data.password = await bcrypt.hash(newPassword, 10);
  }

  if (Object.keys(data).length === 0)
    return NextResponse.json(
      { error: "Nessuna modifica da salvare" },
      { status: 400 },
    );

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
  });

  // Rifirma la sessione così il nome aggiornato compare subito ovunque.
  const token = await signSession({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
  });

  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.url.startsWith("https");

  const res = NextResponse.json({
    user: { name: updated.name, email: updated.email, role: updated.role },
  });
  res.cookies.set(sessionCookie(token, isHttps));
  return res;
}
