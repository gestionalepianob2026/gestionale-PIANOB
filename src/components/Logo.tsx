/* eslint-disable @next/next/no-img-element -- asset statici piccoli, già ottimizzati */

// Proporzioni dei file in /public (logo ritagliato, sfondo trasparente).
const FULL_RATIO = 175 / 295; // larghezza / altezza di logo.png (scritta + chiave)
const MARK_RATIO = 175 / 270; // larghezza / altezza di logo-mark.png (solo chiave)

/**
 * Logo PIANO B.
 * - `full`: logo completo (scritta sopra + chiave), per login / schermate vuote.
 * - `inline` (default): chiave + scritta a fianco, per sidebar e header.
 * `size` = altezza in px dell'immagine.
 */
export function Logo({
  size = 40,
  variant = "inline",
}: {
  size?: number;
  variant?: "full" | "inline";
}) {
  if (variant === "full") {
    return (
      <img
        src="/logo.png"
        alt="PIANO B"
        height={size}
        width={Math.round(size * FULL_RATIO)}
        style={{ height: size, width: "auto" }}
        draggable={false}
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      <img
        src="/logo-mark.png"
        alt=""
        height={size}
        width={Math.round(size * MARK_RATIO)}
        style={{ height: size, width: "auto" }}
        draggable={false}
      />
      <span
        className="font-serif text-ink"
        style={{
          fontSize: Math.max(15, Math.round(size * 0.4)),
          letterSpacing: "0.22em",
          lineHeight: 1,
        }}
      >
        PIANO.B
      </span>
    </div>
  );
}
