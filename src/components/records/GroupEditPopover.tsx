import { useMemo, useState, type ClipboardEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FloatingPanel } from "../ui/FloatingPanel";
import { AutocompleteInput } from "../ui/AutocompleteInput";
import { TagInput } from "../ui/TagInput";
import { Button } from "../ui/Button";
import { ProjectPicker } from "../timer/ProjectPicker";
import type { Tag, TimeEntry } from "../../types";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useTagsStore } from "../../store/useTagsStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useSuggestions } from "../../hooks/useSuggestions";
import { combineTaskDescription, splitTaskDescription } from "../../lib/taskDescription";
import { matchProjectByAlias, parsePastedEntry } from "../../lib/pasteParser";
import { confirm } from "../ui/ConfirmDialog";

interface GroupEditPopoverProps {
  open: boolean;
  onClose: () => void;
  /** A displayed group: same task number, description and project (lib/grouping.ts). */
  entries: TimeEntry[];
}

/**
 * Edits every entry of a group at once — what they share: task and
 * description, project, and tags. Times stay per entry (open the group to
 * change them). Tags are applied as a change: what you add goes on every
 * entry and what you remove comes off every entry, while tags only some
 * entries have are left alone.
 */
export function GroupEditPopover({ open, onClose, entries }: GroupEditPopoverProps) {
  const { t } = useTranslation();
  const first = entries[0];
  const { update, setEntryTags, remove } = useEntriesStore();
  const { projects } = useProjectsStore();
  const { tags: allTags, findOrCreate: findOrCreateTag } = useTagsStore();
  const suggestions = useSuggestions();
  const suggestionByDisplay = useMemo(() => new Map(suggestions.map((s) => [s.display, s])), [suggestions]);

  // Tags every entry has — the only ones the group can show as "on".
  const commonTags = useMemo(
    () => first.tags.filter((tag) => entries.every((e) => e.tags.some((other) => other.id === tag.id))),
    [entries, first.tags],
  );
  const someHaveMore = entries.some((e) => e.tags.length > commonTags.length);

  const [draft, setDraft] = useState(combineTaskDescription(first.taskNumber, first.description));
  const [projectId, setProjectId] = useState<string | null>(first.projectId);
  const [tags, setTags] = useState<Tag[]>(commonTags);

  if (!open) return null;

  function handleEntryPaste(e: ClipboardEvent<HTMLInputElement>) {
    const parsed = parsePastedEntry(e.clipboardData.getData("text"));
    if (!parsed) return;
    e.preventDefault();
    setDraft(combineTaskDescription(parsed.taskNumber, parsed.description));
    if (parsed.aliasToken) {
      const matched = matchProjectByAlias(parsed.aliasToken, projects);
      if (matched) setProjectId(matched.id);
    }
  }

  function handleSelectSuggestion(value: string) {
    const match = suggestionByDisplay.get(value);
    if (match?.projectId) setProjectId(match.projectId);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { taskNumber, description } = splitTaskDescription(draft.trim());
    const added = tags.filter((tag) => !commonTags.some((c) => c.id === tag.id));
    const removedIds = new Set(commonTags.filter((c) => !tags.some((tag) => tag.id === c.id)).map((c) => c.id));

    for (const entry of entries) {
      const patch = {
        ...(description !== entry.description ? { description } : {}),
        ...(taskNumber !== entry.taskNumber ? { taskNumber } : {}),
        ...(projectId !== entry.projectId ? { projectId } : {}),
      };
      if (Object.keys(patch).length > 0) await update(entry.id, patch);

      if (added.length > 0 || removedIds.size > 0) {
        const kept = entry.tags.filter((tag) => !removedIds.has(tag.id));
        const next = [...kept, ...added.filter((tag) => !kept.some((k) => k.id === tag.id))];
        await setEntryTags(entry.id, next);
      }
    }
    onClose();
  }

  async function handleDelete() {
    const ok = await confirm(t("records.deleteGroupConfirm", { count: entries.length }), {
      danger: true,
      confirmLabel: t("editor.delete"),
    });
    if (!ok) return;
    for (const entry of entries) await remove(entry.id);
    onClose();
  }

  return (
    <FloatingPanel open={open} onClose={onClose} align="right" className="w-80">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-[var(--color-text-muted)]">{t("records.groupEditHint", { count: entries.length })}</p>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            {t("editor.taskDescription")}
          </label>
          <AutocompleteInput
            value={draft}
            onChange={setDraft}
            onSelect={handleSelectSuggestion}
            suggestions={suggestions.map((s) => s.display)}
            onPaste={handleEntryPaste}
            placeholder={t("timer.combinedPlaceholder")}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            {t("editor.project")}
          </label>
          <ProjectPicker value={projectId} onChange={setProjectId} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">{t("editor.tags")}</label>
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={allTags}
            onCreate={findOrCreateTag}
            placeholder={t("editor.tagsPlaceholder")}
          />
          {someHaveMore && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("records.groupTagsHint")}</p>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button type="button" size="sm" variant="danger" onClick={handleDelete}>
            {t("records.deleteGroup", { count: entries.length })}
          </Button>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              {t("editor.cancel")}
            </Button>
            <Button type="submit" size="sm" variant="primary">
              {t("editor.save")}
            </Button>
          </div>
        </div>
      </form>
    </FloatingPanel>
  );
}
