import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import * as proofhubDb from "../../db/proofhubSettings";
import type { ProofHubProjectMap, ProofHubProjectMapping } from "../../db/proofhubSettings";
import type { RemoteEntryState } from "./plan";

export interface RemoteItem {
  id: string;
  title: string;
}

/** Where a `#ticket` lives in ProofHub — what a task-linked time entry needs. */
export interface RemoteTask {
  id: string;
  listId: string;
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
   * Cached results of `list-projects`/`list-timesheets` and resolved
   * tickets — each lookup spawns the plugin binary and makes real ProofHub
   * API calls, so refetching every time was slow. Cleared only on
   * disconnect/uninstall or an explicit refresh. Tickets are cached only
   * once found, so a task created in ProofHub later is still picked up.
   */
  remoteProjects: RemoteItem[] | null;
  timesheetsByProject: Record<string, RemoteItem[]>;
  tasksByTicket: Record<string, RemoteTask>;

  /** Per Chronos entry id: currently being sent, and the last send's error (cleared on success). */
  sending: Record<string, boolean>;
  sendErrors: Record<string, string>;

  /**
   * What checks against ProofHub last saw, by `refKey` (see plan.ts) — in
   * memory only, so an entry deleted in ProofHub shows up after the next
   * check, never from stale data of a previous session.
   */
  remoteEntries: Record<string, RemoteEntryState>;

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
  findTask: (proofhubProjectId: string, ticket: string) => Promise<RemoteTask | null>;
  setSendState: (entryIds: string[], sending: boolean, error?: string | null) => void;
  setRemoteEntries: (states: Record<string, RemoteEntryState>) => void;
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
  tasksByTicket: {},
  sending: {},
  sendErrors: {},
  remoteEntries: {},

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
      set({ remoteProjects: null, timesheetsByProject: {}, tasksByTicket: {}, remoteEntries: {} });
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
    set({ remoteProjects: null, timesheetsByProject: {}, tasksByTicket: {}, remoteEntries: {} });
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

  findTask: async (proofhubProjectId, ticket) => {
    const key = `${proofhubProjectId}#${ticket}`;
    const cached = get().tasksByTicket[key];
    if (cached) return cached;
    const task = await get().call<RemoteTask | null>("find-task", { projectId: proofhubProjectId, ticket });
    if (task) set((state) => ({ tasksByTicket: { ...state.tasksByTicket, [key]: task } }));
    return task;
  },

  setSendState: (entryIds, sending, error) => {
    set((state) => {
      const nextSending = { ...state.sending };
      const nextErrors = { ...state.sendErrors };
      for (const id of entryIds) {
        if (sending) nextSending[id] = true;
        else delete nextSending[id];
        if (error) nextErrors[id] = error;
        else if (error === null) delete nextErrors[id];
      }
      return { sending: nextSending, sendErrors: nextErrors };
    });
  },

  setRemoteEntries: (states) => set((state) => ({ remoteEntries: { ...state.remoteEntries, ...states } })),
}));
