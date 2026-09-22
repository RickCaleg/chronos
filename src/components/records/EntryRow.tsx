import { memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Trash2 } from "lucide-react";
import { platform } from "@platform";
import { confirm } from "../ui/ConfirmDialog";
import type { TimeEntry } from "../../types";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { EntryEditPopover } from "./EntryEditPopover";
import { EntryNote, NoteButton } from "./EntryNote";
import { RestartButton } from "./RestartButton";
import { revealOnRowHover, rowIconButton } from "./rowStyles";
import { cn } from "../../lib/cn";
import { formatDurationHuman, formatTimeShort } from "../../lib/time";
import { projectLabel } from "../../lib/projectLabel";
import { SyncBadge } from "../../integrations/proofhub/SyncBadge";
import i18n from "../../i18n";


/**
 * Memoized, and subscribed to the stores by selector: a row re-renders only
 * when its own entry (or the project list) changes, not on every change to
 * any entry, such as starting the timer.
 */
export const EntryRow = memo(function EntryRow({ entry }: { entry: TimeEntry }) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const update = useEntriesStore((s) => s.update);
  const remove = useEntriesStore((s) => s.remove);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const project = projects.find((p) => p.id === entry.projectId) ?? null;

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function handleDelete() {
    if (await confirm(t("records.deleteConfirm"), { danger: true, confirmLabel: t("editor.delete") })) {
      remove(entry.id);
      setOpen(false);
    }
  }

  async function handleCopy() {
    const text = entry.taskNumber ? `${entry.taskNumber} - ${entry.description}` : entry.description;
    await platform.copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group/row relative hover:bg-[var(--color-surface-hover)]">
      <div className="flex items-center gap-1">
        <RestartButton entry={entry} />

        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] py-2 pl-1 pr-3 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
        >
          <span className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
            {entry.taskNumber && (
              <span className="shrink-0 rounded-[2px] bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                {entry.taskNumber}
              </span>
            )}
            <span className="min-w-0 truncate text-sm">
              {entry.description || <span className="text-[var(--color-text-muted)]">{t("records.noDescription")}</span>}
            </span>
          </span>

          <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
            {entry.tags.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {entry.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-[2px] bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                  >
                    {tag.name}
                  </span>
                ))}
              </span>
            )}

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

            <span className="text-xs text-[var(--color-text-muted)]">
              {formatTimeShort(entry.startTime, i18n.language)}
              {entry.endTime ? ` – ${formatTimeShort(entry.endTime, i18n.language)}` : ""}
            </span>

            <span className="w-14 text-right font-mono text-sm tabular-nums">
              {formatDurationHuman(entry.durationSeconds ?? 0)}
            </span>
          </span>
        </button>

        <NoteButton entries={[entry]} onClick={() => setEditingNote(true)} />

        <SyncBadge entries={[entry]} />

        <button
          type="button"
          onClick={handleCopy}
          aria-label={t("records.copy")}
          title={t("records.copy")}
          className={cn(rowIconButton, !copied && revealOnRowHover)}
        >
          {copied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Copy size={14} />}
        </button>

        <button
          type="button"
          onClick={handleDelete}
          aria-label={t("editor.delete")}
          title={t("editor.delete")}
          className={cn(rowIconButton, revealOnRowHover, "hover:text-[var(--color-danger)]")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <EntryNote entries={[entry]} editing={editingNote} onEditingChange={setEditingNote} />

      {/* Mounted only while open: every row keeping one mounted rebuilt the
          whole autocomplete list per row on each change to the entries. */}
      {open && (
        <EntryEditPopover
          open
          onClose={close}
          entry={entry}
          onSave={(patch) => update(entry.id, patch)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
});
