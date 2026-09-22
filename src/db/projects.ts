import { getDb } from "./client";
import type { Project } from "../types";
import { nowIso } from "../lib/time";

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  alias: string | null;
  archived: number;
  created_at: string;
}

function fromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    alias: row.alias,
    archived: row.archived === 1,
    createdAt: row.created_at,
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>("SELECT * FROM projects ORDER BY archived ASC, name COLLATE NOCASE ASC");
  return rows.map(fromRow);
}

export async function createProject(name: string, color: string): Promise<Project> {
  const db = await getDb();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    color,
    alias: null,
    archived: false,
    createdAt: nowIso(),
  };
  await db.execute(
    "INSERT INTO projects (id, name, color, alias, archived, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [project.id, project.name, project.color, project.alias, 0, project.createdAt],
  );
  return project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE projects SET name = $1 WHERE id = $2", [name, id]);
}

export async function setProjectArchived(id: string, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE projects SET archived = $1 WHERE id = $2", [archived ? 1 : 0, id]);
}

export async function setProjectColor(id: string, color: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE projects SET color = $1 WHERE id = $2", [color, id]);
}

export async function setProjectAlias(id: string, alias: string | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE projects SET alias = $1 WHERE id = $2", [alias, id]);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE time_entries SET project_id = NULL WHERE project_id = $1", [id]);
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

export async function replaceAllProjects(projects: Project[]): Promise<void> {
  const db = await getDb();
  await db.batch([
    { sql: "DELETE FROM projects" },
    ...projects.map((p) => ({
      sql: "INSERT INTO projects (id, name, color, alias, archived, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      params: [p.id, p.name, p.color, p.alias, p.archived ? 1 : 0, p.createdAt],
    })),
  ]);
}
