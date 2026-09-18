import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  body: string | null;
  progress: number;
  error: string | null;
  /** Which step the current `error` came from — the check itself, or the install after a check succeeded. Distinct i18n messages, since "Failed to install package" isn't a "couldn't check" failure. */
  errorPhase: "check" | "install" | null;
  update: Update | null;
  /**
   * Tauri's updater can only self-install an AppImage on Linux (it has no
   * mechanism for a .deb/.rpm/AUR-installed binary, which isn't a file the
   * app can just overwrite) — null until checked, so the UI doesn't flash
   * the (possibly wrong) button before this resolves.
   */
  selfUpdateSupported: boolean | null;
  checkSelfUpdateSupport: () => Promise<void>;
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
  errorPhase: null,
  update: null,
  selfUpdateSupported: null,

  checkSelfUpdateSupport: async () => {
    try {
      const supported = await invoke<boolean>("updater_supported");
      set({ selfUpdateSupported: supported });
    } catch {
      // Command missing/failed: assume supported rather than hiding a
      // working button on a platform we didn't anticipate.
      set({ selfUpdateSupported: true });
    }
  },

  checkForUpdates: async () => {
    set({ status: "checking", error: null, errorPhase: null });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", version: update.version, body: update.body ?? null, update });
      } else {
        set({ status: "up-to-date", update: null });
      }
    } catch (err) {
      set({ status: "error", errorPhase: "check", error: String(err) });
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
      set({ status: "error", errorPhase: "install", error: String(err) });
    }
  },

  restart: async () => {
    await relaunch();
  },
}));
