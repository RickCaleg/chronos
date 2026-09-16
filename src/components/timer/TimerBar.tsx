import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square } from "lucide-react";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { ProjectPicker } from "./ProjectPicker";
import { TimeAdjustPopover } from "./TimeAdjustPopover";
import { AutocompleteInput } from "../ui/AutocompleteInput";
import { durationBetween, formatClock, nowIso } from "../../lib/time";
import { cn } from "../../lib/cn";
import { useSuggestions } from "../../hooks/useSuggestions";
import { matchProjectByAlias, parsePastedEntry } from "../../lib/pasteParser";

export function TimerBar() {
  const { t } = useTranslation();
  const { runningEntry, start, stop, update, setRunningStart } = useEntriesStore();
  const { projects } = useProjectsStore();
  const [description, setDescription] = useState("");
  const [taskNumber, setTaskNumber] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const { tasks, descriptions } = useSuggestions();

  const isRunning = !!runningEntry;

  useEffect(() => {
    if (!runningEntry) return;
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
  }, [isRunning, description, taskNumber, projectId]);

  async function handleStart() {
    await start({
      description: description.trim(),
      taskNumber: taskNumber.trim() || null,
      projectId,
      startTime: nowIso(),
    });
    setDescription("");
    setTaskNumber("");
    setProjectId(null);
  }

  function handleStartKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !isRunning) handleStart();
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
      setTaskNumber(parsed.taskNumber);
      setDescription(parsed.description);
      if (matched) setProjectId(matched.id);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <AutocompleteInput
        value={isRunning ? runningEntry.taskNumber ?? "" : taskNumber}
        onChange={(v) =>
          isRunning ? update(runningEntry.id, { taskNumber: v || null }) : setTaskNumber(v)
        }
        onKeyDown={handleStartKeyDown}
        onPaste={handleEntryPaste}
        placeholder={t("timer.taskPlaceholder")}
        suggestions={tasks}
        className="w-24 shrink-0"
      />
      <AutocompleteInput
        value={isRunning ? runningEntry.description : description}
        onChange={(v) => (isRunning ? update(runningEntry.id, { description: v }) : setDescription(v))}
        onKeyDown={handleStartKeyDown}
        onPaste={handleEntryPaste}
        placeholder={t("timer.descriptionPlaceholder")}
        suggestions={descriptions}
        className="min-w-[140px] flex-1 basis-40"
      />
      <ProjectPicker
        value={isRunning ? runningEntry.projectId : projectId}
        onChange={(id) => (isRunning ? update(runningEntry.id, { projectId: id }) : setProjectId(id))}
      />

      <div className="ml-auto flex items-center gap-3">
        {isRunning && <TimeAdjustPopover startTime={runningEntry.startTime} onChange={setRunningStart} />}
        <span className="w-20 text-right font-mono text-lg tabular-nums">{formatClock(elapsed)}</span>
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
