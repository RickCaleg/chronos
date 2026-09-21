import { useState } from "react";
import { useTranslation } from "react-i18next";
import { confirm } from "../../components/ui/ConfirmDialog";
import type { TimeEntry } from "../../types";
import { Button } from "../../components/ui/Button";
import { checkUnits, forgetUnit } from "./sync";
import { useProofHubStore } from "./useProofHubStore";
import { combinedStatus, sendWithConfirm, useUnitsFor } from "./SyncBadge";
import type { UnitStatus } from "./plan";

const statusTextKey: Record<UnitStatus, string> = {
  new: "proofhub.statusNew",
  pending: "proofhub.statusPending",
  synced: "proofhub.statusSynced",
  missing: "proofhub.statusMissing",
  changed: "proofhub.statusChanged",
};

/**
 * The entry's ProofHub state inside its edit popover, with every action
 * spelled out: send/resend, check whether it's still there, and forget
 * that it was sent. Acts on the saved entry, not unsaved edits in the
 * popover. Renders nothing unless the entry's project is mapped.
 */
export function SyncSection({ entry }: { entry: TimeEntry }) {
  const { t } = useTranslation();
  const units = useUnitsFor([entry]);
  const sending = useProofHubStore((s) => !!s.sending[entry.id]);
  const sendError = useProofHubStore((s) => s.sendErrors[entry.id]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  if (units.length === 0) return null;
  const unit = units[0];
  const status = combinedStatus(units);
  const wasSent = unit.entries.some((e) => e.proofhubTimeEntryId);
  const error = sendError ?? checkError;

  async function handleCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      await checkUnits(units);
    } catch (err) {
      setCheckError(String(err));
    } finally {
      setChecking(false);
    }
  }

  async function handleForget() {
    if (await confirm(t("proofhub.forgetConfirm"), { danger: true, confirmLabel: t("proofhub.forget") })) await forgetUnit(unit);
  }

  return (
    <div className="border-t border-[var(--color-border)] pt-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">{t("proofhub.title")}</span>
        <span
          className={
            status === "missing" || status === "changed"
              ? "text-xs text-[var(--color-danger)]"
              : "text-xs text-[var(--color-text-muted)]"
          }
        >
          {t(statusTextKey[status])}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={sending} onClick={() => sendWithConfirm(units, t)}>
          {sending ? t("proofhub.sending") : t(status === "new" ? "proofhub.send" : "proofhub.resend")}
        </Button>
        {unit.reuse && (
          <Button type="button" size="sm" variant="ghost" disabled={checking || sending} onClick={handleCheck}>
            {checking ? t("proofhub.checking") : t("proofhub.check")}
          </Button>
        )}
        {wasSent && (
          <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={handleForget}>
            {t("proofhub.forget")}
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
