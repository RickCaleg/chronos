import { getDb } from "./client";

/**
 * Reuses the existing (previously unused) `settings` key/value table for
 * the ProofHub project/timesheet mapping — non-secret, low-cardinality
 * config, deliberately NOT the API key (see src-tauri/src/proofhub_credentials.rs)
 * and deliberately excluded from JSON backups, since exportImport.ts/autoBackup.ts
 * only ever SELECT the tables they need, never this one.
 */

export interface ProofHubProjectMapping {
  proofhubProjectId: string;
  proofhubProjectTitle: string;
  timesheetId: string;
  timesheetTitle: string;
  defaultBillable: boolean;
  /**
   * Optional default task list, used for per-entry task-level linking: a
   * pushed entry with a `taskNumber` (e.g. "#1234") sends `1234` as the
   * ProofHub task id within this list. Without this set, entries always
   * log at the project/timesheet level regardless of their task number.
   */
  todolistId?: string;
}

export type ProofHubProjectMap = Record<string, ProofHubProjectMapping>;

const PROJECT_MAP_KEY = "proofhub.projectMap";

interface SettingsRow {
  value: string;
}

export async function getProjectMap(): Promise<ProofHubProjectMap> {
  const db = await getDb();
  const rows = await db.select<SettingsRow[]>("SELECT value FROM settings WHERE key = $1", [PROJECT_MAP_KEY]);
  if (!rows.length) return {};
  try {
    return JSON.parse(rows[0].value) as ProofHubProjectMap;
  } catch {
    return {};
  }
}

export async function setProjectMapping(chronosProjectId: string, mapping: ProofHubProjectMapping): Promise<void> {
  const map = await getProjectMap();
  map[chronosProjectId] = mapping;
  await saveProjectMap(map);
}

export async function removeProjectMapping(chronosProjectId: string): Promise<void> {
  const map = await getProjectMap();
  delete map[chronosProjectId];
  await saveProjectMap(map);
}

async function saveProjectMap(map: ProofHubProjectMap): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)", [
    PROJECT_MAP_KEY,
    JSON.stringify(map),
  ]);
}

const GROUP_PUSHES_BY_DAY_KEY = "proofhub.groupPushesByDay";

/**
 * When on, "Send day to ProofHub" sums entries that share the same task
 * number, description and project (the same criterion as the "group
 * similar entries" display option — see lib/grouping.ts) into a single
 * ProofHub time entry per group, instead of one push per Chronos entry.
 */
export async function getGroupPushesByDay(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<SettingsRow[]>("SELECT value FROM settings WHERE key = $1", [GROUP_PUSHES_BY_DAY_KEY]);
  return rows.length ? rows[0].value === "true" : false;
}

export async function setGroupPushesByDay(value: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)", [
    GROUP_PUSHES_BY_DAY_KEY,
    String(value),
  ]);
}
