export function Logo({
  size = 40,
  withText = true,
}: {
  size?: number;
  withText?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="grid place-items-center rounded-[12px] bg-brand font-bold text-black"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
        B
      </div>
      {withText && (
        <span className="text-[17px] font-semibold tracking-tight text-ink">
          PIANO B
        </span>
      )}
    </div>
  );
}
