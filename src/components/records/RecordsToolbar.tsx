import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Command } from "lucide-react";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useLiveElapsed } from "../../hooks/useLiveElapsed";
import { dayKey, formatDurationHuman } from "../../lib/time";
import { ManualEntryButton } from "../timer/ManualEntry";

/** Monday of the current local week, as a dayKey — weeks start on Monday, like timesheets. */
function weekStartKey(): string {
  const d = new Date();
  const fromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - fromMonday);
  return dayKey(d.toISOString());
}

/**
 * The strip between the timer and the list: how much is logged today and
 * this week (the running timer included, ticking), and the way to log past
 * time by hand — kept apart from the timer, which is for "now".
 */
export function RecordsToolbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { t } = useTranslation();
  const entries = useEntriesStore((s) => s.entries);
  const runningEntry = useEntriesStore((s) => s.runningEntry);
  const running = useLiveElapsed(runningEntry?.startTime);

  const today = dayKey(new Date().toISOString());
  const weekStart = weekStartKey();
  // Only when entries or the day change, not on every tick of the running timer.
  const finished = useMemo(() => {
    let todayTotal = 0;
    let weekTotal = 0;
    for (const e of entries) {
      if (e.isRunning) continue;
      const day = dayKey(e.startTime);
      if (day === today) todayTotal += e.durationSeconds ?? 0;
      if (day >= weekStart && day <= today) weekTotal += e.durationSeconds ?? 0;
    }
    return { todayTotal, weekTotal };
  }, [entries, today, weekStart]);
  let { todayTotal, weekTotal } = finished;
  if (runningEntry) {
    const day = dayKey(runningEntry.startTime);
    if (day === today) todayTotal += running;
    if (day >= weekStart) weekTotal += running;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1">
      <Stat label={t("records.today")} value={formatTotal(todayTotal)} />
      <Stat label={t("records.thisWeek")} value={formatTotal(weekTotal)} />
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          title={t("palette.hint")}
          className="hidden items-center gap-1.5 rounded-[2px] px-2 py-1.5 text-xs text-[var(--color-text-muted)] outline-none transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)] sm:flex"
        >
          <Command size={13} />
          {t("palette.open")}
          <kbd className="rounded-[2px] border border-[var(--color-border)] px-1 font-sans text-[10px]">Ctrl K</kbd>
        </button>
        <ManualEntryButton />
      </div>
    </div>
  );
}

/** Totals read in minutes — "0m", not the "0s" a duration under a minute gets elsewhere. */
function formatTotal(seconds: number): string {
  return seconds < 60 ? "0m" : formatDurationHuman(seconds);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}
