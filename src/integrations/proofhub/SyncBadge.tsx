import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Send, Loader2 } from "lucide-react";
import type { TimeEntry } from "../../types";
import { pushEntryToProofHub, isProofHubMappable } from "./sync";

const iconButtonClass =
  "shrink-0 rounded-[2px] p-1 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]";

/**
 * Per-entry ProofHub sync affordance, shown next to tag chips in
 * EntryRow/GroupedEntryRow — see docs/proofhub-integration.md section 8.1.
 * Renders nothing unless the entry's project is actually mapped, so it's
 * invisible for every user who hasn't set up the integration.
 */
export function SyncBadge({ entry }: { entry: TimeEntry }) {
  const { t } = useTranslation();
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (entry.isRunning || !isProofHubMappable(entry)) return null;

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    try {
      await pushEntryToProofHub(entry);
    } catch (err) {
      setError(String(err));
    } finally {
      setPushing(false);
    }
  };

  if (pushing) {
    return (
      <span className={iconButtonClass} aria-label={t("proofhub.sending")} title={t("proofhub.sending")}>
        <Loader2 size={13} className="animate-spin" />
      </span>
    );
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={handlePush}
        className={`${iconButtonClass} text-[var(--color-danger)]`}
        aria-label={error}
        title={error}
      >
        <AlertTriangle size={13} />
      </button>
    );
  }

  if (entry.proofhubSyncedAt) {
    return (
      <span
        className={`${iconButtonClass} text-[var(--color-accent)]`}
        aria-label={t("proofhub.synced")}
        title={t("proofhub.synced")}
      >
        <Check size={13} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handlePush}
      className={iconButtonClass}
      aria-label={t("proofhub.sendToProofHub")}
      title={t("proofhub.sendToProofHub")}
    >
      <Send size={13} />
    </button>
  );
}
