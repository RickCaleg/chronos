import { platform } from "@platform";
import type { Backup } from "../types";
import * as projectsDb from "../db/projects";
import * as entriesDb from "../db/entries";
import * as tagsDb from "../db/tags";
import { nowIso } from "./time";
import { useAutoBackupStore } from "../store/useAutoBackupStore";

const FILE_PREFIX = "chronos-auto-backup-";
const FILE_SUFFIX = ".json";

function backupFileName(iso: string): string {
  // Colons aren't safe in filenames on Windows.
  const safe = iso.replace(/:/g, "-").split(".")[0];
  return `${FILE_PREFIX}${safe}${FILE_SUFFIX}`;
}

/** Deletes the oldest auto-backups beyond `retentionCount`. A count of 1 keeps just the latest, i.e. each backup overwrites the previous one. */
async function cleanupOldBackups(fs: NonNullable<typeof platform.backupFolder>, folder: string): Promise<void> {
  const { retentionCount } = useAutoBackupStore.getState();
  const names = (await fs.listFiles(folder))
    .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
    .sort();

  const excess = names.length - retentionCount;
  if (excess <= 0) return;

  for (const name of names.slice(0, excess)) {
    await fs.removeFile(folder, name).catch(() => {});
  }
}

/** Writes a full JSON backup to the configured folder now, regardless of schedule, and updates lastBackupAt. */
export async function performAutoBackup(): Promise<void> {
  const fs = platform.backupFolder;
  const { folder } = useAutoBackupStore.getState();
  if (!fs || !folder) return;

  await fs.ensure(folder);

  const [projects, timeEntries, tags] = await Promise.all([
    projectsDb.listProjects(),
    entriesDb.listEntries(),
    tagsDb.listTags(),
  ]);
  const backup: Backup = { version: 1, exportedAt: nowIso(), projects, timeEntries, tags };

  const now = nowIso();
  await fs.writeFile(folder, backupFileName(now), JSON.stringify(backup, null, 2));

  useAutoBackupStore.getState().setLastBackupAt(now);
  await cleanupOldBackups(fs, folder).catch(() => {});
}

/** Checks whether an auto-backup is due (enabled, folder set, enough time elapsed) and runs it if so. Safe to call often. */
export async function runAutoBackupIfDue(): Promise<void> {
  const { enabled, folder, intervalHours, lastBackupAt } = useAutoBackupStore.getState();
  if (!platform.backupFolder || !enabled || !folder) return;

  if (!lastBackupAt) {
    await performAutoBackup();
    return;
  }

  const elapsedHours = (Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60);
  if (elapsedHours >= intervalHours) {
    await performAutoBackup();
  }
}
