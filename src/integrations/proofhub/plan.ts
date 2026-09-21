import type { TimeEntry } from "../../types";
import type { ProofHubProjectMap } from "../../db/proofhubSettings";
import { groupSimilarEntries } from "../../lib/grouping";
import { dayKey } from "../../lib/time";

/**
 * Pure sync planning — decides, for every entry, which ProofHub time entry
 * it belongs to, without touching the network or the database. See
 * docs/proofhub-integration.md section 8 for the model in prose.
 *
 * A *unit* is whatever becomes exactly one ProofHub time entry: a single
 * Chronos entry, or (with "group pushes by day" on) every entry on the same
 * day sharing task number, description and project — except entries with
 * a note, which always go on their own, carrying it as their description. Every unit either
 * reuses one existing ProofHub entry that Chronos created earlier (updated
 * in place) or creates a new one; ProofHub entries that no unit reuses any
 * more (grouping toggled, mapping changed, entries regrouped) are
 * "orphans", deleted when the unit that last referenced them is sent — so
 * hours are never counted twice.
 */

/** Where a ProofHub time entry lives. */
export interface RemoteRef {
  projectId: string;
  timesheetId: string;
  timeId: string;
}

/**
 * Stored in `time_entries.proofhub_time_entry_id` as
 * "projectId/timesheetId/timeId", so a changed project mapping can still
 * find (and clean up) the entry in its old timesheet. A bare id is a push
 * from before 0.5.5, assumed to live wherever the project is mapped now.
 */
export function encodeRemoteRef(ref: RemoteRef): string {
  return `${ref.projectId}/${ref.timesheetId}/${ref.timeId}`;
}

export function decodeRemoteRef(
  value: string | null,
  fallback: { projectId: string; timesheetId: string } | null,
): RemoteRef | null {
  if (!value) return null;
  const parts = value.split("/");
  if (parts.length === 3) return { projectId: parts[0], timesheetId: parts[1], timeId: parts[2] };
  return fallback ? { ...fallback, timeId: value } : null;
}

/**
 * `missing`/`changed` are `synced` units that a check against ProofHub
 * (`applyRemoteCheck`) found deleted there, or with different hours/date.
 */
function hasNote(entry: TimeEntry): boolean {
  return !!entry.note?.trim();
}

/**
 * The text a unit's ProofHub entry gets: its note when it has one (only a
 * lone entry can, see `planSync`), otherwise the entry's name.
 */
export function unitDescription(unit: Pick<SyncUnit, "entries">): string {
  const first = unit.entries[0];
  if (hasNote(first)) return first.note!.trim();
  return first.taskNumber ? `${first.taskNumber} - ${first.description}` : first.description;
}

/**
 * Splits a same-task group so each entry with a note is its own unit. The
 * note-less rest stays summed and comes first, so it's the one that keeps
 * the group's existing ProofHub entry when an entry gains a note.
 */
function splitNoted(group: TimeEntry[]): TimeEntry[][] {
  const rest = group.filter((entry) => !hasNote(entry));
  const noted = group.filter(hasNote).map((entry) => [entry]);
  return rest.length > 0 ? [rest, ...noted] : noted;
}

export type UnitStatus = "new" | "pending" | "synced" | "missing" | "changed";

export interface SyncUnit {
  /** Stable while the unit's membership doesn't change: its entry ids, joined. */
  key: string;
  day: string;
  /** Sorted by start time; `entries[0]` supplies task number/description. */
  entries: TimeEntry[];
  totalSeconds: number;
  chronosProjectId: string;
  target: { projectId: string; timesheetId: string };
  /** The existing ProofHub entry to update in place, if any. */
  reuse: RemoteRef | null;
  /** ProofHub entries to delete when this unit is sent. */
  orphans: RemoteRef[];
  /** Entries outside this unit that still point at `reuse`/`orphans` — detached once this unit is sent. */
  releaseEntryIds: string[];
  status: UnitStatus;
}

export const refKey = (ref: RemoteRef) => encodeRemoteRef(ref);

/** What a unit's ProofHub entry is sent as: whole minutes, dated by its first entry's local day. */
export function unitMinutes(unit: Pick<SyncUnit, "totalSeconds">): number {
  return Math.round(unit.totalSeconds / 60);
}

/** A ProofHub time entry as last seen by a check (or written by a send). */
export type RemoteEntryState =
  | { exists: false }
  | { exists: true; minutes: number | null; date: string | null };

/**
 * Marks `synced` units whose ProofHub entry a check found deleted
 * (`missing`) or holding other hours or another date than Chronos sent
 * (`changed`). Units never checked keep their status — Chronos can't know.
 */
export function applyRemoteCheck(units: SyncUnit[], remote: Record<string, RemoteEntryState>): SyncUnit[] {
  return units.map((unit) => {
    if (unit.status !== "synced" || !unit.reuse) return unit;
    const state = remote[refKey(unit.reuse)];
    if (!state) return unit;
    if (!state.exists) return { ...unit, status: "missing" };
    const hoursDiffer = state.minutes !== null && state.minutes !== unitMinutes(unit);
    const dateDiffers = state.date !== null && state.date !== unit.day;
    return hoursDiffer || dateDiffers ? { ...unit, status: "changed" } : unit;
  });
}

/** Plans every finished entry whose project is mapped. Units come back in chronological order. */
export function planSync(entries: TimeEntry[], projectMap: ProofHubProjectMap, grouped: boolean): SyncUnit[] {
  const eligible = entries
    .filter((e) => !e.isRunning && e.projectId && projectMap[e.projectId])
    .sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));

  const byDay = new Map<string, TimeEntry[]>();
  for (const entry of eligible) {
    const day = dayKey(entry.startTime);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }

  const drafts: Omit<SyncUnit, "reuse" | "orphans" | "releaseEntryIds" | "status">[] = [];
  for (const [day, dayEntries] of byDay) {
    const groups = grouped
      ? groupSimilarEntries(dayEntries).flatMap((item) => splitNoted(Array.isArray(item) ? item : [item]))
      : dayEntries.map((entry) => [entry]);
    for (const group of groups) {
      const mapping = projectMap[group[0].projectId!];
      drafts.push({
        key: group.map((e) => e.id).join(","),
        day,
        entries: group,
        totalSeconds: group.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0),
        chronosProjectId: group[0].projectId!,
        target: { projectId: mapping.proofhubProjectId, timesheetId: mapping.timesheetId },
      });
    }
  }

  // Which unit(s) reference each ProofHub entry, and through which entries.
  const refOf = new Map<string, RemoteRef | null>();
  const referencedBy = new Map<string, { ref: RemoteRef; unitIndexes: Set<number>; entryIds: string[] }>();
  drafts.forEach((unit, index) => {
    for (const entry of unit.entries) {
      const ref = decodeRemoteRef(entry.proofhubTimeEntryId, unit.target);
      refOf.set(entry.id, ref);
      if (!ref) continue;
      const key = refKey(ref);
      if (!referencedBy.has(key)) referencedBy.set(key, { ref, unitIndexes: new Set(), entryIds: [] });
      referencedBy.get(key)!.unitIndexes.add(index);
      referencedBy.get(key)!.entryIds.push(entry.id);
    }
  });

  // Each ProofHub entry is reused by at most one unit (the earliest that
  // references it), and only if it's in the unit's current timesheet.
  const claimedBy = new Map<string, number>();
  const reuse: (RemoteRef | null)[] = drafts.map((unit, index) => {
    for (const entry of unit.entries) {
      const ref = refOf.get(entry.id);
      if (!ref || claimedBy.has(refKey(ref))) continue;
      if (ref.projectId !== unit.target.projectId || ref.timesheetId !== unit.target.timesheetId) continue;
      claimedBy.set(refKey(ref), index);
      return ref;
    }
    return null;
  });

  // Unclaimed ProofHub entries are cleaned up by the first unit pointing at them.
  const orphans: RemoteRef[][] = drafts.map(() => []);
  for (const [key, { ref, unitIndexes }] of referencedBy) {
    if (!claimedBy.has(key)) orphans[Math.min(...unitIndexes)].push(ref);
  }

  return drafts.map((unit, index) => {
    const ownIds = new Set(unit.entries.map((e) => e.id));
    const touched = [reuse[index], ...orphans[index]].filter((r): r is RemoteRef => r !== null);
    const releaseEntryIds = touched.flatMap((ref) =>
      referencedBy.get(refKey(ref))!.entryIds.filter((id) => !ownIds.has(id)),
    );

    const own = reuse[index];
    const synced =
      own !== null &&
      orphans[index].length === 0 &&
      releaseEntryIds.length === 0 &&
      unit.entries.every((e) => e.proofhubSyncedAt && refOf.get(e.id) && refKey(refOf.get(e.id)!) === refKey(own));
    const untouched = unit.entries.every((e) => !e.proofhubTimeEntryId);

    return {
      ...unit,
      reuse: own,
      orphans: orphans[index],
      releaseEntryIds,
      status: synced ? "synced" : untouched ? "new" : "pending",
    };
  });
}
