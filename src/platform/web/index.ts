import type { Database, FileFilter, Platform, StartupResult } from "../types";
import type { WorkerRequest, WorkerResponse } from "./db.worker";
import { webProofHub } from "./proofhub";

let database: Database | null = null;

/**
 * The OPFS pool behind the database allows a single connection per origin, so
 * only one tab may own it. The lock is held for the page's lifetime and
 * released by the browser when the tab closes.
 */
function acquireTabLock(): Promise<boolean> {
  return new Promise((resolve) => {
    navigator.locks
      .request("chronos-db", { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        return lock ? new Promise<never>(() => {}) : undefined;
      })
      .catch(() => resolve(false));
  });
}

function startDatabase(): Promise<Database> {
  const worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  const request = (op: WorkerRequest["op"], sql: string, params?: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, sql, params } satisfies WorkerRequest);
    });

  const db: Database = {
    select: (sql, params) => request("select", sql, params) as Promise<never>,
    execute: (sql, params) => request("execute", sql, params) as Promise<never>,
  };

  return new Promise((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || "Database worker failed to start"));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "ready") resolve(db);
      else if (msg.type === "fatal") reject(new Error(msg.error));
      else {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(msg.error));
      }
    };
  });
}

function acceptAttr(filter: FileFilter): string {
  return filter.extensions.map((ext) => `.${ext}`).join(",");
}

export const platform: Platform = {
  kind: "web",

  init: async (): Promise<StartupResult> => {
    if (!window.isSecureContext || !navigator.storage?.getDirectory || !navigator.locks || typeof Worker === "undefined") {
      return { ok: false, reason: "unsupported" };
    }
    if (!(await acquireTabLock())) return { ok: false, reason: "other-tab" };
    try {
      database = await startDatabase();
    } catch (err) {
      return { ok: false, reason: "unsupported", detail: String(err) };
    }
    // Asks the browser not to evict this origin's storage under disk pressure.
    navigator.storage.persist?.().catch(() => {});
    return { ok: true };
  },

  openDatabase: async () => {
    if (!database) throw new Error("Database not initialized");
    return database;
  },

  appVersion: async () => __APP_VERSION__,
  copyText: (text) => navigator.clipboard.writeText(text),
  openUrl: async (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  saveTextFile: async (defaultName, content, filter) => {
    const type = filter.extensions.includes("json") ? "application/json" : "text/csv";
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },

  openTextFile: (filter) =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = acceptAttr(filter);
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) resolve(null);
        else file.text().then(resolve, () => resolve(null));
      };
      input.oncancel = () => resolve(null);
      input.click();
    }),

  setTimerRunning: (running) => {
    document.title = running ? "● Chronos" : "Chronos";
  },

  omarchyTheme: async () => null,
  globalShortcut: null,
  autostart: null,
  updater: null,
  backupFolder: null,
  proofhub: webProofHub,
};
