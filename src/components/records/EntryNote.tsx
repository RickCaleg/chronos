import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react";
import type { TimeEntry } from "../../types";
import { useEntriesStore } from "../../store/useEntriesStore";
import { cn } from "../../lib/cn";
import { revealOnRowHover, rowIconButton } from "./rowStyles";


/**
 * What a set of entries (one row, or a whole group) has as its note: the
 * shared note, or `mixed` when they differ — a group row can only show and
 * edit one note for all of its entries.
 */
function sharedNote(entries: TimeEntry[]): { note: string | null; mixed: boolean } {
  const notes = new Set(entries.map((e) => e.note?.trim() || ""));
  if (notes.size > 1) return { note: null, mixed: true };
  const [only] = notes;
  return { note: only || null, mixed: false };
}

/** The row's toggle for its note editor; accent-coloured when there's a note. */
export function NoteButton({
  entries,
  onClick,
  alwaysVisible = false,
}: {
  entries: TimeEntry[];
  onClick: () => void;
  /** For use outside a list row, where there's no row hover to reveal it. */
  alwaysVisible?: boolean;
}) {
  const { t } = useTranslation();
  const hasNote = entries.some((e) => e.note?.trim());
  const label = hasNote ? t("records.editNote") : t("records.addNote");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      // With a note it's state worth seeing; without one, just an action.
      className={cn(rowIconButton, hasNote ? "text-[var(--color-accent)]" : !alwaysVisible && revealOnRowHover)}
    >
      <NotebookPen size={14} />
    </button>
  );
}

/**
 * The note of a row — or of a group row, where it's the note of every entry
 * in the group — shown in small text under it. It's free text about what
 * was done, sent to ProofHub as the description (see `unitDescription` in
 * integrations/proofhub/plan.ts). Clicking it, or the row's NoteButton,
 * edits it in place.
 */
export function EntryNote({
  entries,
  editing,
  onEditingChange,
  indentClass = "pl-10",
}: {
  entries: TimeEntry[];
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Left padding lining the note up with the row's description text. */
  indentClass?: string;
}) {
  const { t } = useTranslation();
  const update = useEntriesStore((s) => s.update);
  const { note, mixed } = sharedNote(entries);

  function save(next: string | null) {
    for (const entry of entries) {
      if ((entry.note?.trim() || null) !== next) update(entry.id, { note: next });
    }
  }

  if (editing) {
    return (
      <NoteEditor
        initial={note ?? ""}
        hint={mixed ? t("records.groupNoteReplaces", { count: entries.length }) : undefined}
        onSave={save}
        onDone={() => onEditingChange(false)}
        indentClass={indentClass}
      />
    );
  }
  if (!note && !mixed) return null;

  return (
    <button
      type="button"
      onClick={() => onEditingChange(true)}
      title={t("records.editNote")}
      className={cn(
        indentClass,
        "block w-full whitespace-pre-wrap break-words pb-2 pr-3 text-left text-xs text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]",
        mixed && "italic",
      )}
    >
      {mixed ? t("records.groupNotesDiffer") : note}
    </button>
  );
}

/** Ctrl+Enter or leaving the field saves, Esc cancels. */
function NoteEditor({
  initial,
  hint,
  onSave,
  onDone,
  indentClass,
}: {
  initial: string;
  hint?: string;
  onSave: (note: string | null) => void;
  onDone: () => void;
  indentClass: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  // Set once saved or cancelled, so the blur some engines fire as the
  // field unmounts can't save a second time (or save a cancelled edit).
  const done = useRef(false);

  function save() {
    if (done.current) return;
    done.current = true;
    // Untouched means unchanged — so a mixed group's empty field left as is
    // keeps each entry's own note.
    if (draft !== initial) onSave(draft.trim() || null);
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
    <div className={cn("pb-2 pr-3", indentClass)}>
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
      <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{hint ?? t("records.noteHint")}</p>
    </div>
  );
}
