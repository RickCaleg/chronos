import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square, Trash2 } from "lucide-react";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { ProjectPicker } from "./ProjectPicker";
import { TimeAdjustPopover } from "./TimeAdjustPopover";
import { discardRunningTimer } from "./discardTimer";
import { AutocompleteInput } from "../ui/AutocompleteInput";
import { durationBetween, formatClock, nowIso } from "../../lib/time";
import { cn } from "../../lib/cn";
import { useSuggestions } from "../../hooks/useSuggestions";
import { matchProjectByAlias, parsePastedEntry } from "../../lib/pasteParser";
import { combineTaskDescription, splitTaskDescription } from "../../lib/taskDescription";

export function TimerBar() {
  const { t } = useTranslation();
  const { runningEntry, start, stop, update, setRunningStart } = useEntriesStore();
  const { projects } = useProjectsStore();
  const [draft, setDraft] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const suggestions = useSuggestions();
  const suggestionByDisplay = useMemo(() => new Map(suggestions.map((s) => [s.display, s])), [suggestions]);

  const isRunning = !!runningEntry;
  const combinedValue = isRunning ? combineTaskDescription(runningEntry.taskNumber, runningEntry.description) : draft;

  useEffect(() => {
    if (!runningEntry) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(durationBetween(runningEntry.startTime, nowIso()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [runningEntry?.startTime, runningEntry?.id]);

  useEffect(() => {
    function handleGlobalKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (isRunning) stop();
        else handleStart();
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isRunning, draft, projectId]);

  async function handleStart() {
    const { taskNumber, description } = splitTaskDescription(draft.trim());
    await start({ description, taskNumber, projectId, startTime: nowIso() });
    setDraft("");
    setProjectId(null);
  }

  function handleStartKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !isRunning) handleStart();
  }

  function handleCombinedChange(raw: string) {
    if (isRunning) {
      const { taskNumber, description } = splitTaskDescription(raw);
      update(runningEntry.id, { taskNumber, description });
    } else {
      setDraft(raw);
    }
  }

  function handleSelectSuggestion(value: string) {
    const match = suggestionByDisplay.get(value);
    if (!match?.projectId) return;
    if (isRunning) update(runningEntry.id, { projectId: match.projectId });
    else setProjectId(match.projectId);
  }

  function handleEntryPaste(e: ClipboardEvent<HTMLInputElement>) {
    const parsed = parsePastedEntry(e.clipboardData.getData("text"));
    if (!parsed) return;
    e.preventDefault();
    const matched = parsed.aliasToken ? matchProjectByAlias(parsed.aliasToken, projects) : null;
    if (isRunning) {
      update(runningEntry.id, {
        taskNumber: parsed.taskNumber,
        description: parsed.description,
        ...(matched ? { projectId: matched.id } : {}),
      });
    } else {
      setDraft(combineTaskDescription(parsed.taskNumber, parsed.description));
      if (matched) setProjectId(matched.id);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <AutocompleteInput
        value={combinedValue}
        onChange={handleCombinedChange}
        onSelect={handleSelectSuggestion}
        onKeyDown={handleStartKeyDown}
        onPaste={handleEntryPaste}
        placeholder={t("timer.combinedPlaceholder")}
        suggestions={suggestions.map((s) => s.display)}
        className="min-w-[160px] flex-1"
      />
      <ProjectPicker
        value={isRunning ? runningEntry.projectId : projectId}
        onChange={(id) => (isRunning ? update(runningEntry.id, { projectId: id }) : setProjectId(id))}
      />

      <div className="ml-auto flex items-center gap-3">
        {isRunning && <TimeAdjustPopover startTime={runningEntry.startTime} onChange={setRunningStart} />}
        <span className="w-20 text-right font-mono text-lg tabular-nums">{formatClock(elapsed)}</span>
        {isRunning && (
          <button
            type="button"
            onClick={() => discardRunningTimer(t)}
            aria-label={t("timer.discard")}
            title={t("timer.discard")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] text-[var(--color-text-muted)] outline-none transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >
            <Trash2 size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={isRunning ? stop : handleStart}
          aria-label={isRunning ? t("timer.stop") : t("timer.start")}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] text-white transition-colors cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
            isRunning ? "bg-[var(--color-danger)] hover:opacity-90" : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
          )}
        >
          {isRunning ? <Square size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
        </button>
      </div>
    </div>
  );
}
