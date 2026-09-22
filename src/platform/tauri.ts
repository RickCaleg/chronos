import SqlDatabase from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { join } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Platform, ProofHubPluginStatus } from "./types";

export const platform: Platform = {
  kind: "desktop",
  init: async () => ({ ok: true }),
  openDatabase: () => SqlDatabase.load("sqlite:chronos.db"),
  appVersion: getVersion,
  copyText: writeText,
  openUrl: (url) => openUrl(url),

  saveTextFile: async (defaultName, content, filter) => {
    const path = await save({ defaultPath: defaultName, filters: [filter] });
    if (!path) return false;
    await writeTextFile(path, content);
    return true;
  },

  openTextFile: async (filter) => {
    const path = await open({ multiple: false, filters: [filter] });
    if (!path || Array.isArray(path)) return null;
    return readTextFile(path);
  },

  setTimerRunning: (running) => {
    // Best-effort: no tray on a bare window manager without a status area.
    invoke("set_tray_timer_label", { running }).catch(() => {});
  },

  omarchyTheme: async () => {
    try {
      return await invoke<Record<string, string> | null>("get_omarchy_theme");
    } catch {
      return null;
    }
  },

  globalShortcut: {
    register: (accelerator) => invoke("register_global_shortcut", { accelerator }),
    onTriggered: (callback) => {
      const unlisten = listen("toggle-timer-shortcut", callback);
      return () => {
        unlisten.then((fn) => fn());
      };
    },
  },

  autostart: { isEnabled, enable, disable },

  updater: {
    selfUpdateSupported: async () => {
      try {
        return await invoke<boolean>("updater_supported");
      } catch {
        // Command missing/failed: assume supported rather than hiding a
        // working button on a platform we didn't anticipate.
        return true;
      }
    },
    check: async () => {
      const update = await check();
      if (!update) return null;
      return {
        version: update.version,
        body: update.body ?? null,
        downloadAndInstall: async (onProgress) => {
          let contentLength = 0;
          let downloaded = 0;
          await update.downloadAndInstall((event) => {
            if (event.event === "Started") {
              contentLength = event.data.contentLength ?? 0;
            } else if (event.event === "Progress") {
              downloaded += event.data.chunkLength;
              if (contentLength > 0) onProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
            } else if (event.event === "Finished") {
              onProgress(100);
            }
          });
        },
      };
    },
    relaunch,
  },

  backupFolder: {
    choose: async () => {
      const path = await open({ directory: true, multiple: false });
      return !path || Array.isArray(path) ? null : path;
    },
    ensure: async (folder) => {
      if (!(await exists(folder))) await mkdir(folder, { recursive: true });
    },
    writeFile: async (folder, name, content) => writeTextFile(await join(folder, name), content),
    listFiles: async (folder) => (await readDir(folder)).filter((e) => e.isFile).map((e) => e.name),
    removeFile: async (folder, name) => remove(await join(folder, name)),
  },

  proofhub: {
    pluginStatus: () => invoke<ProofHubPluginStatus>("proofhub_plugin_status"),
    install: () => invoke("proofhub_plugin_install"),
    uninstall: () => invoke("proofhub_plugin_uninstall"),
    connectionStatus: () => invoke<string | null>("proofhub_connection_status"),
    testConnection: (subdomain, apiKey) => invoke("proofhub_test_connection", { subdomain, apiKey }),
    saveCredentials: (subdomain, apiKey) => invoke("proofhub_save_credentials", { subdomain, apiKey }),
    clearCredentials: () => invoke("proofhub_clear_credentials"),
    call: (action, payload) => invoke("proofhub_plugin_call", { action, payload }),
    readDebugLog: () => invoke<string>("proofhub_read_debug_log"),
    clearDebugLog: () => invoke("proofhub_clear_debug_log"),
  },
};
