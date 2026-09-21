import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
import { confirm } from "../ui/ConfirmDialog";
import { useProjectsStore } from "../../store/useProjectsStore";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { ColorPicker } from "./ColorPicker";
import type { Project } from "../../types";

function ProjectRow({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { rename, setArchived, setColor, setAlias, remove } = useProjectsStore();
  const [name, setName] = useState(project.name);
  const [alias, setAliasText] = useState(project.alias ?? "");

  async function handleDelete() {
    if (await confirm(t("projects.deleteConfirm"), { danger: true, confirmLabel: t("editor.delete") })) remove(project.id);
  }

  return (
    <div className="flex items-center gap-3 rounded-[2px] px-3 py-2 hover:bg-[var(--color-surface-hover)]">
      <ColorPicker color={project.color} onChange={(c) => setColor(project.id, c)} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== project.name && rename(project.id, name.trim())}
        className="min-w-0 flex-1 rounded-[2px] bg-transparent text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
      />
      <input
        value={alias}
        onChange={(e) => setAliasText(e.target.value)}
        onBlur={() => {
          const trimmed = alias.trim() || null;
          if (trimmed !== project.alias) setAlias(project.id, trimmed);
        }}
        placeholder={t("projects.aliasPlaceholder")}
        title={t("projects.aliasHint")}
        className="w-20 shrink-0 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text-muted)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
      />
      <Button variant="ghost" size="icon" onClick={() => setArchived(project.id, !project.archived)} title={project.archived ? t("projects.unarchive") : t("projects.archive")}>
        {project.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
      </Button>
      <Button variant="ghost" size="icon" onClick={handleDelete} title={t("projects.delete")}>
        <Trash2 size={15} className="text-[var(--color-danger)]" />
      </Button>
    </div>
  );
}

export function ProjectsView() {
  const { t } = useTranslation();
  const { projects, create } = useProjectsStore();
  const [newName, setNewName] = useState("");

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    await create(name);
    setNewName("");
  }

  return (
    <div className="mx-auto h-full max-w-xl overflow-y-auto py-2">
      <h1 className="mb-4 text-lg font-semibold">{t("projects.title")}</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder={t("projects.namePlaceholder")}
          className="min-w-[160px] flex-1"
        />
        <Button variant="primary" onClick={handleCreate}>
          <Plus size={16} />
          {t("projects.newProject")}
        </Button>
      </div>

      {projects.length === 0 && (
        <p className="px-3 text-sm text-[var(--color-text-muted)]">{t("projects.empty")}</p>
      )}

      <div className="rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {active.map((p, i) => (
          <div key={p.id} className={i > 0 ? "border-t border-[var(--color-border)]" : ""}>
            <ProjectRow project={p} />
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t("projects.archived")}
          </h2>
          <div className="rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] opacity-70">
            {archived.map((p, i) => (
              <div key={p.id} className={i > 0 ? "border-t border-[var(--color-border)]" : ""}>
                <ProjectRow project={p} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
