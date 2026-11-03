import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifyToken(token);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // Utente non autenticato che prova ad accedere a pagina protetta -> login
  if (!session && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // (Chi è già autenticato e apre /login viene rimandato alla home dalla pagina
  // stessa, dopo aver verificato che l'utente esista ancora nel database: farlo
  // qui, solo sulla firma del token, creava un ciclo infinito per gli utenti rimossi.)

  return NextResponse.next();
}

export const config = {
  // Esclude api, asset statici e file con estensione (immagini, ecc.)
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
