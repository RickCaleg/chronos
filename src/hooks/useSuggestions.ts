import { useMemo } from "react";
import { useEntriesStore } from "../store/useEntriesStore";
import { combineTaskDescription } from "../lib/taskDescription";

export interface EntrySuggestion {
  /** What's shown in the dropdown and typed into the field, e.g. "#123 Fix login bug". */
  display: string;
  taskNumber: string | null;
  description: string;
  projectId: string | null;
}

/** Distinct, most-recent-first task+description combos already used, for autocomplete. */
export function useSuggestions(): EntrySuggestion[] {
  const entries = useEntriesStore((s) => s.entries);

  return useMemo(() => {
    const seen = new Set<string>();
    const result: EntrySuggestion[] = [];

    for (const entry of entries) {
      const display = combineTaskDescription(entry.taskNumber, entry.description);
      if (!display || seen.has(display)) continue;
      seen.add(display);
      result.push({
        display,
        taskNumber: entry.taskNumber,
        description: entry.description,
        projectId: entry.projectId,
      });
    }

    return result;
  }, [entries]);
}
