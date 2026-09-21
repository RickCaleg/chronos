import type { TimeEntry } from "../../types";
import type { ProofHubProjectMap } from "../../db/proofhubSettings";
import { linksTasks } from "../../db/proofhubSettings";
import { useProofHubStore } from "./useProofHubStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { formatLocalDate, nowIso } from "../../lib/time";
import {
  applyRemoteCheck,
  encodeRemoteRef,
  planSync,
  refKey,
  unitDescription,
  unitMinutes,
  type RemoteEntryState,
  type RemoteRef,
  type SyncUnit,
} from "./plan";
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
let memo: {
  entries: TimeEntry[];
  projectMap: ProofHubProjectMap;
  grouped: boolean;
  remote: Record<string, RemoteEntryState>;
  plan: SyncPlan;
} | null = null;

/**
 * The current plan, shared by every row and day header and recomputed only
 * when entries, mappings, the grouping setting or what the last check saw
 * in ProofHub actually change — not once per badge per render.
 */
export function useSyncPlan(): SyncPlan {
  const entries = useEntriesStore((s) => s.entries);
  const installed = useProofHubStore((s) => s.installed);
  const projectMap = useProofHubStore((s) => s.projectMap);
  const grouped = useProofHubStore((s) => s.groupPushesByDay);
  const remote = useProofHubStore((s) => s.remoteEntries);
  if (!installed) return EMPTY_PLAN;
  if (
    !memo ||
    memo.entries !== entries ||
    memo.projectMap !== projectMap ||
    memo.grouped !== grouped ||
    memo.remote !== remote
  ) {
    const units = applyRemoteCheck(planSync(entries, projectMap, grouped), remote);
    const byEntryId = new Map<string, SyncUnit>();
    for (const unit of units) for (const entry of unit.entries) byEntryId.set(entry.id, unit);
    memo = { entries, projectMap, grouped, remote, plan: { units, byEntryId } };
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

  const totalMinutes = unitMinutes(unit);
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
    description: unitDescription(unit),
    ...(task ? { listId: task.listId, taskId: task.id } : {}),
  });

  const ref = encodeRemoteRef({ ...unit.target, timeId: result.id });
  const syncedAt = nowIso();
  useProofHubStore.getState().setRemoteEntries({
    [ref]: { exists: true, minutes: totalMinutes, date: formatLocalDate(first.startTime) },
  });
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

interface CheckResult extends RemoteRef {
  exists: boolean;
  loggedHours: number | null;
  loggedMins: number | null;
  date: string | null;
}

/**
 * Asks ProofHub whether the entries behind these units still exist and
 * what they hold, so units deleted or edited there turn `missing`/`changed`
 * (see `applyRemoteCheck` in plan.ts). Only units already sent have
 * anything to check.
 */
export async function checkUnits(units: SyncUnit[]): Promise<void> {
  const refs = units.map((unit) => unit.reuse).filter((ref): ref is RemoteRef => ref !== null);
  if (refs.length === 0) return;
  const { call, setRemoteEntries } = useProofHubStore.getState();
  const results = await call<CheckResult[]>("check-entries", { entries: refs });
  const states: Record<string, RemoteEntryState> = {};
  for (const r of results) {
    const minutes = r.loggedHours === null && r.loggedMins === null ? null : (r.loggedHours ?? 0) * 60 + (r.loggedMins ?? 0);
    states[refKey(r)] = r.exists ? { exists: true, minutes, date: r.date } : { exists: false };
  }
  setRemoteEntries(states);
}

/**
 * Makes Chronos forget a unit was ever sent, so it shows up as new. Doesn't
 * touch ProofHub: if the entry still exists there, sending again creates a
 * second one — which is why the UI asks first.
 */
export async function forgetUnit(unit: SyncUnit): Promise<void> {
  const { update } = useEntriesStore.getState();
  for (const entry of unit.entries) {
    await update(entry.id, { proofhubTimeEntryId: null, proofhubSyncedAt: null });
  }
  useProofHubStore.getState().setSendState(unit.entries.map((e) => e.id), false, null);
}
