import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useProofHubStore, type RemoteItem } from "./useProofHubStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Switch } from "../../components/ui/Switch";
import { cn } from "../../lib/cn";

/**
 * Dedicated top-level tab for ProofHub, only reachable once the plugin is
 * installed (see TopNav.tsx) — the "connect/configure" surface deserves its
 * own page rather than a cramped Settings section, and keeping it separate
 * from Settings means it's only ever mounted when actually in use.
 *
 * Every remote list here (projects/timesheets/todolists) is cached in
 * useProofHubStore rather than refetched on mount: each fetch spawns the
 * plugin binary, and refetching every time this tab is opened was both
 * slow and, on Windows, visibly flashed a console window per spawn.
 */
export function ProofHubView() {
  const { t } = useTranslation();
  const proofhub = useProofHubStore();
  const { projects } = useProjectsStore();
  const [subdomainInput, setSubdomainInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [debugLogOpen, setDebugLogOpen] = useState(false);
  const [debugLog, setDebugLog] = useState("");
  const [debugCopied, setDebugCopied] = useState(false);

  useEffect(() => {
    if (proofhub.subdomain && !proofhub.remoteProjects) {
      proofhub.loadRemoteProjects().catch((err) => setProjectsError(String(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proofhub.subdomain]);

  const handleConnect = async () => {
    setConnectError(null);
    try {
      await proofhub.connect(subdomainInput.trim(), apiKeyInput.trim());
      setApiKeyInput("");
    } catch (err) {
      setConnectError(String(err));
    }
  };

  const handleRefreshProjects = async () => {
    setRefreshing(true);
    setProjectsError(null);
    try {
      await proofhub.loadRemoteProjects(true);
    } catch (err) {
      setProjectsError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleDebugLog = async () => {
    const opening = !debugLogOpen;
    setDebugLogOpen(opening);
    if (opening) {
      setDebugLog(await invoke<string>("proofhub_read_debug_log"));
    }
  };

  const handleCopyDebugLog = async () => {
    await writeText(debugLog);
    setDebugCopied(true);
    setTimeout(() => setDebugCopied(false), 1500);
  };

  const handleClearDebugLog = async () => {
    await invoke("proofhub_clear_debug_log");
    setDebugLog("");
  };

  return (
    <div className="mx-auto h-full max-w-xl overflow-y-auto py-2">
      <h1 className="mb-4 text-lg font-semibold">{t("proofhub.title")}</h1>

      {!proofhub.subdomain && (
        <section className="rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--color-text-muted)]">{t("proofhub.subdomain")}</p>
              <Input value={subdomainInput} onChange={(e) => setSubdomainInput(e.target.value)} placeholder="acmecorp" />
            </div>
            <div>
              <p className="mb-0.5 text-xs font-medium text-[var(--color-text-muted)]">{t("proofhub.apiKey")}</p>
              <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">{t("proofhub.apiKeyHint")}</p>
              <Input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={t("proofhub.apiKeyPlaceholder")}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConnect}
              disabled={proofhub.busy || !subdomainInput.trim() || !apiKeyInput.trim()}
            >
              {proofhub.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {t("proofhub.connect")}
            </Button>
            {connectError && <p className="text-xs text-[var(--color-danger)]">{connectError}</p>}
          </div>
        </section>
      )}

      {proofhub.subdomain && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--color-text-muted)]">
              {t("proofhub.connectedTo", { subdomain: proofhub.subdomain })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => proofhub.disconnect()}>
              {t("proofhub.disconnect")}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <p className="text-sm">{t("proofhub.groupPushesByDay")}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t("proofhub.groupPushesByDayDescription")}</p>
            </div>
            <Switch
              checked={proofhub.groupPushesByDay}
              onChange={proofhub.setGroupPushesByDay}
              label={t("proofhub.groupPushesByDay")}
            />
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">{t("proofhub.projectMappings")}</h2>
            <Button variant="ghost" size="sm" onClick={handleRefreshProjects} disabled={refreshing}>
              <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} />
              {t("proofhub.refresh")}
            </Button>
          </div>

          {projectsError && <p className="text-xs text-[var(--color-danger)]">{projectsError}</p>}

          {proofhub.remoteProjects && (
            <div className="space-y-3">
              {projects
                .filter((p) => !p.archived)
                .map((project) => (
                  <ProjectMappingRow
                    key={project.id}
                    chronosProjectId={project.id}
                    chronosProjectName={project.name}
                    proofhubProjects={proofhub.remoteProjects!}
                  />
                ))}
              {projects.filter((p) => !p.archived).length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">{t("proofhub.noProjects")}</p>
              )}
            </div>
          )}

          <div className="border-t border-[var(--color-border)] pt-3">
            <button
              type="button"
              onClick={handleToggleDebugLog}
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            >
              <ChevronRight size={12} className={cn("transition-transform", debugLogOpen && "rotate-90")} />
              {t("proofhub.debugLog")}
            </button>

            {debugLogOpen && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-[var(--color-text-muted)]">{t("proofhub.debugLogHint")}</p>
                <pre className="max-h-64 overflow-auto rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[11px] whitespace-pre-wrap break-all text-[var(--color-text-muted)]">
                  {debugLog || t("proofhub.debugLogEmpty")}
                </pre>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCopyDebugLog} disabled={!debugLog}>
                    {debugCopied ? <Check size={13} /> : null}
                    {t("proofhub.debugLogCopy")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleClearDebugLog} disabled={!debugLog}>
                    {t("proofhub.debugLogClear")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectMappingRow({
  chronosProjectId,
  chronosProjectName,
  proofhubProjects,
}: {
  chronosProjectId: string;
  chronosProjectName: string;
  proofhubProjects: RemoteItem[];
}) {
  const { t } = useTranslation();
  const proofhub = useProofHubStore();
  const mapping = proofhub.projectMap[chronosProjectId];
  const [selectedProjectId, setSelectedProjectId] = useState(mapping?.proofhubProjectId ?? "");
  const [timesheets, setTimesheets] = useState<RemoteItem[] | null>(
    selectedProjectId ? proofhub.timesheetsByProject[selectedProjectId] ?? null : null,
  );
  const [error, setError] = useState<string | null>(null);

  const [taskLinkOpen, setTaskLinkOpen] = useState(Boolean(mapping?.todolistId));
  const [todolists, setTodolists] = useState<RemoteItem[] | null>(
    selectedProjectId ? proofhub.todolistsByProject[selectedProjectId] ?? null : null,
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setTimesheets(null);
      return;
    }
    proofhub
      .loadTimesheets(selectedProjectId)
      .then(setTimesheets)
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  useEffect(() => {
    if (!taskLinkOpen || !selectedProjectId) return;
    proofhub
      .loadTodolists(selectedProjectId)
      .then(setTodolists)
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskLinkOpen, selectedProjectId]);

  const applyInitialMapping = async (timesheet: RemoteItem) => {
    const proofhubProject = proofhubProjects.find((p) => p.id === selectedProjectId);
    if (!proofhubProject) return;
    await proofhub.setMapping(chronosProjectId, {
      proofhubProjectId: proofhubProject.id,
      proofhubProjectTitle: proofhubProject.title,
      timesheetId: timesheet.id,
      timesheetTitle: timesheet.title,
      defaultBillable: mapping?.defaultBillable ?? true,
      ...(mapping?.todolistId ? { todolistId: mapping.todolistId } : {}),
    });
  };

  const handleSelectTodolist = (todolistId: string) => {
    if (!mapping) return;
    if (todolistId) {
      proofhub.setMapping(chronosProjectId, { ...mapping, todolistId });
    } else {
      const { todolistId: _drop, ...rest } = mapping;
      void _drop;
      proofhub.setMapping(chronosProjectId, rest);
    }
  };

  const toggleBillable = async () => {
    if (!mapping) return;
    await proofhub.setMapping(chronosProjectId, { ...mapping, defaultBillable: !mapping.defaultBillable });
  };

  return (
    <div className="rounded-[2px] border border-[var(--color-border)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{chronosProjectName}</p>
        {mapping && (
          <button
            type="button"
            className="text-xs text-[var(--color-text-muted)] outline-none hover:text-[var(--color-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            onClick={() => proofhub.removeMapping(chronosProjectId)}
          >
            {t("proofhub.unmap")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
          <option value="">{t("proofhub.selectProject")}</option>
          {proofhubProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </Select>
        <Select
          value={mapping?.timesheetId ?? ""}
          onChange={(e) => {
            const timesheet = timesheets?.find((ts) => ts.id === e.target.value);
            if (timesheet) applyInitialMapping(timesheet);
          }}
          disabled={!selectedProjectId || !timesheets}
        >
          <option value="">{t("proofhub.selectTimesheet")}</option>
          {(timesheets ?? []).map((ts) => (
            <option key={ts.id} value={ts.id}>
              {ts.title}
            </option>
          ))}
        </Select>
      </div>
      {mapping && (
        <div className="mt-2 flex items-center gap-2">
          <Switch checked={mapping.defaultBillable} onChange={toggleBillable} label={t("proofhub.billableByDefault")} />
          <span className="text-xs text-[var(--color-text-muted)]">{t("proofhub.billableByDefault")}</span>
        </div>
      )}

      {mapping && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <button
            type="button"
            onClick={() => setTaskLinkOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          >
            <ChevronRight size={12} className={cn("transition-transform", taskLinkOpen && "rotate-90")} />
            {mapping.todolistId ? t("proofhub.taskLinked") : t("proofhub.linkTask")}
          </button>
          {mapping.todolistId && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("proofhub.taskLinkHint")}</p>
          )}

          {taskLinkOpen && (
            <div className="mt-2">
              <Select value={mapping.todolistId ?? ""} onChange={(e) => handleSelectTodolist(e.target.value)} disabled={!todolists}>
                <option value="">{t("proofhub.selectTodolist")}</option>
                {(todolists ?? []).map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
