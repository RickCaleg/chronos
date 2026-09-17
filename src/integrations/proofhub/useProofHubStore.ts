import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import * as proofhubDb from "../../db/proofhubSettings";
import type { ProofHubProjectMap, ProofHubProjectMapping } from "../../db/proofhubSettings";

interface PluginStatus {
  installed: boolean;
  version: string | null;
}

interface ProofHubState {
  loaded: boolean;
  installed: boolean;
  pluginVersion: string | null;
  /** The connected ProofHub subdomain, or null if not connected. Never the API key. */
  subdomain: string | null;
  projectMap: ProofHubProjectMap;
  busy: boolean;
  error: string | null;

  load: () => Promise<void>;
  install: () => Promise<void>;
  uninstall: () => Promise<void>;
  connect: (subdomain: string, apiKey: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setMapping: (chronosProjectId: string, mapping: ProofHubProjectMapping) => Promise<void>;
  removeMapping: (chronosProjectId: string) => Promise<void>;
  call: <T = unknown>(action: string, payload?: Record<string, unknown>) => Promise<T>;
}

export const useProofHubStore = create<ProofHubState>((set, get) => ({
  loaded: false,
  installed: false,
  pluginVersion: null,
  subdomain: null,
  projectMap: {},
  busy: false,
  error: null,

  load: async () => {
    const [status, subdomain, projectMap] = await Promise.all([
      invoke<PluginStatus>("proofhub_plugin_status"),
      invoke<string | null>("proofhub_connection_status"),
      proofhubDb.getProjectMap(),
    ]);
    set({
      loaded: true,
      installed: status.installed,
      pluginVersion: status.version,
      subdomain,
      projectMap,
    });
  },

  install: async () => {
    set({ busy: true, error: null });
    try {
      await invoke("proofhub_plugin_install");
      await get().load();
    } catch (err) {
      set({ error: String(err) });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  uninstall: async () => {
    set({ busy: true, error: null });
    try {
      await invoke("proofhub_plugin_uninstall");
      await get().load();
    } finally {
      set({ busy: false });
    }
  },

  connect: async (subdomain, apiKey) => {
    set({ busy: true, error: null });
    try {
      // Verify the given credentials before saving them, so a typo'd key
      // never gets silently persisted as if it were a working connection.
      await invoke("proofhub_test_connection", { subdomain, apiKey });
      await invoke("proofhub_save_credentials", { subdomain, apiKey });
      await get().load();
    } catch (err) {
      set({ error: String(err) });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  disconnect: async () => {
    await invoke("proofhub_clear_credentials");
    await get().load();
  },

  setMapping: async (chronosProjectId, mapping) => {
    await proofhubDb.setProjectMapping(chronosProjectId, mapping);
    set({ projectMap: await proofhubDb.getProjectMap() });
  },

  removeMapping: async (chronosProjectId) => {
    await proofhubDb.removeProjectMapping(chronosProjectId);
    set({ projectMap: await proofhubDb.getProjectMap() });
  },

  call: (action, payload = {}) => invoke("proofhub_plugin_call", { action, payload }),
}));
