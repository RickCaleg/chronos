import { useMemo } from "react";
import { useEntriesStore } from "../store/useEntriesStore";

/** Distinct, most-recent-first task numbers and descriptions already used, for autocomplete. */
export function useSuggestions() {
  const entries = useEntriesStore((s) => s.entries);

  return useMemo(() => {
    const tasks: string[] = [];
    const descriptions: string[] = [];
    const seenTasks = new Set<string>();
    const seenDescriptions = new Set<string>();

    for (const entry of entries) {
      if (entry.taskNumber && !seenTasks.has(entry.taskNumber)) {
        seenTasks.add(entry.taskNumber);
        tasks.push(entry.taskNumber);
      }
      if (entry.description && !seenDescriptions.has(entry.description)) {
        seenDescriptions.add(entry.description);
        descriptions.push(entry.description);
      }
    }

    return { tasks, descriptions };
  }, [entries]);
}
