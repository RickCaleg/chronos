import { useEffect, useState } from "react";
import { TopNav, type View } from "./components/TopNav";
import { TimerBar } from "./components/timer/TimerBar";
import { RecordsView } from "./components/records/RecordsView";
import { ProjectsView } from "./components/projects/ProjectsView";
import { SettingsView } from "./components/settings/SettingsView";
import { useProjectsStore } from "./store/useProjectsStore";
import { useEntriesStore } from "./store/useEntriesStore";
import { useUpdaterStore } from "./store/useUpdaterStore";

function App() {
  const [view, setView] = useState<View>("timer");
  const loadProjects = useProjectsStore((s) => s.load);
  const loadEntries = useEntriesStore((s) => s.load);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const entriesLoaded = useEntriesStore((s) => s.loaded);
  const loaded = projectsLoaded && entriesLoaded;

  useEffect(() => {
    loadProjects();
    loadEntries();
    useUpdaterStore.getState().checkForUpdates();
  }, [loadProjects, loadEntries]);

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
    </div>
  );
}

export default App;
