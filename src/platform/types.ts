export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface Statement {
  sql: string;
  params?: unknown[];
}

/** The subset of `@tauri-apps/plugin-sql`'s Database the app uses; both builds implement it. */
export interface Database {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  /** Runs the statements in order: as one transaction on the web, one by one on desktop. */
  batch(statements: Statement[]): Promise<void>;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export type StartupResult = { ok: true } | { ok: false; reason: "other-tab" | "unsupported"; detail?: string };

export interface AppUpdate {
  version: string;
  body: string | null;
  downloadAndInstall: (onProgress: (percent: number) => void) => Promise<void>;
}

export interface ProofHubPluginStatus {
  installed: boolean;
  version: string | null;
}

export interface ProofHubBackend {
  pluginStatus(): Promise<ProofHubPluginStatus>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  connectionStatus(): Promise<string | null>;
  testConnection(subdomain: string, apiKey: string): Promise<void>;
  saveCredentials(subdomain: string, apiKey: string): Promise<void>;
  clearCredentials(): Promise<void>;
  call<T>(action: string, payload: Record<string, unknown>): Promise<T>;
  readDebugLog(): Promise<string>;
  clearDebugLog(): Promise<void>;
}

/**
 * Everything the UI needs from the host (Tauri desktop app or plain browser).
 * Optional capabilities are `null` where the host can't provide them, and the
 * UI hides the matching controls.
 */
export interface Platform {
  kind: "desktop" | "web";
  init(): Promise<StartupResult>;
  openDatabase(): Promise<Database>;
  appVersion(): Promise<string>;
  copyText(text: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  /** Returns false if the user cancelled. */
  saveTextFile(defaultName: string, content: string, filter: FileFilter): Promise<boolean>;
  /** Returns null if the user cancelled. */
  openTextFile(filter: FileFilter): Promise<string | null>;
  setTimerRunning(running: boolean): void;
  omarchyTheme(): Promise<Record<string, string> | null>;

  globalShortcut: {
    register(accelerator: string): Promise<void>;
    onTriggered(callback: () => void): () => void;
  } | null;
  autostart: {
    isEnabled(): Promise<boolean>;
    enable(): Promise<void>;
    disable(): Promise<void>;
  } | null;
  updater: {
    selfUpdateSupported(): Promise<boolean>;
    check(): Promise<AppUpdate | null>;
    relaunch(): Promise<void>;
  } | null;
  backupFolder: {
    choose(): Promise<string | null>;
    ensure(folder: string): Promise<void>;
    writeFile(folder: string, name: string, content: string): Promise<void>;
    listFiles(folder: string): Promise<string[]>;
    removeFile(folder: string, name: string): Promise<void>;
  } | null;
  proofhub: ProofHubBackend | null;
}
