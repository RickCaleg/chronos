import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import type { TimeEntry } from "../../types";
import { useEntriesStore } from "../../store/useEntriesStore";
import { nowIso } from "../../lib/time";

/**
 * A row's leading "continue this" control: stops whatever is running and
 * starts a new timer with the entry's description, task and project. Round
 * and filled, at the left edge, so it reads as the row's primary action and
 * can't be mistaken for the outlined send icon on the right. Lights up
 * while the row (a `group/row` ancestor) is hovered.
 */
export function RestartButton({ entry }: { entry: TimeEntry }) {
  const { t } = useTranslation();
  const { start, stop, runningEntry } = useEntriesStore();

  async function handleRestart() {
    if (runningEntry) await stop();
    await start({
      description: entry.description,
      taskNumber: entry.taskNumber,
      projectId: entry.projectId,
      startTime: nowIso(),
    });
  }

  return (
    <button
      type="button"
      onClick={handleRestart}
      aria-label={t("records.restart")}
      title={t("records.restart")}
      className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] outline-none transition-colors group-hover/row:text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] focus-visible:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
    >
      {/* Nudged right: a triangle's visual centre sits left of its box's. */}
      <Play size={12} fill="currentColor" className="translate-x-[1px]" />
    </button>
  );
}
