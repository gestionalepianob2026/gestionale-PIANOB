"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import {
  IconDashboard,
  IconBox,
  IconPlus,
  IconScan,
  IconChart,
  IconClipboard,
  IconLogout,
} from "@/components/icons";
import type { SessionUser } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Dashboard", icon: IconDashboard, exact: true },
  { href: "/inventario", label: "Inventario", icon: IconBox },
  { href: "/giacenza", label: "Consumi", icon: IconClipboard },
  { href: "/statistiche", label: "Statistiche", icon: IconChart },
  { href: "/aggiungi", label: "Aggiungi", icon: IconPlus },
  { href: "/scansiona", label: "Scansiona bolla", icon: IconScan },
];

const MOBILE = [
  { href: "/", label: "Home", icon: IconDashboard, exact: true },
  { href: "/inventario", label: "Inventario", icon: IconBox },
  { href: "/giacenza", label: "Consumi", icon: IconClipboard },
  { href: "/scansiona", label: "Scansiona", icon: IconScan },
  { href: "/aggiungi", label: "Aggiungi", icon: IconPlus },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-white px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo size={36} />
        </div>

        <p className="mt-7 px-3 text-[11px] font-semibold tracking-wide text-muted2">
          MAGAZZINO
        </p>
        <nav className="mt-2 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(item.href, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-ink text-white"
                    : "text-slate hover:bg-line2"
                }`}
              >
                <Icon width={19} height={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center gap-3 rounded-xl border border-line p-3">
          <div className="grid size-9 place-items-center rounded-full bg-brand text-[13px] font-bold text-black">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{user.name}</p>
            <p className="text-[11px] font-medium text-muted2">{user.role}</p>
          </div>
          <button
            onClick={logout}
            disabled={loggingOut}
            title="Esci"
            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-line2 hover:text-danger"
          >
            <IconLogout width={18} height={18} />
          </button>
        </div>
      </aside>

      {/* Header mobile */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo size={32} />
        <div className="grid size-8 place-items-center rounded-full bg-brand text-[12px] font-bold text-black">
          {initials(user.name)}
        </div>
      </header>

      {/* Contenuto */}
      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {children}
        </div>
      </main>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-white/95 backdrop-blur lg:hidden">
        {MOBILE.map((item) => {
          const active = isActive(item.href, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium ${
                active ? "text-ink" : "text-muted2"
              }`}
            >
              <Icon width={21} height={21} />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted2"
        >
          <IconLogout width={21} height={21} />
          Esci
        </button>
      </nav>
    </div>
  );
}
