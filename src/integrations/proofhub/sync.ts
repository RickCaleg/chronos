import type { TimeEntry } from "../../types";
import type { ProofHubProjectMap } from "../../db/proofhubSettings";
import { linksTasks } from "../../db/proofhubSettings";
import { useProofHubStore } from "./useProofHubStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { formatLocalDate, nowIso } from "../../lib/time";
import { encodeRemoteRef, planSync, type SyncUnit } from "./plan";
import i18n from "../../i18n";

/**
 * Executes the plans from plan.ts: every send goes through `sendUnits`,
 * whether it's one row's button or the day's. See
 * docs/proofhub-integration.md section 8.
 */

export interface SyncPlan {
  units: SyncUnit[];
  byEntryId: Map<string, SyncUnit>;
}

const EMPTY_PLAN: SyncPlan = { units: [], byEntryId: new Map() };
let memo: { entries: TimeEntry[]; projectMap: ProofHubProjectMap; grouped: boolean; plan: SyncPlan } | null = null;

/**
 * The current plan, shared by every row and day header and recomputed only
 * when entries, mappings or the grouping setting actually change — not
 * once per badge per render.
 */
export function useSyncPlan(): SyncPlan {
  const entries = useEntriesStore((s) => s.entries);
  const installed = useProofHubStore((s) => s.installed);
  const projectMap = useProofHubStore((s) => s.projectMap);
  const grouped = useProofHubStore((s) => s.groupPushesByDay);
  if (!installed) return EMPTY_PLAN;
  if (!memo || memo.entries !== entries || memo.projectMap !== projectMap || memo.grouped !== grouped) {
    const units = planSync(entries, projectMap, grouped);
    const byEntryId = new Map<string, SyncUnit>();
    for (const unit of units) for (const entry of unit.entries) byEntryId.set(entry.id, unit);
    memo = { entries, projectMap, grouped, plan: { units, byEntryId } };
  }
  return memo.plan;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function sendUnit(unit: SyncUnit): Promise<void> {
  const { projectMap, call, findTask } = useProofHubStore.getState();
  const mapping = projectMap[unit.chronosProjectId];
  const first = unit.entries[0];

  const totalMinutes = Math.round(unit.totalSeconds / 60);
  if (totalMinutes === 0) throw new Error(i18n.t("proofhub.errorUnderAMinute"));

  // ProofHub's UI shows tasks by "#ticket", but the API needs the task's
  // internal id — two unrelated numbers — so resolve one to the other.
  let task = null;
  if (linksTasks(mapping) && first.taskNumber) {
    task = await findTask(unit.target.projectId, first.taskNumber.replace(/^#/, ""));
    if (!task) throw new Error(i18n.t("proofhub.errorTaskNotFound", { task: first.taskNumber }));
  }

  for (const orphan of unit.orphans) {
    await call("delete-entry", { projectId: orphan.projectId, timesheetId: orphan.timesheetId, timeId: orphan.timeId });
  }

  const result = await call<{ id: string }>("upsert-entry", {
    projectId: unit.target.projectId,
    timesheetId: unit.target.timesheetId,
    timeId: unit.reuse?.timeId ?? null,
    loggedHours: Math.floor(totalMinutes / 60),
    loggedMins: totalMinutes % 60,
    date: formatLocalDate(first.startTime),
    status: mapping.defaultBillable ? "billable" : "none",
    description: first.taskNumber ? `${first.taskNumber} - ${first.description}` : first.description,
    ...(task ? { listId: task.listId, taskId: task.id } : {}),
  });

  const ref = encodeRemoteRef({ ...unit.target, timeId: result.id });
  const syncedAt = nowIso();
  const { update } = useEntriesStore.getState();
  for (const id of unit.releaseEntryIds) {
    await update(id, { proofhubTimeEntryId: null, proofhubSyncedAt: null });
  }
  for (const entry of unit.entries) {
    await update(entry.id, { proofhubTimeEntryId: ref, proofhubSyncedAt: syncedAt });
  }
}

/**
 * Sends units one after another (ProofHub rate limits are handled by the
 * plugin, which waits out a 429). A failed unit doesn't stop the rest; its
 * error is kept on its rows until the next successful send. Returns the
 * error messages, in order.
 */
export async function sendUnits(units: SyncUnit[]): Promise<string[]> {
  const { setSendState } = useProofHubStore.getState();
  const errors: string[] = [];
  for (const unit of units) {
    const ids = unit.entries.map((e) => e.id);
    setSendState(ids, true);
    try {
      await sendUnit(unit);
      setSendState(ids, false, null);
    } catch (err) {
      const message = errorMessage(err);
      errors.push(message);
      setSendState(ids, false, message);
    }
  }
  return errors;
}
