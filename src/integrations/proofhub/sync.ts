import type { TimeEntry } from "../../types";
import { useProofHubStore } from "./useProofHubStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { formatLocalDate } from "../../lib/time";

/** Pushes (or, if already synced, updates) one entry to its mapped ProofHub project/timesheet. Throws with a user-facing message on failure — callers surface it, they don't need to interpret it. */
export async function pushEntryToProofHub(entry: TimeEntry): Promise<void> {
  const { projectMap, call } = useProofHubStore.getState();
  if (!entry.projectId) throw new Error("This entry has no project, so there's nothing to map to ProofHub.");
  const mapping = projectMap[entry.projectId];
  if (!mapping) throw new Error("This entry's project isn't mapped to a ProofHub project yet.");

  const totalMinutes = Math.round((entry.durationSeconds ?? 0) / 60);
  const loggedHours = Math.floor(totalMinutes / 60);
  const loggedMins = totalMinutes % 60;

  const basePayload = {
    projectId: mapping.proofhubProjectId,
    timesheetId: mapping.timesheetId,
    loggedHours,
    loggedMins,
    date: formatLocalDate(entry.startTime),
    status: mapping.defaultBillable ? "billable" : "none",
    description: entry.taskNumber ? `${entry.taskNumber} - ${entry.description}` : entry.description,
    ...(mapping.todolistId && mapping.taskId ? { listId: mapping.todolistId, taskId: mapping.taskId } : {}),
  };

  let proofhubTimeEntryId = entry.proofhubTimeEntryId;
  if (proofhubTimeEntryId) {
    await call("update-entry", { ...basePayload, timeId: proofhubTimeEntryId });
  } else {
    const result = await call<{ id: string }>("push-entry", basePayload);
    proofhubTimeEntryId = result.id || null;
  }

  await useEntriesStore.getState().update(entry.id, {
    proofhubTimeEntryId,
    proofhubSyncedAt: new Date().toISOString(),
  });
}

/** Whether this entry's project has a ProofHub mapping at all — gates whether any sync affordance should render. */
export function isProofHubMappable(entry: TimeEntry): boolean {
  if (!entry.projectId) return false;
  return Boolean(useProofHubStore.getState().projectMap[entry.projectId]);
}
