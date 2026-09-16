import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]",
  ghost: "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]",
  danger: "text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)]",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-[2px]",
  md: "h-10 px-4 text-sm rounded-[2px]",
  icon: "h-9 w-9 rounded-[2px] justify-center",
};

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 font-medium transition-colors cursor-pointer disabled:cursor-not-allowed outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
