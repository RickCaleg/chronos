import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
