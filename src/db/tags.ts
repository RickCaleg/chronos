import { getDb } from "./client";
import type { Tag } from "../types";

interface TagRow {
  id: string;
  name: string;
  created_at: string;
}

function fromRow(row: TagRow): Tag {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  const rows = await db.select<TagRow[]>("SELECT * FROM tags ORDER BY name COLLATE NOCASE");
  return rows.map(fromRow);
}

/** Returns the existing tag with this name (case-insensitive) if one exists, otherwise creates it. */
export async function findOrCreateTag(name: string): Promise<Tag> {
  const db = await getDb();
  const trimmed = name.trim();
  const existing = await db.select<TagRow[]>("SELECT * FROM tags WHERE name = $1 COLLATE NOCASE", [trimmed]);
  if (existing.length) return fromRow(existing[0]);

  const tag: Tag = { id: crypto.randomUUID(), name: trimmed, createdAt: new Date().toISOString() };
  await db.execute("INSERT INTO tags (id, name, created_at) VALUES ($1, $2, $3)", [tag.id, tag.name, tag.createdAt]);
  return tag;
}

export async function deleteTag(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tags WHERE id = $1", [id]);
}

/** Replaces the full set of tags attached to an entry. */
export async function setEntryTags(entryId: string, tagIds: string[]): Promise<void> {
  const db = await getDb();
  await db.batch([
    { sql: "DELETE FROM entry_tags WHERE entry_id = $1", params: [entryId] },
    ...tagIds.map((tagId) => ({
      sql: "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ($1, $2)",
      params: [entryId, tagId],
    })),
  ]);
}

/** All entry->tags associations in one query, for attaching to a freshly-loaded entry list. */
export async function listEntryTags(): Promise<Map<string, Tag[]>> {
  const db = await getDb();
  const rows = await db.select<(TagRow & { entry_id: string })[]>(
    `SELECT et.entry_id as entry_id, t.id as id, t.name as name, t.created_at as created_at
     FROM entry_tags et JOIN tags t ON t.id = et.tag_id`,
  );
  const map = new Map<string, Tag[]>();
  for (const row of rows) {
    const list = map.get(row.entry_id) ?? [];
    list.push(fromRow(row));
    map.set(row.entry_id, list);
  }
  return map;
}

export async function replaceAllTags(tags: Tag[]): Promise<void> {
  const db = await getDb();
  await db.batch([
    { sql: "DELETE FROM tags" },
    ...tags.map((tag) => ({
      sql: "INSERT INTO tags (id, name, created_at) VALUES ($1, $2, $3)",
      params: [tag.id, tag.name, tag.createdAt],
    })),
  ]);
}

export async function replaceAllEntryTags(entries: { id: string; tags: Tag[] }[]): Promise<void> {
  const db = await getDb();
  await db.batch([
    { sql: "DELETE FROM entry_tags" },
    ...entries.flatMap((entry) =>
      entry.tags.map((tag) => ({
        sql: "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ($1, $2)",
        params: [entry.id, tag.id],
      })),
    ),
  ]);
}
