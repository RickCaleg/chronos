import type { TFunction } from "i18next";
import { useEntriesStore } from "../../store/useEntriesStore";
import { confirm } from "../ui/ConfirmDialog";
import { durationBetween, formatDurationHuman, nowIso } from "../../lib/time";

/** Asks, then throws away the running timer — nothing of it is saved. */
export async function discardRunningTimer(t: TFunction): Promise<void> {
  const { runningEntry, discard } = useEntriesStore.getState();
  if (!runningEntry) return;
  const elapsed = formatDurationHuman(durationBetween(runningEntry.startTime, nowIso()));
  const ok = await confirm(
    t("timer.discardConfirm", { description: runningEntry.description || t("records.noDescription"), elapsed }),
    { danger: true, confirmLabel: t("timer.discard") },
  );
  if (ok) await discard();
}
