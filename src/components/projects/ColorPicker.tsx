import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PALETTE } from "../../store/useProjectsStore";
import { cn } from "../../lib/cn";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("projects.color")}
        className="h-4 w-4 shrink-0 rounded-[1px] border border-[var(--color-border)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
        style={{ backgroundColor: color }}
      />

      <FloatingPanel open={open} onClose={close} className="w-44 p-3">
        <div className="grid grid-cols-4 gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                close();
              }}
              aria-label={c}
              className={cn(
                "h-6 w-6 rounded-[1px] border-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]",
                c.toLowerCase() === color.toLowerCase() ? "border-[var(--color-text)]" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <label className="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
          {t("projects.customColor")}
          <input
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-10 cursor-pointer rounded-[2px] border border-[var(--color-border)] bg-transparent p-0"
          />
        </label>
      </FloatingPanel>
    </div>
  );
}
