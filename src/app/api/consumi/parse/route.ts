import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseMessaggio } from "@/lib/consumi";
import { abbinaRighe } from "@/lib/abbina-consumi";

export const maxDuration = 60;

const MAX_CARATTERI = 8000;
const MAX_RIGHE = 150;

export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const testo = typeof body.testo === "string" ? body.testo.slice(0, MAX_CARATTERI) : "";
  const parsedAll = parseMessaggio(testo);
  const parsed = parsedAll.righe.slice(0, MAX_RIGHE);
  const ignorate = parsedAll.ignorate;

  if (parsed.length === 0)
    return NextResponse.json({ righe: [], ignorate, aiAttiva: false });

  const { righe, aiAttiva, messaggioAI } = await abbinaRighe(parsed);
  return NextResponse.json({ righe, ignorate, aiAttiva, messaggioAI });
}
