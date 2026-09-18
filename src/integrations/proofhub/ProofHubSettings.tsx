import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Loader2, Plug, Trash2 } from "lucide-react";
import { useProofHubStore } from "./useProofHubStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Switch } from "../../components/ui/Switch";
import { cn } from "../../lib/cn";

interface RemoteItem {
  id: string;
  title: string;
}

/**
 * Everything here is ProofHub-specific and lazy-loaded from Settings — see
 * docs/proofhub-integration.md section 6. The generic shell that decides
 * whether to even mount this component lives in SettingsView.tsx.
 */
export function ProofHubSettings() {
  const { t } = useTranslation();
  const proofhub = useProofHubStore();
  const { projects } = useProjectsStore();
  const [subdomainInput, setSubdomainInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [proofhubProjects, setProofhubProjects] = useState<RemoteItem[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  useEffect(() => {
    proofhub.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (proofhub.subdomain && proofhubProjects === null) {
      proofhub
        .call<RemoteItem[]>("list-projects")
        .then(setProofhubProjects)
        .catch((err) => setProjectsError(String(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proofhub.subdomain]);

  const handleInstall = async () => {
    setInstallError(null);
    try {
      await proofhub.install();
    } catch (err) {
      setInstallError(String(err));
    }
  };

  const handleConnect = async () => {
    setConnectError(null);
    try {
      await proofhub.connect(subdomainInput.trim(), apiKeyInput.trim());
      setApiKeyInput("");
    } catch (err) {
      setConnectError(String(err));
    }
  };

  if (!proofhub.loaded) return null;

  return (
    <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">{t("proofhub.title")}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t("proofhub.description")}</p>
        </div>
        {proofhub.installed && (
          <Button variant="ghost" size="sm" onClick={() => proofhub.uninstall()} disabled={proofhub.busy}>
            <Trash2 size={14} />
            {t("proofhub.uninstall")}
          </Button>
        )}
      </div>

      {!proofhub.installed && (
        <div className="border-t border-[var(--color-border)] pt-4">
          <Button variant="primary" size="sm" onClick={handleInstall} disabled={proofhub.busy}>
            {proofhub.busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            {t("proofhub.install")}
          </Button>
          {installError && <p className="mt-2 text-xs text-[var(--color-danger)]">{installError}</p>}
        </div>
      )}

      {proofhub.installed && !proofhub.subdomain && (
        <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
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
      )}

      {proofhub.installed && proofhub.subdomain && (
        <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--color-text-muted)]">
              {t("proofhub.connectedTo", { subdomain: proofhub.subdomain })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => proofhub.disconnect()}>
              {t("proofhub.disconnect")}
            </Button>
          </div>

          {projectsError && <p className="text-xs text-[var(--color-danger)]">{projectsError}</p>}

          {proofhubProjects && (
            <div className="space-y-3">
              {projects
                .filter((p) => !p.archived)
                .map((project) => (
                  <ProjectMappingRow
                    key={project.id}
                    chronosProjectId={project.id}
                    chronosProjectName={project.name}
                    proofhubProjects={proofhubProjects}
                  />
                ))}
              {projects.filter((p) => !p.archived).length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">{t("proofhub.noProjects")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
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
  const [timesheets, setTimesheets] = useState<RemoteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [taskLinkOpen, setTaskLinkOpen] = useState(Boolean(mapping?.todolistId));
  const [todolists, setTodolists] = useState<RemoteItem[] | null>(null);

  useEffect(() => {
    if (!selectedProjectId) {
      setTimesheets(null);
      return;
    }
    proofhub
      .call<RemoteItem[]>("list-timesheets", { projectId: selectedProjectId })
      .then(setTimesheets)
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  useEffect(() => {
    if (!taskLinkOpen || !selectedProjectId) {
      setTodolists(null);
      return;
    }
    proofhub
      .call<RemoteItem[]>("list-todolists", { projectId: selectedProjectId })
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
