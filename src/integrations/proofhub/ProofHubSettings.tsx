import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plug, Trash2 } from "lucide-react";
import { useProofHubStore } from "./useProofHubStore";
import { Button } from "../../components/ui/Button";

/**
 * The generic entry point in Settings: just enough to discover and install
 * the plugin. Once installed, everything else (connect, project mapping,
 * task linking) lives in its own top-level tab — see ProofHubView.tsx and
 * TopNav.tsx — both so that surface gets real page space instead of a
 * cramped Settings section, and so it's only mounted (and only spawns the
 * plugin binary for its data fetches) when actually in use.
 */
export function ProofHubSettings() {
  const { t } = useTranslation();
  const proofhub = useProofHubStore();
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    proofhub.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstall = async () => {
    setInstallError(null);
    try {
      await proofhub.install();
    } catch (err) {
      setInstallError(String(err));
    }
  };

  if (!proofhub.loaded) return null;

  return (
    <section className="mb-6 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">{t("proofhub.title")}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {proofhub.installed ? t("proofhub.manageInTab") : t("proofhub.description")}
          </p>
        </div>
        {proofhub.installed ? (
          <Button variant="ghost" size="sm" onClick={() => proofhub.uninstall()} disabled={proofhub.busy}>
            <Trash2 size={14} />
            {t("proofhub.uninstall")}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={handleInstall} disabled={proofhub.busy}>
            {proofhub.busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            {t("proofhub.install")}
          </Button>
        )}
      </div>
      {installError && <p className="mt-2 text-xs text-[var(--color-danger)]">{installError}</p>}
    </section>
  );
}
