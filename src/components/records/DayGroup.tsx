import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Loader2, RefreshCw, SearchCheck, Send } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { Project, TimeEntry } from "../../types";
import type { EntryOrGroup } from "../../lib/grouping";
import { EntryRow } from "./EntryRow";
import { GroupedEntryRow } from "./GroupedEntryRow";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useLiveElapsed } from "../../hooks/useLiveElapsed";
import { formatDateShort, formatDayLabel, formatDurationHuman } from "../../lib/time";
import { checkUnits, sendUnits, useSyncPlan } from "../../integrations/proofhub/sync";
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
  const [checkingDay, setCheckingDay] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const runningElapsed = useLiveElapsed(runningEntry?.startTime);
  const total =
    items.reduce((sum, item) => {
      const entries = Array.isArray(item) ? item : [item];
      return sum + entries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
    }, 0) + runningElapsed;
  const referenceEntry = items[0] ? firstEntry(items[0]) : runningEntry ?? null;
  const title = label ? t(`records.${label}`) : referenceEntry ? formatDayLabel(referenceEntry.startTime, i18n.language) : "";

  // The day's ProofHub units (see integrations/proofhub/plan.ts). The
  // button sends whatever isn't synced yet; once everything is, it turns
  // into a checkmark that sends the whole day again (e.g. after entries
  // were deleted or changed in ProofHub itself).
  const dayUnits = useSyncPlan().units.filter((unit) => unit.day === dayKey);
  const unsynced = dayUnits.filter((unit) => unit.status !== "synced");
  const daySynced = dayUnits.length > 0 && unsynced.length === 0;
  const daySent = dayUnits.some((unit) => unit.reuse);

  async function handleSendDay() {
    const toSend = daySynced ? dayUnits : unsynced;
    const hours = formatDurationHuman(toSend.reduce((sum, unit) => sum + unit.totalSeconds, 0));
    const changed = toSend.filter((unit) => unit.status === "changed").length;
    const ok = await confirm(
      t(daySynced ? "proofhub.resendDayConfirm" : changed ? "proofhub.sendDayChangedConfirm" : "proofhub.sendDayConfirm", {
        count: toSend.length,
        hours,
        changed,
      }),
    );
    if (!ok) return;

    setSendingDay(true);
    setSendError(null);
    const errors = await sendUnits(toSend);
    setSendingDay(false);
    if (errors.length > 0) setSendError(t("proofhub.sendDayFailure", { count: errors.length, message: errors[0] }));
  }

  async function handleCheckDay() {
    setCheckingDay(true);
    setSendError(null);
    try {
      await checkUnits(dayUnits);
    } catch (err) {
      setSendError(t("proofhub.checkFailure", { message: String(err) }));
    } finally {
      setCheckingDay(false);
    }
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
          {dayUnits.length > 0 && (
            <button
              type="button"
              onClick={handleSendDay}
              disabled={sendingDay}
              aria-label={t(daySynced ? "proofhub.resendDay" : "proofhub.sendDay")}
              title={t(daySynced ? "proofhub.resendDay" : "proofhub.sendDay")}
              className="group/send rounded-[2px] p-1 text-[var(--color-text-muted)] opacity-0 outline-none transition-opacity hover:bg-[var(--color-border)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)] group-hover:opacity-100"
            >
              {sendingDay ? (
                <Loader2 size={12} className="animate-spin" />
              ) : daySynced ? (
                // A checkmark doesn't look clickable, so hovering shows what a click does.
                <>
                  <Check size={12} className="text-[var(--color-accent)] group-hover/send:hidden group-focus-visible/send:hidden" />
                  <RefreshCw size={12} className="hidden group-hover/send:block group-focus-visible/send:block" />
                </>
              ) : (
                <Send size={12} />
              )}
            </button>
          )}
          {daySent && (
            <button
              type="button"
              onClick={handleCheckDay}
              disabled={checkingDay}
              aria-label={t("proofhub.checkDay")}
              title={t("proofhub.checkDay")}
              className="rounded-[2px] p-1 text-[var(--color-text-muted)] opacity-0 outline-none transition-opacity hover:bg-[var(--color-border)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)] group-hover:opacity-100"
            >
              {checkingDay ? <Loader2 size={12} className="animate-spin" /> : <SearchCheck size={12} />}
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
