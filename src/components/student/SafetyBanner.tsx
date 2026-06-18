import { AlertTriangle } from "lucide-react";

export function SafetyBanner({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <ul className="space-y-0.5">
        {flags.map((f, i) => (
          <li key={i} className="font-medium">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
