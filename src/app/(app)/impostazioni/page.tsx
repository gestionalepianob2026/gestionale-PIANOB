import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { codiceAttivazioneTelegram } from "@/lib/impostazioni";
import { telegramConfigurato } from "@/lib/telegram";
import { ImpostazioniClient } from "./impostazioni-client";

export const dynamic = "force-dynamic";

export default async function ImpostazioniPage() {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") redirect("/");
  const [codice, gruppi] = await Promise.all([
    codiceAttivazioneTelegram(),
    prisma.telegramChat.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <ImpostazioniClient
      botConfigurato={telegramConfigurato()}
      codiceIniziale={codice}
      gruppiIniziali={gruppi.map((g) => ({
        id: g.id,
        titolo: g.titolo,
        createdAt: g.createdAt.toISOString(),
      }))}
    />
  );
}
