import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Tag, TimeEntry } from "../types";
import * as entriesDb from "../db/entries";
import * as tagsDb from "../db/tags";
import { durationBetween, nowIso } from "../lib/time";
import type { EntryPatch } from "../db/entries";

/** Best-effort: keeps the tray menu's "Start/Stop Timer" label in sync. No-ops quietly if the tray isn't available (e.g. a bare window manager without a status area). */
function syncTrayLabel(running: boolean) {
  invoke("set_tray_timer_label", { running }).catch(() => {});
}

interface EntriesState {
  entries: TimeEntry[];
  runningEntry: TimeEntry | null;
  loaded: boolean;
  load: () => Promise<void>;
  start: (input: entriesDb.StartEntryInput) => Promise<void>;
  stop: () => Promise<void>;
  setRunningStart: (startTime: string) => Promise<void>;
  update: (id: string, patch: EntryPatch) => Promise<void>;
  setEntryTags: (id: string, tags: Tag[]) => Promise<void>;
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
    syncTrayLabel(!!runningEntry);
  },

  start: async (input) => {
    const entry = await entriesDb.startEntry(input);
    set({ entries: [entry, ...get().entries], runningEntry: entry });
    syncTrayLabel(true);
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
    syncTrayLabel(false);
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
      ...(patch.proofhubTimeEntryId !== undefined ? { proofhubTimeEntryId: patch.proofhubTimeEntryId } : {}),
      ...(patch.proofhubSyncedAt !== undefined ? { proofhubSyncedAt: patch.proofhubSyncedAt } : {}),
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

  setEntryTags: async (id, tags) => {
    set((state) => ({
      entries: state.entries.map((e) => (e.id === id ? { ...e, tags } : e)),
      runningEntry: state.runningEntry?.id === id ? { ...state.runningEntry, tags } : state.runningEntry,
    }));
    await tagsDb.setEntryTags(
      id,
      tags.map((t) => t.id),
    );
  },

  remove: async (id) => {
    await entriesDb.deleteEntry(id);
    set({
      entries: get().entries.filter((e) => e.id !== id),
      runningEntry: get().runningEntry?.id === id ? null : get().runningEntry,
    });
  },
}));
