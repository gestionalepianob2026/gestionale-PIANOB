import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.url.startsWith("https");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie("", isHttps, 0));
  return res;
}
