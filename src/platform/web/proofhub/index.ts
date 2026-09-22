import type { ProofHubBackend } from "../../types";

// "Installing" on the web just turns the integration on: the client code is
// a separate chunk only fetched (from this site) once it's used, and nothing
// contacts ProofHub before that. Uninstalling keeps the saved credentials,
// as on desktop, where disconnecting is a separate action.
const INSTALLED_KEY = "chronos.proofhub.installed";
const DEBUG_LOG_KEY = "chronos.proofhub.debugLog";

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

const isInstalled = () => readLocal(INSTALLED_KEY) !== null;

/** Runs one plugin action. Rejects with a plain message string, like Tauri's `invoke`. */
async function run(action: string, payload: Record<string, unknown>, subdomain: string, apiKey: string) {
  if (!isInstalled()) throw "The ProofHub plugin isn't installed.";
  if (!SUBDOMAIN.test(subdomain)) throw "Invalid ProofHub subdomain: use just the part before .proofhub.com.";
  const { dispatch, ProofHubError } = await import("./api");
  const request = { ...payload, action, subdomain, apiKey: "<redacted>" };
  try {
    const data = await dispatch(action, payload, { subdomain, apiKey });
    writeLocal(DEBUG_LOG_KEY, JSON.stringify({ request, response: { ok: true, data } }, null, 2));
    return data;
  } catch (err) {
    const error =
      err instanceof ProofHubError ? { status: err.status, message: err.message } : { status: null, message: String(err) };
    writeLocal(DEBUG_LOG_KEY, JSON.stringify({ request, response: { ok: false, error } }, null, 2));
    throw error.message;
  }
}

export const webProofHub: ProofHubBackend = {
  pluginStatus: async () => ({ installed: isInstalled(), version: isInstalled() ? __APP_VERSION__ : null }),
  install: async () => writeLocal(INSTALLED_KEY, __APP_VERSION__),
  uninstall: async () => writeLocal(INSTALLED_KEY, null),

  connectionStatus: async () => {
    if (!isInstalled()) return null;
    const { loadCredentials } = await import("./credentials");
    return (await loadCredentials())?.subdomain ?? null;
  },
  testConnection: async (subdomain, apiKey) => {
    await run("test-connection", {}, subdomain, apiKey);
  },
  saveCredentials: async (subdomain, apiKey) => {
    const { saveCredentials } = await import("./credentials");
    await saveCredentials({ subdomain, apiKey });
  },
  clearCredentials: async () => {
    const { clearCredentials } = await import("./credentials");
    await clearCredentials();
  },
  call: async <T>(action: string, payload: Record<string, unknown>) => {
    const { loadCredentials } = await import("./credentials");
    const credentials = await loadCredentials();
    if (!credentials) throw "ProofHub isn't connected yet.";
    return (await run(action, payload, credentials.subdomain, credentials.apiKey)) as T;
  },
  readDebugLog: async () => readLocal(DEBUG_LOG_KEY) ?? "",
  clearDebugLog: async () => writeLocal(DEBUG_LOG_KEY, null),
};
