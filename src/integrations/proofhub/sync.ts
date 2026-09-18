import type { TimeEntry } from "../../types";
import type { ProofHubProjectMapping } from "../../db/proofhubSettings";
import { useProofHubStore } from "./useProofHubStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { formatLocalDate } from "../../lib/time";

function buildPayload(mapping: ProofHubProjectMapping, representative: TimeEntry, totalSeconds: number) {
  const totalMinutes = Math.round(totalSeconds / 60);
  const loggedHours = Math.floor(totalMinutes / 60);
  const loggedMins = totalMinutes % 60;

  // Task-level linking is per-entry, not a fixed choice per project: a
  // mapped todolist plus this entry's own task number (e.g. "#1234") is
  // what ProofHub needs for both list_id and task_id together (see
  // docs/proofhub-integration.md section 2.2) — entries without a task
  // number, or projects without a default task list, just log at the
  // project/timesheet level.
  const taskId = representative.taskNumber ? representative.taskNumber.replace(/^#/, "") : null;

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
    ...(mapping.todolistId && taskId ? { listId: mapping.todolistId, taskId } : {}),
  };
}

/** Pushes (or, if already synced, updates) one entry to its mapped ProofHub project/timesheet. Throws with a user-facing message on failure — callers surface it, they don't need to interpret it. */
export async function pushEntryToProofHub(entry: TimeEntry): Promise<void> {
  const { projectMap, call } = useProofHubStore.getState();
  if (!entry.projectId) throw new Error("This entry has no project, so there's nothing to map to ProofHub.");
  const mapping = projectMap[entry.projectId];
  if (!mapping) throw new Error("This entry's project isn't mapped to a ProofHub project yet.");

  const payload = buildPayload(mapping, entry, entry.durationSeconds ?? 0);

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

  const totalSeconds = entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);
  const payload = buildPayload(mapping, representative, totalSeconds);

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
