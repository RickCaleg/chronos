import { create } from "zustand";

const STORAGE_KEY = "chronos.groupSimilarEntries";

function readInitial(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // ignore
  }
  return true;
}

interface AppSettingsState {
  groupSimilarEntries: boolean;
  setGroupSimilarEntries: (value: boolean) => void;
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
}));
