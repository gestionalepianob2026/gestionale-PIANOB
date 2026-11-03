import { NextResponse } from "next/server";
import { sessionCookie, isHttpsRequest } from "@/lib/auth";

export async function POST(request: Request) {
  const isHttps = isHttpsRequest(request);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie("", isHttps, 0));
  return res;
}
