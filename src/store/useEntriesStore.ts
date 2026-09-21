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
  /** Adds a finished entry by hand; the running timer, if any, is untouched. */
  add: (input: entriesDb.AddEntryInput, tags: Tag[]) => Promise<void>;
  stop: () => Promise<void>;
  /** Stops the running timer without keeping it: the entry is deleted. */
  discard: () => Promise<void>;
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

  add: async (input, tags) => {
    const entry = await entriesDb.addEntry(input);
    if (tags.length > 0) {
      await tagsDb.setEntryTags(
        entry.id,
        tags.map((t) => t.id),
      );
    }
    const added = { ...entry, tags };
    // Kept newest-first, like listEntries.
    set({ entries: [...get().entries, added].sort((a, b) => (a.startTime < b.startTime ? 1 : -1)) });
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

  discard: async () => {
    const running = get().runningEntry;
    if (!running) return;
    await entriesDb.deleteEntry(running.id);
    set({ entries: get().entries.filter((e) => e.id !== running.id), runningEntry: null });
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
    // Mirrors updateEntry in db/entries.ts: a content edit un-syncs the
    // entry unless the patch sets proofhubSyncedAt itself — otherwise its
    // ProofHub badge kept a stale checkmark until the next restart.
    const unsyncs =
      patch.proofhubSyncedAt === undefined &&
      [
        patch.description,
        patch.taskNumber,
        patch.projectId,
        patch.startTime,
        patch.endTime,
        patch.durationSeconds,
        patch.note,
      ].some((v) => v !== undefined);
    const applyPatch = (e: TimeEntry): TimeEntry => ({
      ...e,
      ...(unsyncs ? { proofhubSyncedAt: null } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.taskNumber !== undefined ? { taskNumber: patch.taskNumber } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
      ...(patch.endTime !== undefined ? { endTime: patch.endTime } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
      ...(patch.proofhubTimeEntryId !== undefined ? { proofhubTimeEntryId: patch.proofhubTimeEntryId } : {}),
      ...(patch.proofhubSyncedAt !== undefined ? { proofhubSyncedAt: patch.proofhubSyncedAt } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
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
    const removed = get().entries.find((e) => e.id === id);
    await entriesDb.deleteEntry(id);
    // A ProofHub time entry shared with other entries (a grouped push)
    // still includes the deleted entry's time: mark the rest for resending
    // so the total gets corrected.
    const ref = removed?.proofhubTimeEntryId;
    const siblings = ref ? get().entries.filter((e) => e.id !== id && e.proofhubTimeEntryId === ref && e.proofhubSyncedAt) : [];
    for (const sibling of siblings) await entriesDb.updateEntry(sibling.id, { proofhubSyncedAt: null });
    const siblingIds = new Set(siblings.map((e) => e.id));
    set({
      entries: get()
        .entries.filter((e) => e.id !== id)
        .map((e) => (siblingIds.has(e.id) ? { ...e, proofhubSyncedAt: null } : e)),
      runningEntry: get().runningEntry?.id === id ? null : get().runningEntry,
    });
  },
}));
