import { useTranslation } from "react-i18next";
import type { TimeEntry } from "../../types";
import type { EntryOrGroup } from "../../lib/grouping";
import { EntryRow } from "./EntryRow";
import { GroupedEntryRow } from "./GroupedEntryRow";
import { formatDayLabel, formatDurationHuman } from "../../lib/time";
import i18n from "../../i18n";

interface DayGroupProps {
  dayKey: string;
  label: "today" | "yesterday" | null;
  items: EntryOrGroup[];
}

function firstEntry(item: EntryOrGroup): TimeEntry {
  return Array.isArray(item) ? item[0] : item;
}

function itemKey(item: EntryOrGroup): string {
  return Array.isArray(item) ? item[0].id : item.id;
}

export function DayGroup({ dayKey, label, items }: DayGroupProps) {
  const { t } = useTranslation();
  const total = items.reduce((sum, item) => {
    const entries = Array.isArray(item) ? item : [item];
    return sum + entries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
  }, 0);
  const title = label ? t(`records.${label}`) : formatDayLabel(firstEntry(items[0]).startTime, i18n.language);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <span>{title}</span>
        <span>
          {t("records.total")}: {formatDurationHuman(total)}
        </span>
      </div>
      <div className="rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)]" key={dayKey}>
        {items.map((item, i) => (
          <div key={itemKey(item)} className={i > 0 ? "border-t border-[var(--color-border)]" : ""}>
            {Array.isArray(item) ? <GroupedEntryRow entries={item} /> : <EntryRow entry={item} />}
          </div>
        ))}
      </div>
    </div>
  );
}
