import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { DayGroup } from "./DayGroup";
import { dayKey } from "../../lib/time";
import { groupSimilarEntries } from "../../lib/grouping";

export function RecordsView() {
  const { t } = useTranslation();
  const { entries } = useEntriesStore();
  const groupSimilar = useAppSettingsStore((s) => s.groupSimilarEntries);

  const finished = entries.filter((e) => !e.isRunning);

  const groups = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());

    const map = new Map<string, typeof finished>();
    for (const entry of finished) {
      const key = dayKey(entry.startTime);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }

    return Array.from(map.entries()).map(([key, dayEntries]) => ({
      key,
      label: key === today ? ("today" as const) : key === yesterday ? ("yesterday" as const) : null,
      items: groupSimilar ? groupSimilarEntries(dayEntries) : dayEntries,
    }));
  }, [finished, groupSimilar]);

  if (finished.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
        {t("records.empty")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      {groups.map((group) => (
        <DayGroup key={group.key} dayKey={group.key} label={group.label} items={group.items} />
      ))}
    </div>
  );
}
