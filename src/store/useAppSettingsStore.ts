import { create } from "zustand";

const STORAGE_KEY = "chronos.groupSimilarEntries";
const SHORTCUT_STORAGE_KEY = "chronos.globalShortcut";

export const DEFAULT_GLOBAL_SHORTCUT = "Ctrl+Alt+Space";

function readInitial(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // ignore
  }
  return true;
}

function readShortcut(): string {
  try {
    return localStorage.getItem(SHORTCUT_STORAGE_KEY) || DEFAULT_GLOBAL_SHORTCUT;
  } catch {
    return DEFAULT_GLOBAL_SHORTCUT;
  }
}

interface AppSettingsState {
  groupSimilarEntries: boolean;
  setGroupSimilarEntries: (value: boolean) => void;
  globalShortcut: string;
  setGlobalShortcut: (value: string) => void;
}

export const useAppSettingsStore = create<AppSettingsState>((set) => ({
  groupSimilarEntries: readInitial(),
  setGroupSimilarEntries: (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // ignore
    }
    set({ groupSimilarEntries: value });
  },
  globalShortcut: readShortcut(),
  setGlobalShortcut: (value) => {
    try {
      localStorage.setItem(SHORTCUT_STORAGE_KEY, value);
    } catch {
      // ignore
    }
    set({ globalShortcut: value });
  },
}));
