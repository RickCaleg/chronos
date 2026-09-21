import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { Plus } from "lucide-react";
import type { TimeEntry } from "../../types";
import { useEntriesStore } from "../../store/useEntriesStore";
import { EntryEditPopover } from "../records/EntryEditPopover";
import { dayKey, nowIso } from "../../lib/time";

/** Open state, shared so the command palette can open it too. */
export const useManualEntryStore = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/**
 * A draft finished entry ending now (to the minute) and starting where
 * today's last finished entry ended — filling the gap is the usual reason
 * for adding one by hand — or 30 minutes earlier when there's no such gap.
 */
function draftEntry(entries: TimeEntry[]): TimeEntry {
  const end = new Date(nowIso());
  end.setSeconds(0, 0);
  const endIso = end.toISOString();
  const today = dayKey(endIso);
  const lastEnd = entries
    .filter((e) => !e.isRunning && e.endTime && dayKey(e.endTime) === today && e.endTime < endIso)
    .map((e) => e.endTime!)
    .sort()
    .pop();
  const startIso = lastEnd ?? new Date(end.getTime() - 30 * 60_000).toISOString();
  return {
    id: "",
    description: "",
    taskNumber: null,
    projectId: null,
    startTime: startIso,
    endTime: endIso,
    durationSeconds: null,
    isRunning: false,
    createdAt: endIso,
    updatedAt: endIso,
    tags: [],
    proofhubTimeEntryId: null,
    proofhubSyncedAt: null,
    note: null,
  };
}

/**
 * Adds a finished entry by hand, with its own start and end — in the
 * records toolbar, apart from the timer bar (which is for "now"), so a
 * running timer and whatever is typed there stay as they are.
 */
export function ManualEntryButton() {
  const { t } = useTranslation();
  const { open, setOpen } = useManualEntryStore();

  return (
    <div className="relative">
      <button
        type="button"
        // Kept from FloatingPanel's outside-click listener, so clicking this
        // while open closes the panel instead of closing and reopening it.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] outline-none transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
      >
        <Plus size={15} />
        {t("timer.manualEntryShort")}
      </button>
      {/* Mounted only while open, so each time starts from a fresh draft. */}
      {open && <ManualEntryPopover onClose={() => setOpen(false)} />}
    </div>
  );
}

function ManualEntryPopover({ onClose }: { onClose: () => void }) {
  const add = useEntriesStore((s) => s.add);
  const entries = useEntriesStore((s) => s.entries);
  // Drafted once per opening, not on every change to the entry list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const draft = useMemo(() => draftEntry(entries), []);

  return (
    <EntryEditPopover
      open
      isNew
      entry={draft}
      onClose={onClose}
      onSave={(patch, tags) =>
        add(
          {
            description: patch.description ?? "",
            taskNumber: patch.taskNumber ?? null,
            projectId: patch.projectId ?? null,
            startTime: patch.startTime!,
            endTime: patch.endTime!,
          },
          tags,
        )
      }
    />
  );
}
