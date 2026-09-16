import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { formatLocalDateTimeInput, formatTimeShort, parseLocalDateTimeInput } from "../../lib/time";
import i18n from "../../i18n";

interface TimeAdjustPopoverProps {
  startTime: string;
  onChange: (startTimeIso: string) => void;
}

export function TimeAdjustPopover({ startTime, onChange }: TimeAdjustPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => formatLocalDateTimeInput(startTime));
  const triggerRef = useRef<HTMLButtonElement>(null);

  const parsed = parseLocalDateTimeInput(text, startTime);
  const isInvalid = parsed === null;
  const isFuture = parsed !== null && new Date(parsed).getTime() > Date.now();

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleOpen() {
    setText(formatLocalDateTimeInput(startTime));
    setOpen(true);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parsed || isFuture) return;
    onChange(parsed);
    close();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1.5 rounded-[2px] text-sm text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text)] focus-visible:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <Pencil size={12} />
        {t("timer.runningSince", { time: formatTimeShort(startTime, i18n.language) })}
      </button>

      <FloatingPanel open={open} onClose={close} className="w-64">
        <form onSubmit={handleSubmit}>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            {t("timer.editStart")}
          </label>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("editor.dateTimePlaceholder")}
          />
          {isInvalid && <p className="mt-1 text-xs text-[var(--color-danger)]">{t("editor.invalidDateTime")}</p>}
          {!isInvalid && isFuture && <p className="mt-1 text-xs text-[var(--color-danger)]">{t("editor.futureStart")}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              {t("editor.cancel")}
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={isInvalid || isFuture}>
              {t("editor.save")}
            </Button>
          </div>
        </form>
      </FloatingPanel>
    </div>
  );
}
