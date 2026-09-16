import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Copy, Play } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { TimeEntry } from "../../types";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { EntryRow } from "./EntryRow";
import { formatDurationHuman, nowIso } from "../../lib/time";
import { projectLabel } from "../../lib/projectLabel";
import { cn } from "../../lib/cn";

const iconButtonClass =
  "shrink-0 rounded-[2px] p-1.5 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]";

export function GroupedEntryRow({ entries }: { entries: TimeEntry[] }) {
  const { t } = useTranslation();
  const { projects } = useProjectsStore();
  const { start, stop, runningEntry } = useEntriesStore();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const first = entries[0];
  const project = projects.find((p) => p.id === first.projectId) ?? null;
  const total = entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);

  async function handleCopy() {
    const text = first.taskNumber ? `${first.taskNumber} - ${first.description}` : first.description;
    await writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleRestart() {
    if (runningEntry) await stop();
    await start({
      description: first.description,
      taskNumber: first.taskNumber,
      projectId: first.projectId,
      startTime: nowIso(),
    });
  }

  return (
    <div>
      <div className="relative flex items-center gap-1 hover:bg-[var(--color-surface-hover)]">
        <button
          type="button"
          onClick={() => setExpanded((o) => !o)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] px-3 py-2 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
        >
          <ChevronRight
            size={14}
            className={cn("shrink-0 text-[var(--color-text-muted)] transition-transform", expanded && "rotate-90")}
          />

          <span className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
            {first.taskNumber && (
              <span className="shrink-0 rounded-[2px] bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                {first.taskNumber}
              </span>
            )}
            <span className="min-w-0 truncate text-sm">
              {first.description || <span className="text-[var(--color-text-muted)]">{t("records.noDescription")}</span>}
            </span>
            <span className="shrink-0 rounded-[2px] bg-[var(--color-bg)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
              ×{entries.length}
            </span>
          </span>

          <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              {project ? (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ backgroundColor: project.color }} />
                  <span className="max-w-[10rem] truncate">{projectLabel(project)}</span>
                </>
              ) : (
                <span className="italic">{t("records.noProject")}</span>
              )}
            </span>

            <span className="w-14 text-right font-mono text-sm tabular-nums">{formatDurationHuman(total)}</span>
          </span>
        </button>

        <button
          type="button"
          onClick={handleRestart}
          aria-label={t("records.restart")}
          title={t("records.restart")}
          className={`${iconButtonClass} hover:text-[var(--color-accent)]`}
        >
          <Play size={14} />
        </button>

        <button type="button" onClick={handleCopy} aria-label={t("records.copy")} className={iconButtonClass}>
          {copied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Copy size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="ml-5 border-l border-[var(--color-border)] pl-1">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
