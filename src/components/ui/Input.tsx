import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]",
        className,
      )}
      {...props}
    />
  );
}
