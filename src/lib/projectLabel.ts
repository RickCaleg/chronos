import type { Project } from "../types";

export function projectLabel(project: Project): string {
  return project.alias ? `${project.alias} - ${project.name}` : project.name;
}
