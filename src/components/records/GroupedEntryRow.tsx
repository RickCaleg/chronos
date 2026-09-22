import { memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Copy } from "lucide-react";
import { platform } from "@platform";
import type { TimeEntry } from "../../types";
import { useProjectsStore } from "../../store/useProjectsStore";
import { EntryRow } from "./EntryRow";
import { RestartButton } from "./RestartButton";
import { EntryNote, NoteButton } from "./EntryNote";
import { GroupEditPopover } from "./GroupEditPopover";
import { revealOnRowHover, rowIconButton } from "./rowStyles";
import { formatDurationHuman } from "../../lib/time";
import { projectLabel } from "../../lib/projectLabel";
import { cn } from "../../lib/cn";
import { SyncBadge } from "../../integrations/proofhub/SyncBadge";


/** Grouping rebuilds the arrays on every change, so compare the entries themselves. */
const sameEntries = (a: { entries: TimeEntry[] }, b: { entries: TimeEntry[] }) =>
  a.entries.length === b.entries.length && a.entries.every((e, i) => e === b.entries[i]);

export const GroupedEntryRow = memo(function GroupedEntryRow({ entries }: { entries: TimeEntry[] }) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement>(null);

  const first = entries[0];
  const project = projects.find((p) => p.id === first.projectId) ?? null;
  const total = entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);
  const uniqueTags = Array.from(new Map(entries.flatMap((e) => e.tags).map((tag) => [tag.id, tag])).values());

  async function handleCopy() {
    const text = first.taskNumber ? `${first.taskNumber} - ${first.description}` : first.description;
    await platform.copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="group/row relative hover:bg-[var(--color-surface-hover)]">
        <div className="flex items-center gap-1">
          <RestartButton entry={first} />

          <button
            type="button"
            onClick={() => setExpanded((o) => !o)}
            aria-expanded={expanded}
            aria-label={t(expanded ? "records.collapseGroup" : "records.expandGroup")}
            title={t(expanded ? "records.collapseGroup" : "records.expandGroup")}
            className="shrink-0 rounded-[2px] p-1 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >
            <ChevronRight size={14} className={cn("transition-transform", expanded && "rotate-90")} />
          </button>

          {/* Like a single entry's row, clicking the group opens its editor — which edits every entry in it. */}
          <button
            ref={editTriggerRef}
            type="button"
            onClick={() => setEditOpen(true)}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] py-2 pl-1 pr-3 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >

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
              {uniqueTags.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
                  {uniqueTags.map((tag) => (
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

              <span className="w-14 text-right font-mono text-sm tabular-nums">{formatDurationHuman(total)}</span>
            </span>
          </button>

          {/* The group's note is every entry's note; single entries can still differ once expanded. */}
          <NoteButton entries={entries} onClick={() => setEditingNote(true)} />

          {/* Acts on every ProofHub unit in the group: one with "group pushes by day" on, one per entry otherwise. */}
          <SyncBadge entries={entries} />

          <button
            type="button"
            onClick={handleCopy}
            aria-label={t("records.copy")}
            title={t("records.copy")}
            className={cn(rowIconButton, !copied && revealOnRowHover)}
          >
            {copied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Copy size={14} />}
          </button>
          {/* Where a single entry has its delete button, so durations line up across rows. */}
          <span aria-hidden className="w-[26px] shrink-0" />
        </div>

        {/* Play, chevron and paddings: 66px to the description text. */}
        <EntryNote entries={entries} editing={editingNote} onEditingChange={setEditingNote} indentClass="pl-[66px]" />

        {/* Mounted only while open, so it always starts from the entries' current values. */}
        {editOpen && (
          <GroupEditPopover
            open
            entries={entries}
            onClose={() => {
              setEditOpen(false);
              editTriggerRef.current?.focus();
            }}
          />
        )}
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
}, sameEntries);
