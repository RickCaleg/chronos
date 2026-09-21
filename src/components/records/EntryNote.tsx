import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react";
import type { TimeEntry } from "../../types";
import { useEntriesStore } from "../../store/useEntriesStore";
import { cn } from "../../lib/cn";

const iconButtonClass =
  "shrink-0 rounded-[2px] p-1.5 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]";

/** The row's toggle for its note editor; accent-coloured when the entry has a note. */
export function NoteButton({ entry, onClick }: { entry: TimeEntry; onClick: () => void }) {
  const { t } = useTranslation();
  const hasNote = !!entry.note?.trim();
  const label = hasNote ? t("records.editNote") : t("records.addNote");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(iconButtonClass, hasNote && "text-[var(--color-accent)]")}
    >
      <NotebookPen size={14} />
    </button>
  );
}

/**
 * A row's note, shown in small text under it — free text about what was
 * done, sent to ProofHub instead of the entry's name (see `unitDescription`
 * in integrations/proofhub/plan.ts). Clicking it, or the row's
 * NoteButton, edits it in place.
 */
export function EntryNote({
  entry,
  editing,
  onEditingChange,
}: {
  entry: TimeEntry;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const note = entry.note?.trim() || null;

  if (editing) return <NoteEditor entry={entry} onDone={() => onEditingChange(false)} />;
  if (!note) return null;

  return (
    <button
      type="button"
      onClick={() => onEditingChange(true)}
      title={t("records.editNote")}
      className="block w-full whitespace-pre-wrap break-words px-3 pb-2 text-left text-xs text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
    >
      {note}
    </button>
  );
}

/** Ctrl+Enter or leaving the field saves, Esc cancels. */
function NoteEditor({ entry, onDone }: { entry: TimeEntry; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useEntriesStore((s) => s.update);
  const [draft, setDraft] = useState(entry.note ?? "");
  // Set once saved or cancelled, so the blur some engines fire as the
  // field unmounts can't save a second time (or save a cancelled edit).
  const done = useRef(false);

  function save() {
    if (done.current) return;
    done.current = true;
    const next = draft.trim() || null;
    if (next !== (entry.note?.trim() || null)) update(entry.id, { note: next });
    onDone();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      done.current = true;
      onDone();
    }
  }

  return (
    <div className="px-3 pb-2">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={save}
        rows={2}
        aria-label={t("records.note")}
        placeholder={t("records.notePlaceholder")}
        className="block w-full resize-y rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]"
      />
      <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{t("records.noteHint")}</p>
    </div>
  );
}
