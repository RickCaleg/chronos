import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, RefreshCw, Send, Loader2 } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { TimeEntry } from "../../types";
import { formatDurationHuman } from "../../lib/time";
import { sendUnits, useSyncPlan } from "./sync";
import { useProofHubStore } from "./useProofHubStore";
import type { SyncUnit, UnitStatus } from "./plan";

const iconButtonClass =
  "group/badge shrink-0 rounded-[2px] p-1 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]";

/** The distinct units behind these entries, in plan order. */
export function useUnitsFor(entries: TimeEntry[]): SyncUnit[] {
  const { byEntryId } = useSyncPlan();
  const units = new Map<string, SyncUnit>();
  for (const entry of entries) {
    const unit = byEntryId.get(entry.id);
    if (unit) units.set(unit.key, unit);
  }
  return Array.from(units.values());
}

// Most urgent first: what a row of several units shows.
const STATUS_PRIORITY: UnitStatus[] = ["missing", "changed", "pending", "new", "synced"];

export function combinedStatus(units: SyncUnit[]): UnitStatus {
  return STATUS_PRIORITY.find((status) => units.some((unit) => unit.status === status)) ?? "synced";
}

export const statusLabelKey: Record<UnitStatus, string> = {
  new: "proofhub.sendToProofHub",
  pending: "proofhub.outOfSync",
  synced: "proofhub.synced",
  missing: "proofhub.missing",
  changed: "proofhub.changedRemotely",
};

/**
 * Sends what these units need, asking first when that overwrites or
 * duplicates something already in ProofHub: everything already synced is
 * sent again only after a confirmation, and a unit edited in ProofHub
 * (`changed`) is only overwritten after one.
 */
export async function sendWithConfirm(units: SyncUnit[], t: (key: string) => string): Promise<void> {
  const toSend = units.filter((unit) => unit.status !== "synced");
  if (toSend.length === 0) {
    if (!(await confirm(t("proofhub.resendConfirm")))) return;
    await sendUnits(units);
    return;
  }
  if (toSend.some((unit) => unit.status === "changed") && !(await confirm(t("proofhub.changedConfirm")))) return;
  await sendUnits(toSend);
}

/**
 * ProofHub sync button for a row — see docs/proofhub-integration.md
 * section 8. Renders nothing unless the entries' project is mapped, so
 * it's invisible for every user who hasn't set up the integration. Given
 * a displayed group that spans several units (grouped display, ungrouped
 * pushes), it acts on all of them. Clickable in every state: once synced,
 * clicking sends again, which recreates what was deleted in ProofHub.
 */
export function SyncBadge({ entries }: { entries: TimeEntry[] }) {
  const { t } = useTranslation();
  const units = useUnitsFor(entries);
  const sending = useProofHubStore((s) => entries.some((e) => s.sending[e.id]));
  const error = useProofHubStore((s) => entries.map((e) => s.sendErrors[e.id]).find(Boolean));

  if (units.length === 0) return null;

  const status = combinedStatus(units);
  const note =
    units.length > 1
      ? ` — ${t("proofhub.severalUnitsNote", { count: units.length })}`
      : units[0].entries.length > 1
        ? ` — ${t("proofhub.unitNote", { count: units[0].entries.length, hours: formatDurationHuman(units[0].totalSeconds) })}`
        : "";

  if (sending) {
    return (
      <span className={iconButtonClass} aria-label={t("proofhub.sending")} title={t("proofhub.sending")}>
        <Loader2 size={13} className="animate-spin" />
      </span>
    );
  }

  const label = (error ?? t(statusLabelKey[status])) + note;
  const danger = "text-[var(--color-danger)]";
  const icon = error ? (
    <AlertTriangle size={13} className={danger} />
  ) : status === "synced" ? (
    // A checkmark doesn't look clickable, so hovering shows what a click does.
    <>
      <Check size={13} className="text-[var(--color-accent)] group-hover/badge:hidden group-focus-visible/badge:hidden" />
      <RefreshCw size={13} className="hidden group-hover/badge:block group-focus-visible/badge:block" />
    </>
  ) : status === "missing" ? (
    <Send size={13} className={danger} />
  ) : status === "changed" ? (
    <RefreshCw size={13} className={danger} />
  ) : status === "pending" ? (
    <RefreshCw size={13} />
  ) : (
    <Send size={13} />
  );

  return (
    <button type="button" onClick={() => sendWithConfirm(units, t)} className={iconButtonClass} aria-label={label} title={label}>
      {icon}
    </button>
  );
}
