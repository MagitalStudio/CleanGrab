// SPDX-License-Identifier: GPL-3.0-only
import type { UpdateState } from "../hooks/useUpdate";
import { useT } from "../i18n";
import ProgressBar from "./ProgressBar";

/**
 * What can be done about the update at this point: download it (or open its page, when CleanGrab
 * cannot install that release itself), watch it download, install it once it has been downloaded and
 * checked, or try again after a failure. Used by the banner on Home and by Settings.
 */
export default function UpdateControls({ news }: { news: UpdateState }) {
  const t = useT();
  const { update, progress, installError, download, install, openPage } = news;
  if (!update) return null;

  if (progress.stage === "downloading") {
    const label = t("update.progress", { version: update.version, n: Math.round(progress.percent) });
    return (
      <div className="flex w-44 flex-col gap-1.5">
        <ProgressBar percent={progress.percent} label={label} />
        <p className="text-caption text-ink-3" aria-live="polite">
          {label}
        </p>
      </div>
    );
  }

  if (progress.stage === "ready") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" className="btn btn-primary px-4" onClick={install}>
          {t("update.install")}
        </button>
        {installError && (
          <p role="alert" className="max-w-[16rem] text-end text-caption text-danger">
            {installError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {progress.stage === "error" && progress.message && (
        <p role="alert" className="max-w-[16rem] animate-shake text-caption text-danger">
          {progress.message}
        </p>
      )}
      {update.installable ? (
        <button type="button" className="btn btn-primary px-4" onClick={download}>
          {progress.stage === "error" ? t("update.retry") : t("update.download")}
        </button>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={openPage}>
          {t("update.openPage")}
        </button>
      )}
    </div>
  );
}
