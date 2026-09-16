import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus } from "lucide-react";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Input } from "../ui/Input";
import { useProjectsStore } from "../../store/useProjectsStore";
import { cn } from "../../lib/cn";
import { projectLabel } from "../../lib/projectLabel";

interface ProjectPickerProps {
  value: string | null;
  onChange: (projectId: string | null) => void;
}

export function ProjectPicker({ value, onChange }: ProjectPickerProps) {
  const { t } = useTranslation();
  const { projects, create } = useProjectsStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = projects.find((p) => p.id === value) ?? null;

  const filtered = useMemo(() => {
    const active = projects.filter((p) => !p.archived);
    if (!query.trim()) return active;
    const q = query.toLowerCase();
    return active.filter((p) => p.name.toLowerCase().includes(q) || p.alias?.toLowerCase().includes(q));
  }, [projects, query]);

  const canCreate = query.trim().length > 0 && !filtered.some((p) => p.name.toLowerCase() === query.trim().toLowerCase());

  function close() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function select(id: string | null) {
    onChange(id);
    close();
  }

  async function handleCreate() {
    const project = await create(query.trim());
    onChange(project.id);
    close();
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (filtered.length > 0) select(filtered[0].id);
    else if (canCreate) handleCreate();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 max-w-[220px] items-center gap-2 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)] outline-none hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
      >
        {selected ? (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ backgroundColor: selected.color }} />
            <span className="truncate">{projectLabel(selected)}</span>
          </>
        ) : (
          <span className="text-[var(--color-text-muted)]">{t("timer.selectProject")}</span>
        )}
        <ChevronDown size={14} className="shrink-0 text-[var(--color-text-muted)]" />
      </button>

      <FloatingPanel open={open} onClose={close} className="w-64 p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t("timer.selectProject")}
          className="mb-2"
        />
        <div className="max-h-52 overflow-y-auto">
          {value && (
            <button
              type="button"
              onClick={() => select(null)}
              className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-sm text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
            >
              {t("records.noProject")}
            </button>
          )}
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-sm outline-none hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]",
                p.id === value && "bg-[var(--color-surface-hover)]",
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ backgroundColor: p.color }} />
              <span className="truncate">{projectLabel(p)}</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onClick={handleCreate}
              className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-sm text-[var(--color-accent)] outline-none hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
            >
              <Plus size={14} />
              {t("projects.newProject")}: "{query.trim()}"
            </button>
          )}
        </div>
      </FloatingPanel>
    </div>
  );
}
