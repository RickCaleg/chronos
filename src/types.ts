export interface Project {
  id: string;
  name: string;
  color: string;
  alias: string | null;
  archived: boolean;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  description: string;
  taskNumber: string | null;
  projectId: string | null;
  startTime: string; // ISO 8601 UTC
  endTime: string | null; // ISO 8601 UTC, null while running
  durationSeconds: number | null; // null while running
  isRunning: boolean;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
  proofhubTimeEntryId: string | null;
  proofhubSyncedAt: string | null;
}

export interface Backup {
  version: 1;
  exportedAt: string;
  projects: Project[];
  timeEntries: TimeEntry[];
  tags?: Tag[];
}
