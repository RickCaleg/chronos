import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import type { Backup, Project, TimeEntry } from "../types";
import * as projectsDb from "../db/projects";
import * as entriesDb from "../db/entries";
import * as tagsDb from "../db/tags";
import { parseCsv, toCsvRow } from "./csv";
import { combineLocalDateTime, durationBetween, formatLocalDate, formatLocalTimeLong, nowIso } from "./time";
import { pickColor } from "../store/useProjectsStore";
import { resolveImportedEntryFields } from "./pasteParser";

export async function exportJsonBackup(): Promise<boolean> {
  const [projects, timeEntries, tags] = await Promise.all([
    projectsDb.listProjects(),
    entriesDb.listEntries(),
    tagsDb.listTags(),
  ]);
  const backup: Backup = { version: 1, exportedAt: nowIso(), projects, timeEntries, tags };

  const path = await save({
    defaultPath: `chronos-backup-${formatLocalDate(nowIso())}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return false;

  await writeTextFile(path, JSON.stringify(backup, null, 2));
  return true;
}

export async function resetAllData(): Promise<void> {
  await tagsDb.replaceAllEntryTags([]);
  await tagsDb.replaceAllTags([]);
  await entriesDb.replaceAllEntries([]);
  await projectsDb.replaceAllProjects([]);
}

export async function importJsonBackup(): Promise<boolean> {
  const path = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return false;

  const content = await readTextFile(path);
  const backup = JSON.parse(content) as Backup;

  if (!backup || backup.version !== 1 || !Array.isArray(backup.projects) || !Array.isArray(backup.timeEntries)) {
    throw new Error("Invalid backup file");
  }

  await projectsDb.replaceAllProjects(backup.projects);
  await entriesDb.replaceAllEntries(backup.timeEntries);
  // Older automatic backups have no `tags` list, but each entry
  // carries its full tags, so the list can be rebuilt from those.
  const tags =
    backup.tags ?? Array.from(new Map(backup.timeEntries.flatMap((e) => e.tags ?? []).map((tag) => [tag.id, tag])).values());
  await tagsDb.replaceAllTags(tags);
  await tagsDb.replaceAllEntryTags(backup.timeEntries.map((e) => ({ id: e.id, tags: e.tags ?? [] })));
  return true;
}

// "Note" goes last so the older columns keep their positions; the importers read by header name anyway.
const CSV_HEADER = ["Project", "Task", "Description", "Start Date", "Start Time", "End Date", "End Time", "Duration", "Note"];

export async function exportEntriesCsv(): Promise<boolean> {
  const [projects, entries] = await Promise.all([projectsDb.listProjects(), entriesDb.listEntries()]);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const lines = [toCsvRow(CSV_HEADER)];
  for (const e of entries.filter((e) => !e.isRunning)) {
    const project = e.projectId ? projectById.get(e.projectId) : null;
    lines.push(
      toCsvRow([
        project?.name ?? "",
        e.taskNumber ?? "",
        e.description,
        formatLocalDate(e.startTime),
        formatLocalTimeLong(e.startTime),
        formatLocalDate(e.endTime!),
        formatLocalTimeLong(e.endTime!),
        String(e.durationSeconds ?? 0),
        e.note ?? "",
      ]),
    );
  }

  const path = await save({
    defaultPath: `chronos-entries-${formatLocalDate(nowIso())}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;

  await writeTextFile(path, lines.join("\n"));
  return true;
}

export async function importEntriesCsv(): Promise<{ imported: number }> {
  const path = await open({
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path || Array.isArray(path)) return { imported: 0 };

  const content = await readTextFile(path);
  const rows = parseCsv(content);
  if (rows.length === 0) return { imported: 0 };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const col = {
    project: idx("project"),
    description: idx("description"),
    task: idx("task"),
    startDate: idx("start date"),
    startTime: idx("start time"),
    endDate: idx("end date"),
    endTime: idx("end time"),
    duration: idx("duration"),
    note: idx("note"),
  };

  const existingProjects = await projectsDb.listProjects();
  const projectByName = new Map(existingProjects.map((p) => [p.name.toLowerCase(), p]));
  const projectById = new Map(existingProjects.map((p) => [p.id, p]));
  let colorCount = existingProjects.length;

  let imported = 0;
  const newEntries: TimeEntry[] = [];

  for (const row of rows.slice(1)) {
    const projectName = col.project >= 0 ? row[col.project]?.trim() : "";
    let project: Project | undefined;
    if (projectName) {
      project = projectByName.get(projectName.toLowerCase());
      if (!project) {
        project = await projectsDb.createProject(projectName, pickColor(colorCount++));
        projectByName.set(projectName.toLowerCase(), project);
        projectById.set(project.id, project);
        existingProjects.push(project);
      }
    }

    const startDate = col.startDate >= 0 ? row[col.startDate]?.trim() : "";
    const startTime = col.startTime >= 0 ? row[col.startTime]?.trim() : "";
    const endDate = col.endDate >= 0 ? row[col.endDate]?.trim() : startDate;
    const endTime = col.endTime >= 0 ? row[col.endTime]?.trim() : "";
    if (!startDate || !startTime || !endTime) continue;

    const start = combineLocalDateTime(startDate, startTime);
    const end = combineLocalDateTime(endDate || startDate, endTime);
    if (new Date(end).getTime() <= new Date(start).getTime()) continue;

    const rawTask = col.task >= 0 ? row[col.task]?.trim() || null : null;
    const rawDescription = col.description >= 0 ? row[col.description] ?? "" : "";
    const resolved = resolveImportedEntryFields(rawTask, rawDescription, project?.id ?? null, existingProjects);

    if (resolved.projectId && resolved.aliasToken) {
      const resolvedProject = projectById.get(resolved.projectId);
      if (resolvedProject && !resolvedProject.alias) {
        await projectsDb.setProjectAlias(resolvedProject.id, resolved.aliasToken);
        resolvedProject.alias = resolved.aliasToken;
      }
    }

    const now = nowIso();
    newEntries.push({
      id: crypto.randomUUID(),
      description: resolved.description,
      taskNumber: resolved.taskNumber,
      projectId: resolved.projectId,
      startTime: start,
      endTime: end,
      durationSeconds: durationBetween(start, end),
      isRunning: false,
      createdAt: now,
      updatedAt: now,
      tags: [],
      proofhubTimeEntryId: null,
      proofhubSyncedAt: null,
      note: (col.note >= 0 ? row[col.note]?.trim() : "") || null,
    });
    imported++;
  }

  const current = await entriesDb.listEntries();
  await entriesDb.replaceAllEntries([...current, ...newEntries]);

  return { imported };
}

function parseClockifyDate(dateStr: string, timeStr: string): string | null {
  const dm = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const tm = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dm || !tm) return null;

  const [, d, mo, y] = dm;
  const [, h, mi, s] = tm;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Imports a Clockify CSV export (pt-BR column names: Projeto, Descrição, Tarefa, Data/Hora de início/término). */
export async function importClockifyCsv(): Promise<{ imported: number }> {
  const path = await open({
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path || Array.isArray(path)) return { imported: 0 };

  const content = await readTextFile(path);
  const rows = parseCsv(content);
  if (rows.length === 0) return { imported: 0 };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const col = {
    project: idx("projeto"),
    description: idx("descrição"),
    task: idx("tarefa"),
    startDate: idx("data de início"),
    startTime: idx("hora de início"),
    endDate: idx("data de término"),
    endTime: idx("hora de término"),
  };

  const existingProjects = await projectsDb.listProjects();
  const projectByName = new Map(existingProjects.map((p) => [p.name.toLowerCase(), p]));
  const projectById = new Map(existingProjects.map((p) => [p.id, p]));
  let colorCount = existingProjects.length;

  let imported = 0;
  const newEntries: TimeEntry[] = [];

  for (const row of rows.slice(1)) {
    const startDate = col.startDate >= 0 ? row[col.startDate]?.trim() : "";
    const startTime = col.startTime >= 0 ? row[col.startTime]?.trim() : "";
    const endDate = col.endDate >= 0 ? row[col.endDate]?.trim() : startDate;
    const endTime = col.endTime >= 0 ? row[col.endTime]?.trim() : "";
    if (!startDate || !startTime || !endTime) continue;

    const start = parseClockifyDate(startDate, startTime);
    const end = parseClockifyDate(endDate || startDate, endTime);
    if (!start || !end || new Date(end).getTime() <= new Date(start).getTime()) continue;

    const projectName = col.project >= 0 ? row[col.project]?.trim() : "";
    let project: Project | undefined;
    if (projectName) {
      project = projectByName.get(projectName.toLowerCase());
      if (!project) {
        project = await projectsDb.createProject(projectName, pickColor(colorCount++));
        projectByName.set(projectName.toLowerCase(), project);
        projectById.set(project.id, project);
        existingProjects.push(project);
      }
    }

    const rawTask = col.task >= 0 ? row[col.task]?.trim() || null : null;
    const rawDescription = col.description >= 0 ? row[col.description] ?? "" : "";
    const resolved = resolveImportedEntryFields(rawTask, rawDescription, project?.id ?? null, existingProjects);

    if (resolved.projectId && resolved.aliasToken) {
      const resolvedProject = projectById.get(resolved.projectId);
      if (resolvedProject && !resolvedProject.alias) {
        await projectsDb.setProjectAlias(resolvedProject.id, resolved.aliasToken);
        resolvedProject.alias = resolved.aliasToken;
      }
    }

    const now = nowIso();
    newEntries.push({
      id: crypto.randomUUID(),
      description: resolved.description,
      taskNumber: resolved.taskNumber,
      projectId: resolved.projectId,
      startTime: start,
      endTime: end,
      durationSeconds: durationBetween(start, end),
      isRunning: false,
      createdAt: now,
      updatedAt: now,
      tags: [],
      proofhubTimeEntryId: null,
      proofhubSyncedAt: null,
      note: null,
    });
    imported++;
  }

  const current = await entriesDb.listEntries();
  await entriesDb.replaceAllEntries([...current, ...newEntries]);

  return { imported };
}
