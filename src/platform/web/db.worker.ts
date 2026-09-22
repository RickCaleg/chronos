import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { MIGRATIONS } from "./migrations";

export type WorkerRequest = { id: number; op: "select" | "execute"; sql: string; params?: unknown[] };
export type WorkerResponse =
  | { type: "ready" }
  | { type: "fatal"; error: string }
  | { type: "result"; id: number; ok: true; value: unknown }
  | { type: "result"; id: number; ok: false; error: string };

type SqlValue = string | number | null | bigint | Uint8Array;

// The project's lib is DOM, not WebWorker; a worker's `self` has Worker's postMessage signature.
const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message);

function normalize(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * The app's queries use `$1`, `$2`, ... placeholders. SQLite treats those as
 * *named* parameters numbered by first appearance, so binding an array by
 * position would misplace values in a query that uses `$2` before `$1`.
 * Binding by name keeps `$N` meaning "the N-th value", as with the desktop build.
 */
function toBind(sql: string, params?: unknown[]): SqlValue[] | Record<string, SqlValue> | undefined {
  if (!params || params.length === 0) return undefined;
  const names = new Set(sql.match(/\$\d+/g) ?? []);
  if (names.size === 0) return params.map(normalize);
  const bind: Record<string, SqlValue> = {};
  for (const name of names) bind[name] = normalize(params[Number(name.slice(1)) - 1]);
  return bind;
}

async function open() {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "chronos" });
  const db = new pool.OpfsSAHPoolDb("/chronos.db");

  // Same as the desktop build (sqlx turns foreign keys on per connection).
  db.exec("PRAGMA foreign_keys = ON");

  const current = Number(db.selectValue("PRAGMA user_version") ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return { sqlite3, db };
}

const ready = open();

ready.then(
  () => post({ type: "ready" }),
  (err) => post({ type: "fatal", error: String(err) }),
);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, op, sql, params } = event.data;
  try {
    const { sqlite3, db } = await ready;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bind = toBind(sql, params) as any;
    let value: unknown;
    if (op === "select") {
      value = db.selectObjects(sql, bind);
    } else {
      db.exec({ sql, bind });
      value = {
        rowsAffected: db.changes(),
        lastInsertId: Number(sqlite3.capi.sqlite3_last_insert_rowid(db)),
      };
    }
    post({ type: "result", id, ok: true, value });
  } catch (err) {
    post({ type: "result", id, ok: false, error: String(err) });
  }
};
