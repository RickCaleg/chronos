import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface FloatingPanelProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function FloatingPanel({ open, onClose, children, align = "left", className }: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass inline closures, so onClose changes identity on every
  // parent render (e.g. each tick of a running timer). Read it through a ref
  // so the effect below runs only on open — re-running it would steal focus
  // back to the first field while the user is typing in another one.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    const firstField = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    firstField?.focus();

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "absolute top-full z-50 mt-2 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-md",
        align === "right" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
