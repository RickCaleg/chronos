import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { Project, TimeEntry } from "../../types";
import { groupSimilarEntries, type EntryOrGroup } from "../../lib/grouping";
import { EntryRow } from "./EntryRow";
import { GroupedEntryRow } from "./GroupedEntryRow";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useLiveElapsed } from "../../hooks/useLiveElapsed";
import { formatDateShort, formatDayLabel, formatDurationHuman } from "../../lib/time";
import { isProofHubMappable, pushEntryToProofHub, pushGroupedEntriesToProofHub } from "../../integrations/proofhub/sync";
import { useProofHubStore } from "../../integrations/proofhub/useProofHubStore";
import i18n from "../../i18n";

interface DayGroupProps {
  dayKey: string;
  label: "today" | "yesterday" | null;
  items: EntryOrGroup[];
  runningEntry?: TimeEntry | null;
}

function firstEntry(item: EntryOrGroup): TimeEntry {
  return Array.isArray(item) ? item[0] : item;
}

function itemKey(item: EntryOrGroup): string {
  return Array.isArray(item) ? item[0].id : item.id;
}

function formatEntryLine(entry: TimeEntry, project: Project | null): string {
  const parts: string[] = [];
  if (entry.taskNumber) parts.push(entry.taskNumber);
  if (project) parts.push(project.alias || project.name);
  parts.push(entry.description || "");
  return ` - ${parts.filter(Boolean).join(" - ")}`;
}

export function DayGroup({ dayKey, label, items, runningEntry }: DayGroupProps) {
  const { t } = useTranslation();
  const { projects } = useProjectsStore();
  const [copied, setCopied] = useState(false);
  const [sendingDay, setSendingDay] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const runningElapsed = useLiveElapsed(runningEntry?.startTime);
  const total =
    items.reduce((sum, item) => {
      const entries = Array.isArray(item) ? item : [item];
      return sum + entries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
    }, 0) + runningElapsed;
  const referenceEntry = items[0] ? firstEntry(items[0]) : runningEntry ?? null;
  const title = label ? t(`records.${label}`) : referenceEntry ? formatDayLabel(referenceEntry.startTime, i18n.language) : "";

  const allEntries = items.flatMap((item) => (Array.isArray(item) ? item : [item]));
  const pushable = allEntries.filter((e) => !e.proofhubSyncedAt && isProofHubMappable(e));

  async function handleSendDay() {
    const hours = formatDurationHuman(pushable.reduce((s, e) => s + (e.durationSeconds ?? 0), 0));
    const ok = await confirm(t("proofhub.sendDayConfirm", { count: pushable.length, hours }));
    if (!ok) return;

    setSendingDay(true);
    setSendError(null);
    let failures = 0;
    // When "group pushes by day" is on, sum same-task/description/project
    // entries into one ProofHub push instead of one per Chronos entry —
    // same grouping criterion the "group similar entries" display option
    // uses, applied here independently of whether that display option is on.
    const groupPushes = useProofHubStore.getState().groupPushesByDay;
    const toSend: TimeEntry[][] = groupPushes
      ? groupSimilarEntries(pushable).map((item) => (Array.isArray(item) ? item : [item]))
      : pushable.map((entry) => [entry]);

    for (const group of toSend) {
      try {
        if (group.length > 1) await pushGroupedEntriesToProofHub(group);
        else await pushEntryToProofHub(group[0]);
        // A gentle pace under ProofHub's 25-requests/10s limit (docs/proofhub-integration.md section 2.3).
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch {
        failures++;
      }
    }
    setSendingDay(false);
    if (failures > 0) setSendError(t("proofhub.sendDayPartialFailure", { count: failures }));
  }

  async function handleCopyDay() {
    const lines = items.map((item) => {
      const entry = firstEntry(item);
      return formatEntryLine(entry, projects.find((p) => p.id === entry.projectId) ?? null);
    });
    if (runningEntry) {
      lines.unshift(formatEntryLine(runningEntry, projects.find((p) => p.id === runningEntry.projectId) ?? null));
    }
    const dateLabel = referenceEntry ? formatDateShort(referenceEntry.startTime) : "";
    await writeText([dateLabel, ...lines].join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group mb-4">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span>{title}</span>
          <button
            type="button"
            onClick={handleCopyDay}
            aria-label={t("records.copyDay")}
            title={t("records.copyDay")}
            className="rounded-[2px] p-1 text-[var(--color-text-muted)] opacity-0 outline-none transition-opacity hover:bg-[var(--color-border)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)] group-hover:opacity-100"
          >
            {copied ? <Check size={12} className="text-[var(--color-accent)]" /> : <Copy size={12} />}
          </button>
          {pushable.length > 0 && (
            <button
              type="button"
              onClick={handleSendDay}
              disabled={sendingDay}
              aria-label={t("proofhub.sendDay")}
              title={t("proofhub.sendDay")}
              className="rounded-[2px] p-1 text-[var(--color-text-muted)] opacity-0 outline-none transition-opacity hover:bg-[var(--color-border)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)] group-hover:opacity-100"
            >
              {sendingDay ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          )}
        </span>
        <span>
          {t("records.total")}: {formatDurationHuman(total)}
        </span>
      </div>
      {sendError && <p className="px-3 pb-1 text-xs text-[var(--color-danger)]">{sendError}</p>}
      <div className="rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)]" key={dayKey}>
        {items.map((item, i) => (
          <div key={itemKey(item)} className={i > 0 ? "border-t border-[var(--color-border)]" : ""}>
            {Array.isArray(item) ? <GroupedEntryRow entries={item} /> : <EntryRow entry={item} />}
          </div>
        ))}
      </div>
    </div>
  );
}
