import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, FolderOpen, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { confirm } from "../ui/ConfirmDialog";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useThemeStore, type ThemePreference } from "../../store/useThemeStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useAppSettingsStore, DEFAULT_GLOBAL_SHORTCUT } from "../../store/useAppSettingsStore";
import { useAutoBackupStore } from "../../store/useAutoBackupStore";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Switch } from "../ui/Switch";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import {
  exportEntriesCsv,
  exportJsonBackup,
  importClockifyCsv,
  importEntriesCsv,
  importJsonBackup,
  resetAllData,
} from "../../lib/exportImport";
import { performAutoBackup } from "../../lib/autoBackup";
import { formatDayLabel, formatTimeShort } from "../../lib/time";
import { cn } from "../../lib/cn";

// Lazy-loaded so its code (and the ProofHub-specific labels/logic inside
// it) isn't on the JS execution path for a user who never opens this
// section — see docs/proofhub-integration.md section 6.
const ProofHubSettings = lazy(() =>
  import("../../integrations/proofhub/ProofHubSettings").then((m) => ({ default: m.ProofHubSettings })),
);

const AUTO_BACKUP_INTERVAL_OPTIONS: { hours: number; labelKey: string }[] = [
  { hours: 1, labelKey: "settings.autoBackupHourly" },
  { hours: 6, labelKey: "settings.autoBackupEvery6h" },
  { hours: 24, labelKey: "settings.autoBackupDaily" },
  { hours: 168, labelKey: "settings.autoBackupWeekly" },
];

const AUTO_BACKUP_RETENTION_PRESETS = [1, 5, 10, 20, 50];

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
};

const BASE_THEME_OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme, omarchyAvailable } = useThemeStore();
  const { groupSimilarEntries, setGroupSimilarEntries, globalShortcut, setGlobalShortcut } = useAppSettingsStore();
  const autoBackup = useAutoBackupStore();
  const updater = useUpdaterStore();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [retentionInput, setRetentionInput] = useState(String(autoBackup.retentionCount));
  const [autostartOn, setAutostartOn] = useState(false);
  const [shortcutInput, setShortcutInput] = useState(globalShortcut);
  const [shortcutStatus, setShortcutStatus] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion);
    isAutostartEnabled().then(setAutostartOn).catch(() => {});
    updater.checkSelfUpdateSupport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleAutostart(value: boolean) {
    try {
      if (value) await enableAutostart();
      else await disableAutostart();
      setAutostartOn(value);
    } catch (err) {
      setStatus(t("settings.operationFailed", { error: String(err) }));
    }
  }

  async function handleApplyShortcut() {
    const accelerator = shortcutInput.trim();
    try {
      await invoke("register_global_shortcut", { accelerator });
      setGlobalShortcut(accelerator);
      setShortcutStatus(t("settings.shortcutSaved"));
    } catch {
      setShortcutStatus(t("settings.shortcutInvalid"));
    }
  }

  useEffect(() => {
    setRetentionInput(String(autoBackup.retentionCount));
  }, [autoBackup.retentionCount]);

  function commitRetentionInput() {
    const parsed = Number(retentionInput);
    if (Number.isFinite(parsed) && parsed >= 1) {
      autoBackup.setRetentionCount(parsed);
    } else {
      setRetentionInput(String(autoBackup.retentionCount));
    }
  }

  async function handleChooseBackupFolder() {
    const path = await openDialog({ directory: true, multiple: false });
    if (!path || Array.isArray(path)) return;
    autoBackup.setFolder(path);
  }

  async function handleBackupNow() {
    if (!autoBackup.folder) {
      setBackupStatus(t("settings.autoBackupNeedsFolder"));
      return;
    }
    setBackupStatus(null);
    setBackingUp(true);
    try {
      await performAutoBackup();
      setBackupStatus(t("settings.exportSuccess"));
    } catch (err) {
      setBackupStatus(t("settings.operationFailed", { error: String(err) }));
    } finally {
      setBackingUp(false);
    }
  }

  const themeOptions = omarchyAvailable
    ? [...BASE_THEME_OPTIONS, { value: "omarchy" as const, labelKey: "settings.themeOmarchy" }]
    : BASE_THEME_OPTIONS;

  async function run(action: () => Promise<{ imported: number } | boolean | void>, successKey: string) {
    setStatus(null);
    try {
      const result = await action();
      await Promise.all([useProjectsStore.getState().load(), useEntriesStore.getState().load()]);
      if (result && typeof result === "object" && "imported" in result) {
        setStatus(t("settings.importSuccessCount", { count: result.imported }));
      } else {
        setStatus(t(successKey));
      }
    } catch (err) {
      setStatus(t("settings.operationFailed", { error: String(err) }));
    }
  }

  async function handleReset() {
    const confirmed = await confirm(t("settings.resetConfirm"), { danger: true, confirmLabel: t("settings.resetAll") });
    if (!confirmed) return;
    await run(async () => {
      await resetAllData();
    }, "settings.resetSuccess");
  }

  return (
    <div className="mx-auto h-full max-w-xl overflow-y-auto py-2">
      <h1 className="mb-4 text-lg font-semibold">{t("settings.title")}</h1>

      <GroupHeading>{t("settings.groupAppearance")}</GroupHeading>
      <section className="mb-6 divide-y divide-[var(--color-border)] rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">{t("settings.language")}</p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_LANGUAGES.map((lng) => (
              <button
                key={lng}
                onClick={() => i18n.changeLanguage(lng)}
                className={cn(
                  "rounded-[2px] border px-3 py-1.5 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
                  i18n.language === lng
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]",
                )}
              >
                {LANGUAGE_LABELS[lng]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">{t("settings.theme")}</p>
          <div className="flex flex-wrap gap-2">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "rounded-[2px] border px-3 py-1.5 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
                  theme === opt.value
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]",
                )}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm">{t("settings.groupSimilar")}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{t("settings.groupSimilarDescription")}</p>
          </div>
          <Switch checked={groupSimilarEntries} onChange={setGroupSimilarEntries} label={t("settings.groupSimilar")} />
        </div>
      </section>

      <GroupHeading>{t("settings.groupSystem")}</GroupHeading>
      <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 text-sm font-medium">{t("settings.startupTitle")}</h2>

        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">{t("settings.startWithSystem")}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{t("settings.startWithSystemDescription")}</p>
          </div>
          <Switch checked={autostartOn} onChange={handleToggleAutostart} label={t("settings.startWithSystem")} />
        </div>

        <div>
          <p className="mb-0.5 text-xs font-medium text-[var(--color-text-muted)]">{t("settings.globalShortcut")}</p>
          <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">{t("settings.globalShortcutDescription")}</p>
          <div className="flex items-center gap-2">
            <Input
              value={shortcutInput}
              onChange={(e) => setShortcutInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApplyShortcut()}
              placeholder={DEFAULT_GLOBAL_SHORTCUT}
              className="max-w-[220px] font-mono"
            />
            <Button variant="secondary" size="sm" onClick={handleApplyShortcut} disabled={shortcutInput.trim() === ""}>
              {t("settings.applyShortcut")}
            </Button>
          </div>
          {shortcutStatus && <p className="mt-2 text-sm">{shortcutStatus}</p>}
        </div>
      </section>

      <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("settings.updates")}</h2>
          {appVersion && (
            <span className="text-xs text-[var(--color-text-muted)]">{t("settings.currentVersion", { version: appVersion })}</span>
          )}
        </div>

        {updater.status === "available" && (
          <div className="mb-3 rounded-[2px] border border-[var(--color-accent)] bg-[var(--color-bg)] p-3">
            <p className="text-sm font-medium">{t("settings.updateAvailable", { version: updater.version })}</p>
            {updater.body && <p className="mt-1 whitespace-pre-line text-xs text-[var(--color-text-muted)]">{updater.body}</p>}
            {updater.selfUpdateSupported === false ? (
              <div className="mt-2">
                <p className="mb-2 text-xs text-[var(--color-text-muted)]">{t("settings.selfUpdateUnsupported")}</p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openUrl("https://github.com/RickCaleg/chronos/releases/latest")}
                >
                  <Download size={14} />
                  {t("settings.openReleasesPage")}
                </Button>
              </div>
            ) : (
              <Button variant="primary" size="sm" className="mt-2" onClick={updater.downloadAndInstall}>
                <Download size={14} />
                {t("settings.downloadInstall")}
              </Button>
            )}
          </div>
        )}

        {updater.status === "downloading" && (
          <div className="mb-3">
            <p className="mb-1 text-sm">{t("settings.downloading", { progress: updater.progress })}</p>
            <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-[var(--color-bg)]">
              <div
                className="h-full bg-[var(--color-accent)] transition-all"
                style={{ width: `${updater.progress}%` }}
              />
            </div>
          </div>
        )}

        {updater.status === "ready" && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-[2px] border border-[var(--color-accent)] bg-[var(--color-bg)] p-3">
            <p className="text-sm">{t("settings.updateReady")}</p>
            <Button variant="primary" size="sm" onClick={updater.restart}>
              {t("settings.restartNow")}
            </Button>
          </div>
        )}

        {updater.status === "up-to-date" && (
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">{t("settings.upToDate")}</p>
        )}

        {updater.status === "error" && (
          <p className="mb-3 text-xs text-[var(--color-danger)]">
            {t(updater.errorPhase === "install" ? "settings.updateInstallFailed" : "settings.updateCheckFailed", {
              error: updater.error,
            })}
          </p>
        )}

        {updater.status !== "ready" && (
          <Button
            variant="secondary"
            size="sm"
            onClick={updater.checkForUpdates}
            disabled={updater.status === "checking" || updater.status === "downloading"}
          >
            <RefreshCw size={14} className={updater.status === "checking" ? "animate-spin" : undefined} />
            {updater.status === "checking" ? t("settings.checkingForUpdates") : t("settings.checkForUpdates")}
          </Button>
        )}
      </section>

      <GroupHeading>{t("settings.groupIntegrations")}</GroupHeading>
      <Suspense fallback={null}>
        <ProofHubSettings />
      </Suspense>

      <GroupHeading>{t("settings.groupData")}</GroupHeading>
      <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-1 text-sm font-medium">{t("settings.dataTitle")}</h2>
        <p className="mb-4 text-xs text-[var(--color-text-muted)]">{t("settings.dataDescription")}</p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => run(exportJsonBackup, "settings.exportSuccess")}>
            <Download size={15} />
            {t("settings.exportJson")}
          </Button>
          <Button variant="secondary" onClick={() => run(importJsonBackup, "settings.importSuccess")}>
            <Upload size={15} />
            {t("settings.importJson")}
          </Button>
          <Button variant="secondary" onClick={() => run(exportEntriesCsv, "settings.exportSuccess")}>
            <Download size={15} />
            {t("settings.exportCsv")}
          </Button>
          <Button variant="secondary" onClick={() => run(importEntriesCsv, "settings.importSuccess")}>
            <Upload size={15} />
            {t("settings.importCsv")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => run(importClockifyCsv, "settings.importSuccess")}
            className="sm:col-span-2"
          >
            <FileSpreadsheet size={15} />
            {t("settings.importClockify")}
          </Button>
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">{t("settings.importJsonWarning")}</p>

        {status && <p className="mt-3 text-sm">{status}</p>}
      </section>

      <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">{t("settings.autoBackupTitle")}</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t("settings.autoBackupDescription")}</p>
          </div>
          <Switch checked={autoBackup.enabled} onChange={autoBackup.setEnabled} label={t("settings.autoBackupEnable")} />
        </div>

        {autoBackup.enabled && (
          <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--color-text-muted)]">{t("settings.autoBackupFolder")}</p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]">
                  {autoBackup.folder ?? t("settings.autoBackupNoFolder")}
                </span>
                <Button variant="secondary" size="sm" onClick={handleChooseBackupFolder}>
                  <FolderOpen size={14} />
                  {t("settings.autoBackupChooseFolder")}
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--color-text-muted)]">{t("settings.autoBackupInterval")}</p>
              <div className="flex flex-wrap gap-2">
                {AUTO_BACKUP_INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    onClick={() => autoBackup.setIntervalHours(opt.hours)}
                    className={cn(
                      "rounded-[2px] border px-3 py-1.5 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
                      autoBackup.intervalHours === opt.hours
                        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]",
                    )}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-0.5 text-xs font-medium text-[var(--color-text-muted)]">{t("settings.autoBackupRetention")}</p>
              <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">{t("settings.autoBackupRetentionDescription")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {AUTO_BACKUP_RETENTION_PRESETS.map((n) => (
                  <button
                    key={n}
                    onClick={() => autoBackup.setRetentionCount(n)}
                    className={cn(
                      "rounded-[2px] border px-3 py-1.5 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
                      autoBackup.retentionCount === n
                        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]",
                    )}
                  >
                    {n}
                  </button>
                ))}
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={retentionInput}
                  onChange={(e) => setRetentionInput(e.target.value)}
                  onBlur={commitRetentionInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  aria-label={t("settings.autoBackupRetentionCustom")}
                  className={cn(
                    "h-[34px] w-20 text-center",
                    !AUTO_BACKUP_RETENTION_PRESETS.includes(autoBackup.retentionCount) &&
                      "border-[var(--color-accent)] text-[var(--color-accent)]",
                  )}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-text-muted)]">
                {autoBackup.lastBackupAt
                  ? t("settings.autoBackupLast", {
                      time: `${formatDayLabel(autoBackup.lastBackupAt, i18n.language)}, ${formatTimeShort(autoBackup.lastBackupAt, i18n.language)}`,
                    })
                  : t("settings.autoBackupNever")}
              </p>
              <Button variant="secondary" size="sm" onClick={handleBackupNow} disabled={backingUp}>
                <Save size={14} />
                {t("settings.autoBackupNow")}
              </Button>
            </div>

            {backupStatus && <p className="text-sm">{backupStatus}</p>}
          </div>
        )}
      </section>

      <section className="rounded-[2px] border border-[var(--color-danger)] p-4">
        <h2 className="mb-1 text-sm font-medium text-[var(--color-danger)]">{t("settings.dangerZone")}</h2>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">{t("settings.resetAllDescription")}</p>
        <Button variant="danger" onClick={handleReset}>
          <Trash2 size={15} />
          {t("settings.resetAll")}
        </Button>
      </section>
    </div>
  );
}

/** Labels a run of related settings cards, so the page reads as a few groups instead of a long list. */
function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{children}</h2>
  );
}
