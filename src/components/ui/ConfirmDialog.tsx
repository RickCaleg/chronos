import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { Button } from "./Button";
import { cn } from "../../lib/cn";

export interface ConfirmOptions {
  /** Label of the confirming button; "OK" when omitted. */
  confirmLabel?: string;
  /** Destructive actions get a red confirm button, and Cancel starts focused. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  message: string;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ pending: PendingConfirm | null }>(() => ({ pending: null }));

/**
 * In-app replacement for the system `confirm` dialog: resolves true when
 * confirmed, false when cancelled. Only one is shown at a time — asking
 * again while one is open cancels the older one.
 */
export function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  useConfirmStore.getState().pending?.resolve(false);
  return new Promise((resolve) => useConfirmStore.setState({ pending: { ...options, message, resolve } }));
}

/** Renders whatever `confirm` is asking. Mounted once, in App. */
export function ConfirmDialog() {
  const { t } = useTranslation();
  const pending = useConfirmStore((s) => s.pending);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  function answer(ok: boolean) {
    pending?.resolve(ok);
    useConfirmStore.setState({ pending: null });
  }

  useEffect(() => {
    if (!pending) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (pending.danger ? cancelRef : confirmRef).current?.focus();

    // Capture phase, so Esc/Enter answer the dialog instead of reaching the
    // popover or shortcut underneath it (FloatingPanel closes on Esc).
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        answer(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      // Kept from reaching document listeners, so a popover underneath
      // (FloatingPanel closes on outside clicks) stays open.
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) answer(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-sm rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-lg"
      >
        <p id="confirm-dialog-message" className="whitespace-pre-line text-sm text-[var(--color-text)]">
          {pending.message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} type="button" size="sm" variant="ghost" onClick={() => answer(false)}>
            {t("editor.cancel")}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            variant="primary"
            className={cn(pending.danger && "bg-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:opacity-90")}
            onClick={() => answer(true)}
          >
            {pending.confirmLabel ?? t("confirm.ok")}
          </Button>
        </div>
      </div>
    </div>
  );
}
