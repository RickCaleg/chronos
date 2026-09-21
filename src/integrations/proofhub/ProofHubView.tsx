import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, ChevronRight, Loader2, RefreshCw, SearchCheck, Send, Trash2 } from "lucide-react";
import { useProofHubStore, type RemoteItem } from "./useProofHubStore";
import { linksTasks } from "../../db/proofhubSettings";
import { useProjectsStore } from "../../store/useProjectsStore";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Switch } from "../../components/ui/Switch";
import { cn } from "../../lib/cn";
import { dayKey, formatDayLabel, formatDurationHuman } from "../../lib/time";
import i18n from "../../i18n";
import { checkUnits, deleteRemoteEntry, findRemoteOnly, sendUnits, useSyncPlan, type RemoteOnlyEntry } from "./sync";
import { sendWithConfirm } from "./SyncBadge";
import { applyRemoteCheck, refKey, type SyncUnit } from "./plan";
import { confirm } from "../../components/ui/ConfirmDialog";

/** How far back "check sent entries" looks — deletions in ProofHub rarely happen later than that. */
const CHECK_DAYS = 30;

/**
 * Dedicated top-level tab for ProofHub, only reachable once the plugin is
 * installed (see TopNav.tsx) — the "connect/configure" surface deserves its
 * own page rather than a cramped Settings section, and keeping it separate
 * from Settings means it's only ever mounted when actually in use.
 *
 * Every remote list here (projects/timesheets) is cached in
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
  const plan = useSyncPlan();
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [remoteOnly, setRemoteOnly] = useState<RemoteOnlyEntry[] | null>(null);

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

  const handleDisconnect = async () => {
    const ok = await confirm(t("proofhub.disconnectConfirm"), { danger: true, confirmLabel: t("proofhub.disconnect") });
    if (ok) await proofhub.disconnect();
  };

  const handleCheckSent = async () => {
    setChecking(true);
    setCheckResult(null);
    setCheckError(null);
    setRemoteOnly(null);
    try {
      const since = dayKey(new Date(Date.now() - CHECK_DAYS * 86_400_000).toISOString());
      const units = plan.units.filter((unit) => unit.reuse && unit.day >= since);
      await checkUnits(units);
      const checked = applyRemoteCheck(units, useProofHubStore.getState().remoteEntries);
      const missing = checked.filter((unit) => unit.status === "missing").length;
      const changed = checked.filter((unit) => unit.status === "changed").length;
      setCheckResult(
        missing || changed
          ? t("proofhub.checkSentFound", { missing, changed })
          : t("proofhub.checkSentNothing", { count: units.length }),
      );
      // The other direction; its failure shouldn't hide the result above.
      setRemoteOnly(await findRemoteOnly(since));
    } catch (err) {
      setCheckError(t("proofhub.checkFailure", { message: String(err) }));
    } finally {
      setChecking(false);
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
    <div className="mx-auto h-full max-w-2xl overflow-y-auto py-2 pr-1">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("proofhub.title")}</h1>
          {proofhub.subdomain && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t("proofhub.connectedTo", { subdomain: proofhub.subdomain })}
            </p>
          )}
        </div>
        {proofhub.subdomain && (
          <Button variant="ghost" size="sm" onClick={handleDisconnect}>
            {t("proofhub.disconnect")}
          </Button>
        )}
      </div>

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
        <div className="space-y-8">
          <Section
            title={t("proofhub.sendsTitle")}
            description={t("proofhub.checkSentDescription", { days: CHECK_DAYS })}
            action={
              <Button variant="secondary" size="sm" onClick={handleCheckSent} disabled={checking}>
                {checking ? <Loader2 size={13} className="animate-spin" /> : <SearchCheck size={13} />}
                {checking ? t("proofhub.checking") : t("proofhub.checkSent")}
              </Button>
            }
          >
            <PendingDays since={dayKey(new Date(Date.now() - CHECK_DAYS * 86_400_000).toISOString())} />
            {(checkResult || checkError || remoteOnly) && (
              <div className="border-t border-[var(--color-border)] p-3">
                {checkResult && <p className="text-xs text-[var(--color-text-muted)]">{checkResult}</p>}
                {checkError && <p className="text-xs text-[var(--color-danger)]">{checkError}</p>}
                {remoteOnly && (
                  <RemoteOnlyList
                    entries={remoteOnly}
                    onDeleted={(ref) => setRemoteOnly((list) => list?.filter((e) => refKey(e) !== refKey(ref)) ?? null)}
                  />
                )}
              </div>
            )}
          </Section>

          <Section
            title={t("proofhub.projectMappings")}
            description={t("proofhub.projectMappingsDescription")}
            action={
              <Button variant="ghost" size="sm" onClick={handleRefreshProjects} disabled={refreshing}>
                <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} />
                {t("proofhub.refresh")}
              </Button>
            }
          >
            {projectsError && <p className="p-3 text-xs text-[var(--color-danger)]">{projectsError}</p>}
            {!proofhub.remoteProjects && !projectsError && (
              <p className="flex items-center gap-2 p-3 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={13} className="animate-spin" />
                {t("proofhub.loadingProjects")}
              </p>
            )}
            {proofhub.remoteProjects && (
              <div className="divide-y divide-[var(--color-border)]">
                {projects
                  .filter((p) => !p.archived)
                  .map((project) => (
                    <ProjectMappingRow
                      key={project.id}
                      chronosProjectId={project.id}
                      chronosProjectName={project.name}
                      chronosProjectColor={project.color}
                      proofhubProjects={proofhub.remoteProjects!}
                    />
                  ))}
                {projects.filter((p) => !p.archived).length === 0 && (
                  <p className="p-3 text-xs text-[var(--color-text-muted)]">{t("proofhub.noProjects")}</p>
                )}
              </div>
            )}
          </Section>

          <Section title={t("proofhub.optionsTitle")}>
            <div className="flex items-center justify-between gap-4 p-3">
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
          </Section>

          <div>
            <button
              type="button"
              onClick={handleToggleDebugLog}
              aria-expanded={debugLogOpen}
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

/** A titled block of the tab: heading, one-line purpose, optional action, and its content in a card. */
function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {action}
      </div>
      <div className="rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)]">{children}</div>
    </section>
  );
}

/**
 * Everything not yet in ProofHub (or needing a resend) from `since` on, a
 * line per day — the one place to see what's left across days, instead of
 * scrolling the timer list for day headers.
 */
function PendingDays({ since }: { since: string }) {
  const { t } = useTranslation();
  const plan = useSyncPlan();
  const [sendingDay, setSendingDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byDay = new Map<string, SyncUnit[]>();
  for (const unit of plan.units) {
    if (unit.status === "synced" || unit.day < since) continue;
    if (!byDay.has(unit.day)) byDay.set(unit.day, []);
    byDay.get(unit.day)!.push(unit);
  }
  const days = Array.from(byDay.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  const all = days.flatMap(([, units]) => units);

  async function send(key: string, units: SyncUnit[]) {
    setSendingDay(key);
    setError(null);
    try {
      await sendWithConfirm(units, t);
    } catch (err) {
      setError(String(err));
    } finally {
      setSendingDay(null);
    }
  }

  async function sendAll() {
    const hours = formatDurationHuman(all.reduce((sum, unit) => sum + unit.totalSeconds, 0));
    const ok = await confirm(t("proofhub.sendAllConfirm", { count: all.length, days: days.length, hours }), {
      confirmLabel: t("proofhub.sendAll"),
    });
    if (!ok) return;
    setSendingDay("all");
    setError(null);
    const errors = await sendUnits(all);
    if (errors.length > 0) setError(t("proofhub.sendDayFailure", { count: errors.length, message: errors[0] }));
    setSendingDay(null);
  }

  if (days.length === 0) {
    return (
      <p className="flex items-center gap-2 p-3 text-xs text-[var(--color-text-muted)]">
        <Check size={13} className="text-[var(--color-accent)]" />
        {t("proofhub.nothingPending")}
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2">
        <p className="text-xs text-[var(--color-text-muted)]">
          {t("proofhub.pendingSummary", {
            count: all.length,
            hours: formatDurationHuman(all.reduce((sum, unit) => sum + unit.totalSeconds, 0)),
          })}
        </p>
        <Button variant="primary" size="sm" onClick={sendAll} disabled={sendingDay !== null}>
          {sendingDay === "all" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {t("proofhub.sendAll")}
        </Button>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {days.map(([day, units]) => {
          const problems = units.filter((u) => u.status === "missing" || u.status === "changed").length;
          return (
            <li key={day} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate capitalize">
                {formatDayLabel(units[0].entries[0].startTime, i18n.language)}
              </span>
              {problems > 0 && (
                <span className="text-xs text-[var(--color-danger)]">{t("proofhub.dayProblems", { count: problems })}</span>
              )}
              <span className="text-xs text-[var(--color-text-muted)]">
                {t("proofhub.unitsCount", { count: units.length })}
              </span>
              <span className="w-16 text-right font-mono text-xs tabular-nums">
                {formatDurationHuman(units.reduce((sum, unit) => sum + unit.totalSeconds, 0))}
              </span>
              <Button variant="ghost" size="sm" onClick={() => send(day, units)} disabled={sendingDay !== null}>
                {sendingDay === day ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {t("proofhub.send")}
              </Button>
            </li>
          );
        })}
      </ul>
      {error && <p className="border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function ProjectMappingRow({
  chronosProjectId,
  chronosProjectName,
  chronosProjectColor,
  proofhubProjects,
}: {
  chronosProjectId: string;
  chronosProjectName: string;
  chronosProjectColor: string;
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

  const applyInitialMapping = async (timesheet: RemoteItem) => {
    const proofhubProject = proofhubProjects.find((p) => p.id === selectedProjectId);
    if (!proofhubProject) return;
    await proofhub.setMapping(chronosProjectId, {
      proofhubProjectId: proofhubProject.id,
      proofhubProjectTitle: proofhubProject.title,
      timesheetId: timesheet.id,
      timesheetTitle: timesheet.title,
      defaultBillable: mapping?.defaultBillable ?? true,
      linkTasks: mapping ? linksTasks(mapping) : false,
    });
  };

  const toggleLinkTasks = async () => {
    if (!mapping) return;
    const { todolistId: _legacy, ...rest } = mapping;
    void _legacy;
    await proofhub.setMapping(chronosProjectId, { ...rest, linkTasks: !linksTasks(mapping) });
  };

  const toggleBillable = async () => {
    if (!mapping) return;
    await proofhub.setMapping(chronosProjectId, { ...mapping, defaultBillable: !mapping.defaultBillable });
  };

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ backgroundColor: chronosProjectColor }} />
          {chronosProjectName}
          {!mapping && (
            <span className="text-xs font-normal text-[var(--color-text-muted)]">— {t("proofhub.notMapped")}</span>
          )}
        </p>
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
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <Switch checked={mapping.defaultBillable} onChange={toggleBillable} label={t("proofhub.billableByDefault")} />
            <span className="text-xs text-[var(--color-text-muted)]">{t("proofhub.billableByDefault")}</span>
          </div>
          <div className="flex items-start gap-2">
            <Switch checked={linksTasks(mapping)} onChange={toggleLinkTasks} label={t("proofhub.linkTasks")} />
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">{t("proofhub.linkTasks")}</p>
              {linksTasks(mapping) && <p className="text-xs text-[var(--color-text-muted)]">{t("proofhub.linkTasksHint")}</p>}
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

/**
 * Your ProofHub entries (from the last check) that no Chronos entry was
 * sent as — logged by hand there, or left over from an old send. Each can
 * be deleted in ProofHub, e.g. a duplicate counting hours twice.
 */
function RemoteOnlyList({
  entries,
  onDeleted,
}: {
  entries: RemoteOnlyEntry[];
  onDeleted: (entry: RemoteOnlyEntry) => void;
}) {
  const { t } = useTranslation();
  const { projects } = useProjectsStore();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (entries.length === 0) {
    return <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("proofhub.remoteOnlyNone")}</p>;
  }

  async function handleDelete(entry: RemoteOnlyEntry) {
    const hours = formatDurationHuman(entry.minutes * 60);
    const ok = await confirm(t("proofhub.remoteOnlyDeleteConfirm", { date: entry.date, hours }), {
      danger: true,
      confirmLabel: t("proofhub.remoteOnlyDelete"),
    });
    if (!ok) return;
    setDeleting(entry.timeId);
    setError(null);
    try {
      await deleteRemoteEntry(entry);
      onDeleted(entry);
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium">{t("proofhub.remoteOnlyTitle", { count: entries.length })}</p>
      <p className="mb-2 text-xs text-[var(--color-text-muted)]">{t("proofhub.remoteOnlyHint")}</p>
      <ul className="divide-y divide-[var(--color-border)] rounded-[2px] border border-[var(--color-border)]">
        {entries.map((entry) => {
          const project = projects.find((p) => p.id === entry.chronosProjectId);
          return (
            <li key={refKey(entry)} className="flex items-center gap-3 px-2 py-1.5 text-xs">
              <span className="w-20 shrink-0 tabular-nums text-[var(--color-text-muted)]">{entry.date}</span>
              <span className="w-14 shrink-0 text-right font-mono tabular-nums">
                {formatDurationHuman(entry.minutes * 60)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {entry.description || (
                  <span className="italic text-[var(--color-text-muted)]">
                    {entry.taskId ? t("proofhub.remoteOnlyOnTask") : t("records.noDescription")}
                  </span>
                )}
              </span>
              {project && (
                <span className="flex shrink-0 items-center gap-1.5 text-[var(--color-text-muted)]">
                  <span className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: project.color }} />
                  <span className="max-w-[8rem] truncate">{project.name}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => handleDelete(entry)}
                disabled={deleting !== null}
                aria-label={t("proofhub.remoteOnlyDelete")}
                title={t("proofhub.remoteOnlyDelete")}
                className="shrink-0 rounded-[2px] p-1 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] hover:text-[var(--color-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)] disabled:opacity-50"
              >
                {deleting === entry.timeId ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
