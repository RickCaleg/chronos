import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, RefreshCw, Trash2, Upload } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useThemeStore, type ThemePreference } from "../../store/useThemeStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useEntriesStore } from "../../store/useEntriesStore";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { Button } from "../ui/Button";
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
import { cn } from "../../lib/cn";

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
  const { groupSimilarEntries, setGroupSimilarEntries } = useAppSettingsStore();
  const updater = useUpdaterStore();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

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
    const confirmed = await confirm(t("settings.resetConfirm"), { kind: "warning" });
    if (!confirmed) return;
    await run(async () => {
      await resetAllData();
    }, "settings.resetSuccess");
  }

  return (
    <div className="mx-auto h-full max-w-xl overflow-y-auto py-2">
      <h1 className="mb-4 text-lg font-semibold">{t("settings.title")}</h1>

      <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 text-sm font-medium">{t("settings.language")}</h2>
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
      </section>

      <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 text-sm font-medium">{t("settings.theme")}</h2>
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
      </section>

      <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 text-sm font-medium">{t("settings.display")}</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">{t("settings.groupSimilar")}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{t("settings.groupSimilarDescription")}</p>
          </div>
          <Switch checked={groupSimilarEntries} onChange={setGroupSimilarEntries} label={t("settings.groupSimilar")} />
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
            <Button variant="primary" size="sm" className="mt-2" onClick={updater.downloadAndInstall}>
              <Download size={14} />
              {t("settings.downloadInstall")}
            </Button>
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
          <p className="mb-3 text-xs text-[var(--color-danger)]">{t("settings.updateCheckFailed", { error: updater.error })}</p>
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

      <section className="rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
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

      <section className="mt-6 rounded-[2px] border border-[var(--color-danger)] p-4">
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
