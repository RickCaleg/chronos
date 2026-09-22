import { create } from "zustand";
import { platform } from "@platform";
import type { AppUpdate } from "../platform/types";

export type UpdaterStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  body: string | null;
  progress: number;
  error: string | null;
  /** Which step the current `error` came from — the check itself, or the install after a check succeeded. Distinct i18n messages, since "Failed to install package" isn't a "couldn't check" failure. */
  errorPhase: "check" | "install" | null;
  update: AppUpdate | null;
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
    if (!platform.updater) return;
    set({ selfUpdateSupported: await platform.updater.selfUpdateSupported() });
  },

  checkForUpdates: async () => {
    // The web build is updated by redeploying; a reload picks up the new version.
    if (!platform.updater) return;
    set({ status: "checking", error: null, errorPhase: null });
    try {
      const update = await platform.updater.check();
      if (update) {
        set({ status: "available", version: update.version, body: update.body, update });
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
    try {
      await update.downloadAndInstall((progress) => set({ progress }));
      set({ status: "ready" });
    } catch (err) {
      set({ status: "error", errorPhase: "install", error: String(err) });
    }
  },

  restart: async () => {
    await platform.updater?.relaunch();
  },
}));
