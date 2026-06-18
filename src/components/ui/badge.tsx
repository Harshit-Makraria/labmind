import { cn } from "@/lib/utils";

type Tone = "navy" | "brand" | "accent" | "warning" | "danger" | "muted";

const tones: Record<Tone, string> = {
  navy: "bg-[var(--color-navy)]/10 text-[var(--color-navy)]",
  brand: "bg-[var(--color-brand)]/12 text-[var(--color-brand)]",
  accent: "bg-[var(--color-accent)]/14 text-[var(--color-accent)]",
  warning: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/12 text-[var(--color-danger)]",
  muted: "bg-black/[0.05] text-[var(--color-muted)]",
};

export function Badge({
  tone = "muted",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn("chip", tones[tone], className)}>{children}</span>;
}
