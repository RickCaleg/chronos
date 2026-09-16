import { useTranslation } from "react-i18next";
import { Clock, FolderKanban, Settings } from "lucide-react";
import { cn } from "../lib/cn";
import { useUpdaterStore } from "../store/useUpdaterStore";

export type View = "timer" | "projects" | "settings";

const ITEMS: { view: View; icon: typeof Clock; labelKey: string }[] = [
  { view: "timer", icon: Clock, labelKey: "nav.timer" },
  { view: "projects", icon: FolderKanban, labelKey: "nav.projects" },
  { view: "settings", icon: Settings, labelKey: "nav.settings" },
];

export function TopNav({ current, onChange }: { current: View; onChange: (v: View) => void }) {
  const { t } = useTranslation();
  const updaterStatus = useUpdaterStore((s) => s.status);
  const updateAvailable = updaterStatus === "available" || updaterStatus === "ready";

  return (
    <nav className="flex items-center gap-1 border-b border-[var(--color-border)] px-4 pt-3">
      {ITEMS.map(({ view, icon: Icon, labelKey }) => (
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
          {view === "settings" && updateAvailable && (
            <span className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          )}
        </button>
      ))}
    </nav>
  );
}
