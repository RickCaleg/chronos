import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  ClockPlus,
  Download,
  FolderKanban,
  FolderPlus,
  Play,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import type { View } from "./TopNav";
import { useEntriesStore } from "../store/useEntriesStore";
import { useUpdaterStore } from "../store/useUpdaterStore";
import { platform } from "@platform";
import { exportJsonBackup, importJsonBackup } from "../lib/exportImport";
import { nowIso } from "../lib/time";
import { discardRunningTimer } from "./timer/discardTimer";
import { useManualEntryStore } from "./timer/ManualEntry";
import { cn } from "../lib/cn";

interface Command {
  id: string;
  labelKey: string;
  icon: typeof Clock;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
}

export function CommandPalette({ open, onClose, onNavigate }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const runningEntry = useEntriesStore((s) => s.runningEntry);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (runningEntry) {
      list.push({
        id: "stop-timer",
        labelKey: "palette.stopTimer",
        icon: Square,
        run: () => useEntriesStore.getState().stop(),
      });
      list.push({
        id: "discard-timer",
        labelKey: "palette.discardTimer",
        icon: Trash2,
        run: () => discardRunningTimer(t),
      });
    } else {
      list.push({
        id: "start-timer",
        labelKey: "palette.startTimer",
        icon: Play,
        run: () =>
          useEntriesStore
            .getState()
            .start({ description: "", taskNumber: null, projectId: null, startTime: nowIso() }),
      });
    }
    list.push(
      {
        id: "manual-entry",
        labelKey: "palette.manualEntry",
        icon: ClockPlus,
        run: () => {
          onNavigate("timer");
          useManualEntryStore.getState().setOpen(true);
        },
      },
      { id: "go-timer", labelKey: "palette.goTimer", icon: Clock, run: () => onNavigate("timer") },
      { id: "go-projects", labelKey: "palette.goProjects", icon: FolderKanban, run: () => onNavigate("projects") },
      { id: "new-project", labelKey: "palette.newProject", icon: FolderPlus, run: () => onNavigate("projects") },
      { id: "go-settings", labelKey: "palette.goSettings", icon: Settings, run: () => onNavigate("settings") },
      { id: "export-backup", labelKey: "palette.exportBackup", icon: Download, run: () => void exportJsonBackup() },
      { id: "import-backup", labelKey: "palette.importBackup", icon: Upload, run: () => void importJsonBackup() },
    );
    if (platform.updater) {
      list.push({
        id: "check-updates",
        labelKey: "palette.checkUpdates",
        icon: RefreshCw,
        run: () => useUpdaterStore.getState().checkForUpdates(),
      });
    }
    return list;
  }, [runningEntry, onNavigate, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => t(c.labelKey).toLowerCase().includes(q));
  }, [commands, query, t]);

  useEffect(() => {
    setHighlight(0);
  }, [filtered.length, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  function execute(command: Command) {
    command.run();
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (filtered.length ? (h + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (filtered.length ? (h - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) execute(filtered[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("palette.placeholder")}
          className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">{t("palette.empty")}</p>
          ) : (
            filtered.map((command, i) => (
              <button
                key={command.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => execute(command)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[2px] px-3 py-2 text-left text-sm outline-none",
                  i === highlight ? "bg-[var(--color-surface-hover)] text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
                )}
              >
                <command.icon size={15} className="shrink-0" />
                {t(command.labelKey)}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
