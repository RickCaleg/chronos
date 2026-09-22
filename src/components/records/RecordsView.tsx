import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { DayGroup } from "./DayGroup";
import { dayKey } from "../../lib/time";
import { groupSimilarEntries } from "../../lib/grouping";
import { Button } from "../ui/Button";

/**
 * Days rendered at first, and added per "show more". Rendering every day ever
 * logged made the app take seconds to open, and to start or stop the timer,
 * once the history reached a few thousand entries.
 */
const DAYS_PER_PAGE = 30;

export function RecordsView() {
  const { t } = useTranslation();
  const entries = useEntriesStore((s) => s.entries);
  const runningEntry = useEntriesStore((s) => s.runningEntry);
  const groupSimilar = useAppSettingsStore((s) => s.groupSimilarEntries);
  const [visibleDays, setVisibleDays] = useState(DAYS_PER_PAGE);

  const runningDayKey = runningEntry ? dayKey(runningEntry.startTime) : null;

  const days = useMemo(() => {
    const finished = entries.filter((e) => !e.isRunning);
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());

    const map = new Map<string, typeof finished>();
    for (const entry of finished) {
      const key = dayKey(entry.startTime);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    // The running entry is excluded from `finished`, so make sure its day still
    // shows up (with an empty entry list) so the day total can reflect it.
    if (runningDayKey && !map.has(runningDayKey)) map.set(runningDayKey, []);

    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([key, dayEntries]) => ({
        key,
        label: key === today ? ("today" as const) : key === yesterday ? ("yesterday" as const) : null,
        dayEntries,
      }));
  }, [entries, runningDayKey]);

  const groups = useMemo(
    () =>
      days.slice(0, visibleDays).map((day) => ({
        ...day,
        items: groupSimilar ? groupSimilarEntries(day.dayEntries) : day.dayEntries,
      })),
    [days, visibleDays, groupSimilar],
  );
  const hiddenDays = days.length - groups.length;

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
        {t("records.empty")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      {groups.map((group) => (
        <DayGroup
          key={group.key}
          dayKey={group.key}
          label={group.label}
          items={group.items}
          runningEntry={group.key === runningDayKey ? runningEntry : null}
        />
      ))}
      {hiddenDays > 0 && (
        <div className="flex justify-center py-3">
          <Button variant="secondary" size="sm" onClick={() => setVisibleDays((n) => n + DAYS_PER_PAGE)}>
            {t("records.showMore", { count: Math.min(DAYS_PER_PAGE, hiddenDays), total: hiddenDays })}
          </Button>
        </div>
      )}
    </div>
  );
}
