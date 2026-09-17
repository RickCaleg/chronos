import { exists, mkdir, readDir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { Backup } from "../types";
import * as projectsDb from "../db/projects";
import * as entriesDb from "../db/entries";
import { nowIso } from "./time";
import { useAutoBackupStore } from "../store/useAutoBackupStore";

const FILE_PREFIX = "chronos-auto-backup-";
const FILE_SUFFIX = ".json";
/** How many auto-backups to keep in the target folder before pruning the oldest. Not user-configurable, to keep the feature's settings surface small. */
const RETENTION_COUNT = 20;

function backupFileName(iso: string): string {
  // Colons aren't safe in filenames on Windows.
  const safe = iso.replace(/:/g, "-").split(".")[0];
  return `${FILE_PREFIX}${safe}${FILE_SUFFIX}`;
}

async function cleanupOldBackups(folder: string): Promise<void> {
  const dirEntries = await readDir(folder);
  const names = dirEntries
    .filter((e) => e.isFile && e.name.startsWith(FILE_PREFIX) && e.name.endsWith(FILE_SUFFIX))
    .map((e) => e.name)
    .sort();

  const excess = names.length - RETENTION_COUNT;
  if (excess <= 0) return;

  for (const name of names.slice(0, excess)) {
    const path = await join(folder, name);
    await remove(path).catch(() => {});
  }
}

/** Writes a full JSON backup to the configured folder now, regardless of schedule, and updates lastBackupAt. */
export async function performAutoBackup(): Promise<void> {
  const { folder } = useAutoBackupStore.getState();
  if (!folder) return;

  if (!(await exists(folder))) {
    await mkdir(folder, { recursive: true });
  }

  const [projects, timeEntries] = await Promise.all([projectsDb.listProjects(), entriesDb.listEntries()]);
  const backup: Backup = { version: 1, exportedAt: nowIso(), projects, timeEntries };

  const now = nowIso();
  const path = await join(folder, backupFileName(now));
  await writeTextFile(path, JSON.stringify(backup, null, 2));

  useAutoBackupStore.getState().setLastBackupAt(now);
  await cleanupOldBackups(folder).catch(() => {});
}

/** Checks whether an auto-backup is due (enabled, folder set, enough time elapsed) and runs it if so. Safe to call often. */
export async function runAutoBackupIfDue(): Promise<void> {
  const { enabled, folder, intervalHours, lastBackupAt } = useAutoBackupStore.getState();
  if (!enabled || !folder) return;

  if (!lastBackupAt) {
    await performAutoBackup();
    return;
  }

  const elapsedHours = (Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60);
  if (elapsedHours >= intervalHours) {
    await performAutoBackup();
  }
}
