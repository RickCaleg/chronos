import { useTranslation } from "react-i18next";
import { Clock, FolderKanban, Plug, Settings } from "lucide-react";
import { cn } from "../lib/cn";
import { useUpdaterStore } from "../store/useUpdaterStore";
import { useProofHubStore } from "../integrations/proofhub/useProofHubStore";
import { useSyncPlan } from "../integrations/proofhub/sync";
import { dayKey } from "../lib/time";

export type View = "timer" | "projects" | "settings" | "proofhub";

const BASE_ITEMS: { view: View; icon: typeof Clock; labelKey: string }[] = [
  { view: "timer", icon: Clock, labelKey: "nav.timer" },
  { view: "projects", icon: FolderKanban, labelKey: "nav.projects" },
  { view: "settings", icon: Settings, labelKey: "nav.settings" },
];

export function TopNav({ current, onChange }: { current: View; onChange: (v: View) => void }) {
  const { t } = useTranslation();
  const updaterStatus = useUpdaterStore((s) => s.status);
  const updateAvailable = updaterStatus === "available" || updaterStatus === "ready";
  // Only shown once the plugin is installed — see docs/proofhub-integration.md
  // section 6 on keeping this invisible until the user opts in.
  const proofhubInstalled = useProofHubStore((s) => s.installed);
  // What's left to send (or resend) from the last 30 days, the same window
  // the ProofHub tab lists — visible from every screen.
  const plan = useSyncPlan();
  const since = dayKey(new Date(Date.now() - 30 * 86_400_000).toISOString());
  const proofhubPending = plan.units.filter((u) => u.status !== "synced" && u.day >= since).length;
  const items = proofhubInstalled
    ? [...BASE_ITEMS, { view: "proofhub" as View, icon: Plug, labelKey: "nav.proofhub" }]
    : BASE_ITEMS;

  return (
    <nav className="flex items-center gap-1 border-b border-[var(--color-border)] px-4 pt-3">
      {items.map(({ view, icon: Icon, labelKey }) => (
        <button
          key={view}
          onClick={() => onChange(view)}
          className={cn(
            "relative flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors outline-none focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]",
            current === view
              ? "border-[var(--color-accent)] text-[var(--color-text)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          <Icon size={15} />
          <span className="hidden sm:inline">{t(labelKey)}</span>
          {view === "proofhub" && proofhubPending > 0 && (
            <span
              className="rounded-full bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--color-accent)]"
              title={t("proofhub.pendingSummaryShort", { count: proofhubPending })}
            >
              {proofhubPending}
            </span>
          )}
          {view === "settings" && updateAvailable && (
            <span className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          )}
        </button>
      ))}
    </nav>
  );
}
