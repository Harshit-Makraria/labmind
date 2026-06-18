import * as React from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "accent" | "ghost" | "danger" | "outline";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-[var(--color-navy)] text-white hover:bg-[var(--color-navy-700)] shadow-sm",
  secondary: "bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)] shadow-sm",
  accent: "bg-[var(--color-accent)] text-white hover:brightness-110 shadow-sm",
  ghost: "bg-transparent text-[var(--color-navy)] hover:bg-black/5",
  outline: "bg-transparent text-[var(--color-navy)] border border-[var(--color-navy)]/20 hover:bg-black/[0.03]",
  danger: "bg-[var(--color-danger)] text-white hover:brightness-110 shadow-sm",
};

const sizes: Record<Size, string> = {
  sm: "min-h-[40px] px-4 text-sm",
  md: "min-h-[52px] px-5",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", fullWidth = true, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-btn)] font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
        sizes[size],
        fullWidth && "w-full",
        variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
