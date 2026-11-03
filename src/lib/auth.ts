import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "pb_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 giorni

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET mancante in .env");
  // In produzione un segreto debole o di esempio renderebbe le sessioni falsificabili.
  if (process.env.NODE_ENV === "production" && (s.length < 24 || /change-?me/i.test(s))) {
    throw new Error("AUTH_SECRET troppo debole: usa una stringa casuale di 32+ caratteri");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

/** Verifica un token JWT. Usabile sia in proxy (Node) sia nei route handler. */
export async function verifyToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      id: String(payload.sub),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: String(payload.role ?? "CREW"),
    };
  } catch {
    return null;
  }
}

/**
 * Opzioni cookie di sessione: `secure` solo in HTTPS (in HTTP locale il browser
 * rifiuterebbe il cookie). SameSite è sempre "lax": con "none" le API
 * sarebbero esposte a richieste cross-site (CSRF).
 */
export function sessionCookie(value: string, isHttps: boolean, maxAge = MAX_AGE) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: isHttps,
  };
}

/**
 * Legge la sessione nel contesto di un Server Component / Route Handler.
 * Oltre alla firma verifica che l'utente esista ancora e ne restituisce nome e
 * ruolo aggiornati dal database: un utente rimosso o declassato perde subito
 * l'accesso, senza aspettare la scadenza del token (7 giorni).
 */
export async function getSession(): Promise<SessionUser | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const dalToken = await verifyToken(store.get(SESSION_COOKIE)?.value);
  if (!dalToken) return null;
  try {
    const { prisma } = await import("@/lib/prisma");
    return await prisma.user.findUnique({
      where: { id: dalToken.id },
      select: { id: true, email: true, name: true, role: true },
    });
  } catch {
    return null;
  }
}

/** true se la richiesta è arrivata in HTTPS (anche dietro un proxy come Render). */
export function isHttpsRequest(request: Request): boolean {
  return (
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ||
    request.url.startsWith("https")
  );
}
