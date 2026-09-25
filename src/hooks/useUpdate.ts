// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../services/downloader";
import {
  dismissUpdateVersion,
  dismissedUpdateVersion,
  downloadUpdate,
  installUpdate,
  latestUpdate,
  onUpdateAvailable,
  onUpdateProgress,
  openUpdatePage,
  updateProgress,
  type Update,
  type UpdateProgress,
} from "../services/updates";

export interface UpdateState {
  /** The newer version that is out and not installed yet, if there is one (even if its banner was closed). */
  update: Update | null;
  /** Whether the banner should show: an update, not closed with "Later". */
  banner: boolean;
  /** "Later": closes the banner for this version. */
  dismiss: () => void;
  progress: UpdateProgress;
  /** The installer could not be started (downloads still running, say); the update stays ready. */
  installError: string | null;
  /** Downloads the installer and checks it. */
  download: () => void;
  /** Installs what was downloaded: CleanGrab quits and starts again. */
  install: () => void;
  /** For a release CleanGrab cannot install itself: opens its page. */
  openPage: () => void;
}

const IDLE: UpdateProgress = { stage: "idle", percent: 0, message: null };

/**
 * Follows the search for a newer version and its download: the update found before this page opened,
 * any found later, and how far the download has got.
 */
export function useUpdate(): UpdateState {
  const [found, setFound] = useState<Update | null>(null);
  // The version that was installed from here: it is no longer "available", on Home or anywhere. A version
  // published after it (a different number) is.
  const [installed, setInstalled] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>(IDLE);
  const [installError, setInstallError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => dismissedUpdateVersion());

  useEffect(() => {
    latestUpdate()
      .then((latest) => latest && setFound(latest))
      .catch(() => {});
    updateProgress()
      .then(setProgress)
      .catch(() => {});
    const stopFound = onUpdateAvailable(setFound);
    const stopProgress = onUpdateProgress(setProgress);
    return () => {
      stopFound();
      stopProgress();
    };
  }, []);

  const update = found !== null && found.version !== installed ? found : null;

  const dismiss = useCallback(() => {
    if (!update) return;
    dismissUpdateVersion(update.version);
    setDismissed(update.version);
  }, [update]);

  const download = useCallback(() => {
    setInstallError(null);
    setProgress({ stage: "downloading", percent: 0, message: null });
    downloadUpdate().catch((error) => setProgress({ stage: "error", percent: 0, message: errorMessage(error) }));
  }, []);

  const install = useCallback(() => {
    setInstallError(null);
    // CleanGrab quits and the installer replaces it: what is left to do is to stop announcing this version.
    installUpdate()
      .then(() => {
        if (update) setInstalled(update.version);
        setProgress(IDLE);
      })
      .catch((error) => setInstallError(errorMessage(error)));
  }, [update]);

  const openPage = useCallback(() => {
    void openUpdatePage().catch(() => {});
  }, []);

  return {
    update,
    banner: update !== null && update.version !== dismissed,
    dismiss,
    progress,
    installError,
    download,
    install,
    openPage,
  };
}
