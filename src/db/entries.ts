import { getDb } from "./client";
import type { TimeEntry } from "../types";
import { nowIso } from "../lib/time";

interface EntryRow {
  id: string;
  description: string;
  task_number: string | null;
  project_id: string | null;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  is_running: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    description: row.description,
    taskNumber: row.task_number,
    projectId: row.project_id,
    startTime: row.start_time,
    endTime: row.end_time,
    durationSeconds: row.duration_seconds,
    isRunning: row.is_running === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEntries(): Promise<TimeEntry[]> {
  const db = await getDb();
  const rows = await db.select<EntryRow[]>("SELECT * FROM time_entries ORDER BY start_time DESC");
  return rows.map(fromRow);
}

export async function getRunningEntry(): Promise<TimeEntry | null> {
  const db = await getDb();
  const rows = await db.select<EntryRow[]>("SELECT * FROM time_entries WHERE is_running = 1 LIMIT 1");
  return rows.length ? fromRow(rows[0]) : null;
}

export interface StartEntryInput {
  description: string;
  taskNumber: string | null;
  projectId: string | null;
  startTime: string;
}

export async function startEntry(input: StartEntryInput): Promise<TimeEntry> {
  const db = await getDb();
  const now = nowIso();
  const entry: TimeEntry = {
    id: crypto.randomUUID(),
    description: input.description,
    taskNumber: input.taskNumber,
    projectId: input.projectId,
    startTime: input.startTime,
    endTime: null,
    durationSeconds: null,
    isRunning: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    `INSERT INTO time_entries
      (id, description, task_number, project_id, start_time, end_time, duration_seconds, is_running, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL, 1, $6, $6)`,
    [entry.id, entry.description, entry.taskNumber, entry.projectId, entry.startTime, now],
  );
  return entry;
}

export async function stopEntry(id: string, endTime: string, durationSeconds: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE time_entries SET end_time = $1, duration_seconds = $2, is_running = 0, updated_at = $3 WHERE id = $4",
    [endTime, durationSeconds, nowIso(), id],
  );
}

export interface EntryPatch {
  description?: string;
  taskNumber?: string | null;
  projectId?: string | null;
  startTime?: string;
  endTime?: string | null;
  durationSeconds?: number | null;
}

export async function updateEntry(id: string, patch: EntryPatch): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const map: Record<string, unknown> = {
    description: patch.description,
    task_number: patch.taskNumber,
    project_id: patch.projectId,
    start_time: patch.startTime,
    end_time: patch.endTime,
    duration_seconds: patch.durationSeconds,
  };

  for (const [column, value] of Object.entries(map)) {
    if (value !== undefined) {
      fields.push(`${column} = $${i}`);
      values.push(value);
      i++;
    }
  }
  if (fields.length === 0) return;
  fields.push(`updated_at = $${i}`);
  values.push(nowIso());
  i++;
  values.push(id);

  await db.execute(`UPDATE time_entries SET ${fields.join(", ")} WHERE id = $${i}`, values);
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM time_entries WHERE id = $1", [id]);
}

export async function replaceAllEntries(entries: TimeEntry[]): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM time_entries");
  for (const e of entries) {
    await db.execute(
      `INSERT INTO time_entries
        (id, description, task_number, project_id, start_time, end_time, duration_seconds, is_running, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        e.id,
        e.description,
        e.taskNumber,
        e.projectId,
        e.startTime,
        e.endTime,
        e.durationSeconds,
        e.isRunning ? 1 : 0,
        e.createdAt,
        e.updatedAt,
      ],
    );
  }
}
