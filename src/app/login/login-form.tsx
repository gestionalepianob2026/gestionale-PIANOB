"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { IconSpinner } from "@/components/icons";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Accesso non riuscito");
        setLoading(false);
        return;
      }
      // Solo percorsi interni: niente "//sito-esterno" (open redirect).
      const richiesto = params.get("next") || "/";
      const next = richiesto.startsWith("/") && !richiesto.startsWith("//") && !richiesto.startsWith("/\\") ? richiesto : "/";
      router.replace(next);
      router.refresh();
    } catch {
      setError("Errore di rete. Riprova.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center">
          <Logo variant="full" size={150} />
          <h1 className="mt-7 text-[28px] font-semibold tracking-[-0.025em] text-ink">
            Accedi al gestionale
          </h1>
        </div>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-slate">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@pianob.it"
              className="rounded-[10px] border border-line bg-tint px-3.5 py-3 text-sm text-ink outline-none transition focus:border-ink/30 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-slate">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-[10px] border border-line bg-tint px-3.5 py-3 text-sm text-ink outline-none transition focus:border-ink/30 focus:bg-white"
            />
          </label>

          {error && (
            <p className="rounded-[10px] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:opacity-60"
          >
            {loading && <IconSpinner width={18} height={18} />}
            {loading ? "Accesso…" : "Accedi"}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-[12.5px] text-muted2">
          <span>Crew &amp; admin</span>
          <button
            type="button"
            className="font-medium text-muted hover:text-ink"
            onClick={() =>
              setError(
                "Per reimpostare la password contatta l'amministratore del locale.",
              )
            }
          >
            Password dimenticata?
          </button>
        </div>
      </div>
    </main>
  );
}
