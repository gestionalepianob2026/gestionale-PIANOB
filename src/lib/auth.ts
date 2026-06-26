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
 * Opzioni cookie di sessione adattive: in HTTPS usa secure + sameSite "none"
 * (necessario in produzione/embedding); in HTTP locale (rete di casa) usa
 * sameSite "lax" senza secure, altrimenti il browser rifiuterebbe il cookie.
 */
export function sessionCookie(value: string, isHttps: boolean, maxAge = MAX_AGE) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: (isHttps ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge,
    secure: isHttps,
  };
}

/** Legge la sessione nel contesto di un Server Component / Route Handler. */
export async function getSession(): Promise<SessionUser | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}
