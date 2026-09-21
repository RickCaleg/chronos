import { useMemo, useState, type ClipboardEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Input } from "../ui/Input";
import { AutocompleteInput } from "../ui/AutocompleteInput";
import { TagInput } from "../ui/TagInput";
import { Button } from "../ui/Button";
import { ProjectPicker } from "../timer/ProjectPicker";
import type { Tag, TimeEntry } from "../../types";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useTagsStore } from "../../store/useTagsStore";
import {
  addSeconds,
  durationBetween,
  formatDurationInput,
  formatLocalDateTimeInput,
  parseDurationInput,
  parseLocalDateTimeInput,
} from "../../lib/time";
import { combineTaskDescription, splitTaskDescription } from "../../lib/taskDescription";
import type { EntryPatch } from "../../db/entries";
import { useSuggestions } from "../../hooks/useSuggestions";
import { useProjectsStore } from "../../store/useProjectsStore";
import { matchProjectByAlias, parsePastedEntry } from "../../lib/pasteParser";
import { SyncSection } from "../../integrations/proofhub/SyncSection";

interface EntryEditPopoverProps {
  open: boolean;
  onClose: () => void;
  entry: TimeEntry;
  /** `tags` is only meaningful for a new entry: an existing one's tags are saved as they change. */
  onSave: (patch: EntryPatch, tags: Tag[]) => void;
  onDelete?: () => void;
  /**
   * `entry` is a not-yet-saved draft (manual entry): tags are kept until
   * saving, and there's nothing to delete or sync yet.
   */
  isNew?: boolean;
  align?: "left" | "right";
}

export function EntryEditPopover({
  open,
  onClose,
  entry,
  onSave,
  onDelete,
  isNew = false,
  align = "right",
}: EntryEditPopoverProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(combineTaskDescription(entry.taskNumber, entry.description));
  const [projectId, setProjectId] = useState<string | null>(entry.projectId);

  const [start, setStart] = useState(entry.startTime);
  const [end, setEnd] = useState(entry.endTime ?? entry.startTime);
  const [startText, setStartText] = useState(formatLocalDateTimeInput(start));
  const [endText, setEndText] = useState(formatLocalDateTimeInput(end));
  const [durationText, setDurationText] = useState(
    formatDurationInput(entry.durationSeconds ?? durationBetween(entry.startTime, end)),
  );
  const [startError, setStartError] = useState(false);
  const [endError, setEndError] = useState(false);
  const [durationError, setDurationError] = useState(false);
  const suggestions = useSuggestions();
  const suggestionByDisplay = useMemo(() => new Map(suggestions.map((s) => [s.display, s])), [suggestions]);
  const { projects } = useProjectsStore();
  const { tags: allTags, findOrCreate: findOrCreateTag } = useTagsStore();
  const setEntryTags = useEntriesStore((s) => s.setEntryTags);
  const [stagedTags, setStagedTags] = useState<Tag[]>(entry.tags);

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

  const isFutureStart = new Date(start).getTime() > Date.now();
  const isInvalidRange = new Date(end).getTime() <= new Date(start).getTime();
  const hasErrors = startError || endError || durationError || isFutureStart || isInvalidRange;

  function handleStartChange(value: string) {
    setStartText(value);
    const parsed = parseLocalDateTimeInput(value, start);
    if (!parsed) return;
    setStart(parsed);
    setDurationText(formatDurationInput(durationBetween(parsed, end)));
  }

  function handleStartBlur() {
    const parsed = parseLocalDateTimeInput(startText, start);
    if (parsed) {
      setStart(parsed);
      setStartText(formatLocalDateTimeInput(parsed));
      setDurationText(formatDurationInput(durationBetween(parsed, end)));
      setStartError(false);
    } else {
      setStartError(true);
    }
  }

  function handleEndChange(value: string) {
    setEndText(value);
    const parsed = parseLocalDateTimeInput(value, end);
    if (!parsed) return;
    setEnd(parsed);
    setDurationText(formatDurationInput(durationBetween(start, parsed)));
  }

  function handleEndBlur() {
    const parsed = parseLocalDateTimeInput(endText, end);
    if (parsed) {
      setEnd(parsed);
      setEndText(formatLocalDateTimeInput(parsed));
      setDurationText(formatDurationInput(durationBetween(start, parsed)));
      setEndError(false);
    } else {
      setEndError(true);
    }
  }

  function handleDurationChange(value: string) {
    setDurationText(value);
    const parsed = parseDurationInput(value);
    if (parsed === null) return;
    const newEnd = addSeconds(start, parsed);
    setEnd(newEnd);
    setEndText(formatLocalDateTimeInput(newEnd));
  }

  function handleDurationBlur() {
    const parsed = parseDurationInput(durationText);
    if (parsed !== null) {
      setDurationText(formatDurationInput(parsed));
      setDurationError(false);
    } else {
      setDurationError(true);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (hasErrors) return;
    const { taskNumber, description } = splitTaskDescription(draft.trim());
    onSave({
      description,
      taskNumber,
      projectId,
      startTime: start,
      endTime: end,
      durationSeconds: durationBetween(start, end),
    }, stagedTags);
    onClose();
  }

  return (
    <FloatingPanel open={open} onClose={onClose} align={align} className="w-80">
      <form onSubmit={handleSubmit} className="space-y-3">
        {isNew && <h2 className="text-sm font-medium">{t("editor.newEntry")}</h2>}
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
            value={isNew ? stagedTags : entry.tags}
            onChange={(tags) => (isNew ? setStagedTags(tags) : setEntryTags(entry.id, tags))}
            suggestions={allTags}
            onCreate={findOrCreateTag}
            placeholder={t("editor.tagsPlaceholder")}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            {t("editor.start")}
          </label>
          <Input
            value={startText}
            onChange={(e) => handleStartChange(e.target.value)}
            onBlur={handleStartBlur}
            placeholder={t("editor.dateTimePlaceholder")}
          />
          {startError && <p className="mt-1 text-xs text-[var(--color-danger)]">{t("editor.invalidDateTime")}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            {t("editor.end")}
          </label>
          <Input
            value={endText}
            onChange={(e) => handleEndChange(e.target.value)}
            onBlur={handleEndBlur}
            placeholder={t("editor.dateTimePlaceholder")}
          />
          {endError && <p className="mt-1 text-xs text-[var(--color-danger)]">{t("editor.invalidDateTime")}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            {t("editor.duration")}
          </label>
          <Input
            value={durationText}
            onChange={(e) => handleDurationChange(e.target.value)}
            onBlur={handleDurationBlur}
            className="w-28"
          />
          {durationError && <p className="mt-1 text-xs text-[var(--color-danger)]">{t("editor.invalidDuration")}</p>}
        </div>

        {!startError && !endError && isFutureStart && (
          <p className="text-xs text-[var(--color-danger)]">{t("editor.futureStart")}</p>
        )}
        {!startError && !endError && !isFutureStart && isInvalidRange && (
          <p className="text-xs text-[var(--color-danger)]">{t("editor.invalidRange")}</p>
        )}

        {!isNew && <SyncSection entry={entry} />}

        <div className="flex items-center justify-between pt-1">
          {onDelete ? (
            <Button type="button" size="sm" variant="danger" onClick={onDelete}>
              {t("editor.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              {t("editor.cancel")}
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={hasErrors}>
              {isNew ? t("editor.add") : t("editor.save")}
            </Button>
          </div>
        </div>
      </form>
    </FloatingPanel>
  );
}
