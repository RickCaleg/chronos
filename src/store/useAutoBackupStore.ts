import { create } from "zustand";

const KEY_ENABLED = "chronos.autoBackup.enabled";
const KEY_FOLDER = "chronos.autoBackup.folder";
const KEY_INTERVAL_HOURS = "chronos.autoBackup.intervalHours";
const KEY_LAST_AT = "chronos.autoBackup.lastAt";

const DEFAULT_INTERVAL_HOURS = 24;

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

interface AutoBackupState {
  enabled: boolean;
  folder: string | null;
  intervalHours: number;
  lastBackupAt: string | null;
  setEnabled: (value: boolean) => void;
  setFolder: (value: string | null) => void;
  setIntervalHours: (value: number) => void;
  setLastBackupAt: (value: string) => void;
}

export const useAutoBackupStore = create<AutoBackupState>((set) => ({
  enabled: readString(KEY_ENABLED) === "true",
  folder: readString(KEY_FOLDER),
  intervalHours: Number(readString(KEY_INTERVAL_HOURS)) || DEFAULT_INTERVAL_HOURS,
  lastBackupAt: readString(KEY_LAST_AT),

  setEnabled: (value) => {
    writeString(KEY_ENABLED, String(value));
    set({ enabled: value });
  },
  setFolder: (value) => {
    writeString(KEY_FOLDER, value);
    set({ folder: value });
  },
  setIntervalHours: (value) => {
    writeString(KEY_INTERVAL_HOURS, String(value));
    set({ intervalHours: value });
  },
  setLastBackupAt: (value) => {
    writeString(KEY_LAST_AT, value);
    set({ lastBackupAt: value });
  },
}));
