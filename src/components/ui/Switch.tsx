import { cn } from "../../lib/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-block h-5 w-9 shrink-0 rounded-[2px] border outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]",
        checked ? "border-[var(--color-accent)] bg-[var(--color-accent)]" : "border-[var(--color-border)] bg-[var(--color-bg)]",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-3 w-3 rounded-[1px] border border-[var(--color-border)] bg-white transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
