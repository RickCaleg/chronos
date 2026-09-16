import type { Project } from "../types";

export interface ParsedEntryText {
  taskNumber: string;
  aliasToken: string | null;
  description: string;
}

const TASK_PREFIX_RE = /^\s*(#\S+)\s*-\s*(.+)$/;
const ALIAS_RE = /^([^-]+?)\s*-\s*(.+)$/;

/**
 * Parses the "TASK - ALIAS - description" (or "TASK - description") shorthand
 * used by the copy button and by this user's historical Clockify descriptions.
 * Returns null when the text doesn't start with a "#task" token.
 */
export function parsePastedEntry(text: string): ParsedEntryText | null {
  const taskMatch = text.trim().match(TASK_PREFIX_RE);
  if (!taskMatch) return null;

  const taskNumber = taskMatch[1];
  const remainder = taskMatch[2];
  const aliasMatch = remainder.match(ALIAS_RE);

  if (aliasMatch) {
    return { taskNumber, aliasToken: aliasMatch[1].trim(), description: aliasMatch[2].trim() };
  }
  return { taskNumber, aliasToken: null, description: remainder.trim() };
}

/** Resolves a short alias token (e.g. "MRK", "[BDS]") to a known project. */
export function matchProjectByAlias(token: string, projects: Project[]): Project | null {
  const clean = token.replace(/[[\]]/g, "").trim().toLowerCase();
  if (!clean) return null;

  return (
    projects.find((p) => p.alias && p.alias.toLowerCase() === clean) ??
    projects.find((p) => p.name.toLowerCase() === clean) ??
    projects.find((p) => p.name.toLowerCase().includes(clean)) ??
    null
  );
}

export interface ResolvedEntryFields {
  taskNumber: string | null;
  description: string;
  projectId: string | null;
  /** The alias token parsed from the description, if any — callers can persist it onto the project. */
  aliasToken: string | null;
}

/**
 * Applies the same "#task - ALIAS - description" splitting used for paste
 * autofill to imported rows: only when the row didn't already provide a task
 * number, and only resolving a project from the alias when the row didn't
 * already resolve one from its own project column.
 */
export function resolveImportedEntryFields(
  rawTask: string | null,
  rawDescription: string,
  projectId: string | null,
  projects: Project[],
): ResolvedEntryFields {
  if (rawTask) return { taskNumber: rawTask, description: rawDescription, projectId, aliasToken: null };

  const parsed = parsePastedEntry(rawDescription);
  if (!parsed) return { taskNumber: null, description: rawDescription, projectId, aliasToken: null };

  let resolvedProjectId = projectId;
  if (!resolvedProjectId && parsed.aliasToken) {
    const matched = matchProjectByAlias(parsed.aliasToken, projects);
    if (matched) resolvedProjectId = matched.id;
  }

  return {
    taskNumber: parsed.taskNumber,
    description: parsed.description,
    projectId: resolvedProjectId,
    aliasToken: parsed.aliasToken,
  };
}
