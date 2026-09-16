import { create } from "zustand";
import type { TimeEntry } from "../types";
import * as entriesDb from "../db/entries";
import { durationBetween, nowIso } from "../lib/time";
import type { EntryPatch } from "../db/entries";

interface EntriesState {
  entries: TimeEntry[];
  runningEntry: TimeEntry | null;
  loaded: boolean;
  load: () => Promise<void>;
  start: (input: entriesDb.StartEntryInput) => Promise<void>;
  stop: () => Promise<void>;
  setRunningStart: (startTime: string) => Promise<void>;
  update: (id: string, patch: EntryPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useEntriesStore = create<EntriesState>((set, get) => ({
  entries: [],
  runningEntry: null,
  loaded: false,

  load: async () => {
    const entries = await entriesDb.listEntries();
    const runningEntry = entries.find((e) => e.isRunning) ?? null;
    set({ entries, runningEntry, loaded: true });
  },

  start: async (input) => {
    const entry = await entriesDb.startEntry(input);
    set({ entries: [entry, ...get().entries], runningEntry: entry });
  },

  stop: async () => {
    const running = get().runningEntry;
    if (!running) return;
    const endTime = nowIso();
    const durationSeconds = durationBetween(running.startTime, endTime);
    await entriesDb.stopEntry(running.id, endTime, durationSeconds);
    set({
      entries: get().entries.map((e) =>
        e.id === running.id ? { ...e, endTime, durationSeconds, isRunning: false } : e,
      ),
      runningEntry: null,
    });
  },

  setRunningStart: async (startTime) => {
    const running = get().runningEntry;
    if (!running) return;
    await entriesDb.updateEntry(running.id, { startTime });
    const updated = { ...running, startTime };
    set({
      runningEntry: updated,
      entries: get().entries.map((e) => (e.id === running.id ? updated : e)),
    });
  },

  update: async (id, patch) => {
    const applyPatch = (e: TimeEntry): TimeEntry => ({
      ...e,
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.taskNumber !== undefined ? { taskNumber: patch.taskNumber } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
      ...(patch.endTime !== undefined ? { endTime: patch.endTime } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
    });
    // Apply optimistically, before the DB round-trip: the running entry's
    // description field is bound directly to this store, so waiting for
    // `await` first left the input showing stale text (and dropped
    // keystrokes typed faster than the round-trip) while the timer was running.
    set((state) => ({
      entries: state.entries.map((e) => (e.id === id ? applyPatch(e) : e)),
      runningEntry: state.runningEntry?.id === id ? applyPatch(state.runningEntry) : state.runningEntry,
    }));
    await entriesDb.updateEntry(id, patch);
  },

  remove: async (id) => {
    await entriesDb.deleteEntry(id);
    set({
      entries: get().entries.filter((e) => e.id !== id),
      runningEntry: get().runningEntry?.id === id ? null : get().runningEntry,
    });
  },
}));
