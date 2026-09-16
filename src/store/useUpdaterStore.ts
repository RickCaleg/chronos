import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  body: string | null;
  progress: number;
  error: string | null;
  update: Update | null;
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restart: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  body: null,
  progress: 0,
  error: null,
  update: null,

  checkForUpdates: async () => {
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", version: update.version, body: update.body ?? null, update });
      } else {
        set({ status: "up-to-date", update: null });
      }
    } catch (err) {
      set({ status: "error", error: String(err) });
    }
  },

  downloadAndInstall: async () => {
    const update = get().update;
    if (!update) return;
    set({ status: "downloading", progress: 0 });
    let contentLength = 0;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            set({ progress: Math.min(100, Math.round((downloaded / contentLength) * 100)) });
          }
        } else if (event.event === "Finished") {
          set({ progress: 100 });
        }
      });
      set({ status: "ready" });
    } catch (err) {
      set({ status: "error", error: String(err) });
    }
  },

  restart: async () => {
    await relaunch();
  },
}));
