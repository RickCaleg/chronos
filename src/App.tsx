import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TopNav, type View } from "./components/TopNav";
import { CommandPalette } from "./components/CommandPalette";
import { TimerBar } from "./components/timer/TimerBar";
import { RecordsView } from "./components/records/RecordsView";
import { ProjectsView } from "./components/projects/ProjectsView";
import { SettingsView } from "./components/settings/SettingsView";
import { useProjectsStore } from "./store/useProjectsStore";
import { useEntriesStore } from "./store/useEntriesStore";
import { useTagsStore } from "./store/useTagsStore";
import { useUpdaterStore } from "./store/useUpdaterStore";
import { useAppSettingsStore } from "./store/useAppSettingsStore";
import { runAutoBackupIfDue } from "./lib/autoBackup";
import { nowIso } from "./lib/time";

/** How often to re-check whether an auto-backup is due while the app stays open. */
const AUTO_BACKUP_CHECK_INTERVAL_MS = 15 * 60 * 1000;

function App() {
  const [view, setView] = useState<View>("timer");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const loadProjects = useProjectsStore((s) => s.load);
  const loadEntries = useEntriesStore((s) => s.load);
  const loadTags = useTagsStore((s) => s.load);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const entriesLoaded = useEntriesStore((s) => s.loaded);
  const loaded = projectsLoaded && entriesLoaded;

  useEffect(() => {
    loadProjects();
    loadEntries();
    loadTags();
    useUpdaterStore.getState().checkForUpdates();
  }, [loadProjects, loadEntries, loadTags]);

  useEffect(() => {
    runAutoBackupIfDue();
    const id = setInterval(runAutoBackupIfDue, AUTO_BACKUP_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    invoke("register_global_shortcut", { accelerator: useAppSettingsStore.getState().globalShortcut }).catch(() => {
      // Some other app may already own this combo, or the platform refused
      // it — not fatal, the in-app shortcuts and tray menu still work.
    });

    const unlistenPromise = listen("toggle-timer-shortcut", () => {
      const { runningEntry, start, stop } = useEntriesStore.getState();
      if (runningEntry) {
        stop();
      } else {
        start({ description: "", taskNumber: null, projectId: null, startTime: nowIso() });
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey) return;
      if (e.key === "1") setView("timer");
      else if (e.key === "2") setView("projects");
      else if (e.key === "3") setView("settings");
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <TopNav current={view} onChange={setView} />

      <main className="flex-1 overflow-hidden p-4">
        {!loaded ? null : view === "timer" ? (
          <div className="flex h-full flex-col gap-4">
            <TimerBar />
            <div className="min-h-0 flex-1">
              <RecordsView />
            </div>
          </div>
        ) : view === "projects" ? (
          <ProjectsView />
        ) : (
          <SettingsView />
        )}
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setView} />
    </div>
  );
}

export default App;
