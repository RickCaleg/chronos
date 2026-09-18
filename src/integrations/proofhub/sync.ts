import type { TimeEntry } from "../../types";
import type { ProofHubProjectMapping } from "../../db/proofhubSettings";
import { useProofHubStore } from "./useProofHubStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { formatLocalDate } from "../../lib/time";

/**
 * ProofHub tasks have two distinct identifiers (confirmed against the real
 * API + ProofHub's own help center): `ticket` is the small, sequential
 * "#1234"-style number the UI shows and Chronos users actually type as
 * `taskNumber`; `id` is a large opaque internal id, and that's what the API
 * needs as `task_id` — the two are unrelated numbers. This resolves a
 * Chronos entry's typed ticket to the real id by listing the mapped
 * project's default task list (cached — see useProofHubStore) and matching.
 *
 * Returns `null` when task-level linking isn't applicable at all (no
 * default task list configured, or the entry has no task number) — that's
 * the normal, silent "just log at the project/timesheet level" case.
 * Throws when linking clearly *was* intended (both are set) but the ticket
 * doesn't match any task in that list — surfacing that loudly instead of
 * silently falling back, since a wrong list/typo'd ticket is exactly the
 * kind of thing that should not fail silently (see docs/proofhub-integration.md
 * section 9's note on this bug).
 */
async function resolveTaskId(mapping: ProofHubProjectMapping, representative: TimeEntry): Promise<string | null> {
  if (!mapping.todolistId || !representative.taskNumber) return null;
  const ticket = representative.taskNumber.replace(/^#/, "");
  const tasks = await useProofHubStore.getState().loadTasks(mapping.proofhubProjectId, mapping.todolistId);
  const match = tasks.find((task) => task.ticket === ticket);
  if (!match) {
    throw new Error(
      `Task ${representative.taskNumber} wasn't found in the configured task list — check the ticket number and the mapped task list.`,
    );
  }
  return match.id;
}

function buildPayload(
  mapping: ProofHubProjectMapping,
  representative: TimeEntry,
  totalSeconds: number,
  resolvedTaskId: string | null,
) {
  const totalMinutes = Math.round(totalSeconds / 60);
  const loggedHours = Math.floor(totalMinutes / 60);
  const loggedMins = totalMinutes % 60;

  return {
    projectId: mapping.proofhubProjectId,
    timesheetId: mapping.timesheetId,
    loggedHours,
    loggedMins,
    date: formatLocalDate(representative.startTime),
    status: mapping.defaultBillable ? "billable" : "none",
    description: representative.taskNumber
      ? `${representative.taskNumber} - ${representative.description}`
      : representative.description,
    ...(mapping.todolistId && resolvedTaskId ? { listId: mapping.todolistId, taskId: resolvedTaskId } : {}),
  };
}

/** Pushes (or, if already synced, updates) one entry to its mapped ProofHub project/timesheet. Throws with a user-facing message on failure — callers surface it, they don't need to interpret it. */
export async function pushEntryToProofHub(entry: TimeEntry): Promise<void> {
  const { projectMap, call } = useProofHubStore.getState();
  if (!entry.projectId) throw new Error("This entry has no project, so there's nothing to map to ProofHub.");
  const mapping = projectMap[entry.projectId];
  if (!mapping) throw new Error("This entry's project isn't mapped to a ProofHub project yet.");

  const resolvedTaskId = await resolveTaskId(mapping, entry);
  const payload = buildPayload(mapping, entry, entry.durationSeconds ?? 0, resolvedTaskId);

  let proofhubTimeEntryId = entry.proofhubTimeEntryId;
  if (proofhubTimeEntryId) {
    await call("update-entry", { ...payload, timeId: proofhubTimeEntryId });
  } else {
    const result = await call<{ id: string }>("push-entry", payload);
    proofhubTimeEntryId = result.id || null;
  }

  await useEntriesStore.getState().update(entry.id, {
    proofhubTimeEntryId,
    proofhubSyncedAt: new Date().toISOString(),
  });
}

/**
 * Sums a group of entries that share the same task number, description and
 * project (the "group similar entries" criterion — see lib/grouping.ts)
 * into a single ProofHub push, instead of one push per Chronos entry. Used
 * by DayGroup's "send day" batch action when the "group pushes by day"
 * setting is on. All entries in the group end up with the same
 * proofhubTimeEntryId/proofhubSyncedAt, since they're now represented by
 * one ProofHub time entry.
 */
export async function pushGroupedEntriesToProofHub(entries: TimeEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const representative = entries[0];
  const { projectMap, call } = useProofHubStore.getState();
  if (!representative.projectId) throw new Error("This entry has no project, so there's nothing to map to ProofHub.");
  const mapping = projectMap[representative.projectId];
  if (!mapping) throw new Error("This entry's project isn't mapped to a ProofHub project yet.");

  const resolvedTaskId = await resolveTaskId(mapping, representative);
  const totalSeconds = entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);
  const payload = buildPayload(mapping, representative, totalSeconds, resolvedTaskId);

  // If any entry in the group was already synced, update that same
  // ProofHub entry instead of creating a duplicate.
  let proofhubTimeEntryId = entries.find((e) => e.proofhubTimeEntryId)?.proofhubTimeEntryId ?? null;
  if (proofhubTimeEntryId) {
    await call("update-entry", { ...payload, timeId: proofhubTimeEntryId });
  } else {
    const result = await call<{ id: string }>("push-entry", payload);
    proofhubTimeEntryId = result.id || null;
  }

  const syncedAt = new Date().toISOString();
  const { update } = useEntriesStore.getState();
  for (const entry of entries) {
    await update(entry.id, { proofhubTimeEntryId, proofhubSyncedAt: syncedAt });
  }
}

/** Whether this entry's project has a ProofHub mapping at all — gates whether any sync affordance should render. */
export function isProofHubMappable(entry: TimeEntry): boolean {
  if (!entry.projectId) return false;
  return Boolean(useProofHubStore.getState().projectMap[entry.projectId]);
}
