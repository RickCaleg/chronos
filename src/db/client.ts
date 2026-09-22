import { platform } from "@platform";
import type { Database } from "../platform/types";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = platform.openDatabase();
  }
  return dbPromise;
}
