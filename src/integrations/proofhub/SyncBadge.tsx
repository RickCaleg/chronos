import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, RefreshCw, Send, Loader2 } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { TimeEntry } from "../../types";
import { formatDurationHuman } from "../../lib/time";
import { sendUnits, useSyncPlan } from "./sync";
import { useProofHubStore } from "./useProofHubStore";

const iconButtonClass =
  "shrink-0 rounded-[2px] p-1 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]";

/**
 * Per-row ProofHub sync button, shown next to tag chips in
 * EntryRow/GroupedEntryRow — see docs/proofhub-integration.md section 8.
 * Renders nothing unless the entry's project is mapped, so it's invisible
 * for every user who hasn't set up the integration. Always sends the
 * entry's whole unit (with "group pushes by day" on, every same-task entry
 * of that day), and is clickable in every state: once synced, clicking
 * sends it again, which recreates it if it was deleted in ProofHub.
 */
export function SyncBadge({ entry }: { entry: TimeEntry }) {
  const { t } = useTranslation();
  const unit = useSyncPlan().byEntryId.get(entry.id);
  const sending = useProofHubStore((s) => s.sending[entry.id]);
  const error = useProofHubStore((s) => s.sendErrors[entry.id]);

  if (!unit) return null;

  const groupNote =
    unit.entries.length > 1
      ? ` — ${t("proofhub.unitNote", { count: unit.entries.length, hours: formatDurationHuman(unit.totalSeconds) })}`
      : "";

  const handleClick = async () => {
    if (unit.status === "synced" && !(await confirm(t("proofhub.resendConfirm")))) return;
    await sendUnits([unit]);
  };

  if (sending) {
    return (
      <span className={iconButtonClass} aria-label={t("proofhub.sending")} title={t("proofhub.sending")}>
        <Loader2 size={13} className="animate-spin" />
      </span>
    );
  }

  const [Icon, label, tone] = error
    ? [AlertTriangle, error, "text-[var(--color-danger)]"]
    : unit.status === "synced"
      ? [Check, t("proofhub.synced"), "text-[var(--color-accent)]"]
      : unit.status === "pending"
        ? [RefreshCw, t("proofhub.outOfSync"), ""]
        : [Send, t("proofhub.sendToProofHub"), ""];

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`${iconButtonClass} ${tone}`}
      aria-label={label + groupNote}
      title={label + groupNote}
    >
      <Icon size={13} />
    </button>
  );
}
