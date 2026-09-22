// The web counterpart of src-tauri/src/proofhub_credentials.rs: the subdomain
// and API key are kept AES-GCM encrypted in IndexedDB, under a key generated
// in the browser as non-extractable, so the raw key never exists as bytes a
// script or a storage dump could copy. Kept out of the SQLite database, so
// never part of a JSON backup.

const DB_NAME = "chronos-secrets";
const STORE = "kv";
const KEY_ID = "proofhub-key";
const CREDENTIALS_ID = "proofhub-credentials";

export interface Credentials {
  subdomain: string;
  apiKey: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = op(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function encryptionKey(): Promise<CryptoKey> {
  const existing = await run<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await run("readwrite", (s) => s.put(key, KEY_ID));
  return key;
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(credentials)),
  );
  await run("readwrite", (s) => s.put({ iv, data }, CREDENTIALS_ID));
}

export async function loadCredentials(): Promise<Credentials | null> {
  const stored = await run<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer } | undefined>("readonly", (s) =>
    s.get(CREDENTIALS_ID),
  );
  if (!stored) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: stored.iv }, await encryptionKey(), stored.data);
    return JSON.parse(new TextDecoder().decode(plain)) as Credentials;
  } catch {
    throw "the stored ProofHub credentials are corrupt";
  }
}

export async function clearCredentials(): Promise<void> {
  await run("readwrite", (s) => s.delete(CREDENTIALS_ID));
}
