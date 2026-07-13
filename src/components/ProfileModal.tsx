"use client";

import { useState } from "react";
import { IconClose, IconSpinner, IconCheck } from "@/components/icons";
import type { SessionUser } from "@/lib/auth";

export function ProfileModal({
  user,
  onClose,
  onSaved,
}: {
  user: SessionUser;
  onClose: () => void;
  onSaved: (u: { name: string; role: string; email: string }) => void;
}) {
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const wantsPassword = newPassword.length > 0 || confirmPassword.length > 0;
  const nameChanged = name.trim() !== user.name;

  async function save() {
    setError(null);

    if (!name.trim()) {
      setError("Il nome non può essere vuoto");
      return;
    }
    if (wantsPassword) {
      if (!currentPassword) {
        setError("Inserisci la password attuale per cambiarla");
        return;
      }
      if (newPassword.length < 6) {
        setError("La nuova password deve avere almeno 6 caratteri");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Le due password non coincidono");
        return;
      }
    }
    if (!nameChanged && !wantsPassword) {
      setError("Nessuna modifica da salvare");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          currentPassword: wantsPassword ? currentPassword : undefined,
          newPassword: wantsPassword ? newPassword : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setOk(true);
      onSaved(data.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(onClose, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">
              Il mio profilo
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted2">
              {user.email} · {user.role}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-line2"
          >
            <IconClose width={18} height={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-muted2">
              NOME
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </label>

          <div className="rounded-xl border border-line bg-tint p-4">
            <p className="text-[13px] font-semibold">Cambia password</p>
            <p className="text-[12px] text-muted2">
              Lascia vuoto se non vuoi cambiarla.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Password attuale"
                className={inputCls}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nuova password (min. 6 caratteri)"
                className={inputCls}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Conferma nuova password"
                className={inputCls}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}
          {ok && (
            <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-[13px] font-medium text-ok">
              <IconCheck width={15} height={15} /> Profilo aggiornato
            </p>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[15px] font-semibold text-black transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <IconSpinner width={18} height={18} />}
            Salva modifiche
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink outline-none transition focus:border-ink/30";
