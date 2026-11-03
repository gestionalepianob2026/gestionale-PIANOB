import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signSession, sessionCookie, isHttpsRequest } from "@/lib/auth";
import { azzera, bloccoRimanente, registraFallimento } from "@/lib/rate-limit";

// Hash fittizio: se l'utente non esiste facciamo comunque un confronto bcrypt,
// così il tempo di risposta non rivela quali email sono registrate.
const HASH_FITTIZIO = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.4ZpHq1nQ0GqR1f1m6o2x5n3k8c9eO";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }

  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, 200);
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Inserisci email e password" }, { status: 400 });
  }

  // Limite tentativi per IP e per email (frena la forza bruta).
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "locale";
  // Soglia stretta per singola email, larga per IP: il personale del locale
  // condivide lo stesso Wi-Fi (stesso IP) e non deve bloccarsi a vicenda.
  const chiavi = [`ip:${ip}`, `em:${email}`];
  const attesa = Math.max(bloccoRimanente(chiavi[0], 40), bloccoRimanente(chiavi[1], 8));
  if (attesa > 0) {
    return NextResponse.json(
      { error: `Troppi tentativi. Riprova tra ${Math.ceil(attesa / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(attesa) } },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.password ?? HASH_FITTIZIO);
  if (!user || !ok) {
    chiavi.forEach(registraFallimento);
    return NextResponse.json({ error: "Email o password non corretti" }, { status: 401 });
  }
  chiavi.forEach(azzera);

  const token = await signSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  const res = NextResponse.json({
    user: { name: user.name, role: user.role, email: user.email },
  });
  res.cookies.set(sessionCookie(token, isHttpsRequest(request)));
  return res;
}
