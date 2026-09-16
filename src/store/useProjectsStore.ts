import { create } from "zustand";
import type { Project } from "../types";
import * as projectsDb from "../db/projects";

export const PALETTE = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#0ea5e9",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
];

export function pickColor(existingCount: number): string {
  return PALETTE[existingCount % PALETTE.length];
}

interface ProjectsState {
  projects: Project[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string) => Promise<Project>;
  rename: (id: string, name: string) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  setColor: (id: string, color: string) => Promise<void>;
  setAlias: (id: string, alias: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loaded: false,
  load: async () => {
    const projects = await projectsDb.listProjects();
    set({ projects, loaded: true });
  },
  create: async (name: string) => {
    const color = pickColor(get().projects.length);
    const project = await projectsDb.createProject(name, color);
    set({ projects: [...get().projects, project] });
    return project;
  },
  rename: async (id, name) => {
    await projectsDb.renameProject(id, name);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)) });
  },
  setArchived: async (id, archived) => {
    await projectsDb.setProjectArchived(id, archived);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, archived } : p)) });
  },
  setColor: async (id, color) => {
    await projectsDb.setProjectColor(id, color);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, color } : p)) });
  },
  setAlias: async (id, alias) => {
    await projectsDb.setProjectAlias(id, alias);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, alias } : p)) });
  },
  remove: async (id) => {
    await projectsDb.deleteProject(id);
    set({ projects: get().projects.filter((p) => p.id !== id) });
  },
}));
