import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import * as proofhubDb from "../../db/proofhubSettings";
import type { ProofHubProjectMap, ProofHubProjectMapping } from "../../db/proofhubSettings";

export interface RemoteItem {
  id: string;
  title: string;
}

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
  /** "Send day to ProofHub" sums same-task/description/project entries into one push instead of one per Chronos entry — see db/proofhubSettings.ts. */
  groupPushesByDay: boolean;
  busy: boolean;
  error: string | null;

  /**
   * Cached results of `list-projects`/`list-timesheets`/`list-todolists` —
   * each one spawns the plugin binary and makes a real ProofHub API call,
   * so refetching on every mount of the settings/mapping UI was both slow
   * and (on Windows) visibly flashed a console window per spawn. Cleared
   * only on disconnect/uninstall or an explicit refresh.
   */
  remoteProjects: RemoteItem[] | null;
  timesheetsByProject: Record<string, RemoteItem[]>;
  todolistsByProject: Record<string, RemoteItem[]>;

  load: () => Promise<void>;
  install: () => Promise<void>;
  uninstall: () => Promise<void>;
  connect: (subdomain: string, apiKey: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setMapping: (chronosProjectId: string, mapping: ProofHubProjectMapping) => Promise<void>;
  removeMapping: (chronosProjectId: string) => Promise<void>;
  setGroupPushesByDay: (value: boolean) => Promise<void>;
  call: <T = unknown>(action: string, payload?: Record<string, unknown>) => Promise<T>;

  loadRemoteProjects: (force?: boolean) => Promise<RemoteItem[]>;
  loadTimesheets: (proofhubProjectId: string, force?: boolean) => Promise<RemoteItem[]>;
  loadTodolists: (proofhubProjectId: string, force?: boolean) => Promise<RemoteItem[]>;
}

export const useProofHubStore = create<ProofHubState>((set, get) => ({
  loaded: false,
  installed: false,
  pluginVersion: null,
  subdomain: null,
  projectMap: {},
  groupPushesByDay: false,
  busy: false,
  error: null,
  remoteProjects: null,
  timesheetsByProject: {},
  todolistsByProject: {},

  load: async () => {
    const [status, subdomain, projectMap, groupPushesByDay] = await Promise.all([
      invoke<PluginStatus>("proofhub_plugin_status"),
      invoke<string | null>("proofhub_connection_status"),
      proofhubDb.getProjectMap(),
      proofhubDb.getGroupPushesByDay(),
    ]);
    set({
      loaded: true,
      installed: status.installed,
      pluginVersion: status.version,
      subdomain,
      projectMap,
      groupPushesByDay,
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
      set({ remoteProjects: null, timesheetsByProject: {}, todolistsByProject: {} });
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
    set({ remoteProjects: null, timesheetsByProject: {}, todolistsByProject: {} });
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

  setGroupPushesByDay: async (value) => {
    await proofhubDb.setGroupPushesByDay(value);
    set({ groupPushesByDay: value });
  },

  call: (action, payload = {}) => invoke("proofhub_plugin_call", { action, payload }),

  loadRemoteProjects: async (force = false) => {
    const cached = get().remoteProjects;
    if (cached && !force) return cached;
    const projects = await get().call<RemoteItem[]>("list-projects");
    set({ remoteProjects: projects });
    return projects;
  },

  loadTimesheets: async (proofhubProjectId, force = false) => {
    const cached = get().timesheetsByProject[proofhubProjectId];
    if (cached && !force) return cached;
    const timesheets = await get().call<RemoteItem[]>("list-timesheets", { projectId: proofhubProjectId });
    set((state) => ({ timesheetsByProject: { ...state.timesheetsByProject, [proofhubProjectId]: timesheets } }));
    return timesheets;
  },

  loadTodolists: async (proofhubProjectId, force = false) => {
    const cached = get().todolistsByProject[proofhubProjectId];
    if (cached && !force) return cached;
    const todolists = await get().call<RemoteItem[]>("list-todolists", { projectId: proofhubProjectId });
    set((state) => ({ todolistsByProject: { ...state.todolistsByProject, [proofhubProjectId]: todolists } }));
    return todolists;
  },
}));
