import type { Reagent } from "@/lib/types";

export function ReagentChips({ reagents }: { reagents: Reagent[] }) {
  if (!reagents.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {reagents.map((r, i) => (
        <span
          key={`${r.name}-${i}`}
          className="rounded-full bg-[var(--color-brand)]/10 px-3 py-1 text-sm font-medium text-[var(--color-brand)]"
        >
          {r.name}
          {r.concentration ? ` · ${r.concentration}` : ""}
          {r.volume_ml ? ` · ${r.volume_ml} mL` : ""}
        </span>
      ))}
    </div>
  );
}
