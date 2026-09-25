// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, listJobs, onJobsChanged, type Job } from "../services/downloader";
import { getEngineStatus, onEngineProgress, installEngine, type EngineProgress, type EngineStatus } from "../services/engine";
import { getSettings, onSettingsChanged, updateSettings, type Settings } from "../services/settings";

/** Live list of downloads, newest first. */
export function useJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const unsubscribe = onJobsChanged(setJobs);
    listJobs().then(setJobs).catch(() => {});
    return unsubscribe;
  }, []);

  return jobs;
}

export function useSettings(): [Settings | null, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings | null>(null);
  const latest = useRef<Settings | null>(null);
  // Saves still on their way to the backend. While there are any, events about
  // older states are ignored: two quick changes would otherwise flip the screen
  // back for a moment, and the next change would start from the stale copy.
  const inflight = useRef(0);

  useEffect(() => {
    const apply = (next: Settings) => {
      latest.current = next;
      setSettings(next);
    };
    const unsubscribe = onSettingsChanged((next) => {
      if (inflight.current === 0) apply(next);
    });
    getSettings().then(apply).catch(() => {});
    return unsubscribe;
  }, []);

  // Optimistic: the UI updates immediately, then settles on what the backend holds.
  const update = useCallback((patch: Partial<Settings>) => {
    const current = latest.current;
    if (!current) return;
    const next = { ...current, ...patch };
    latest.current = next;
    setSettings(next);

    inflight.current += 1;
    updateSettings(next)
      .catch(() => {})
      .finally(() => {
        inflight.current -= 1;
        if (inflight.current > 0) return;
        // Covers a save that failed, and a change made elsewhere meanwhile (the tray).
        getSettings()
          .then((saved) => {
            latest.current = saved;
            setSettings(saved);
          })
          .catch(() => {});
      });
  }, []);

  return [settings, update];
}

export interface EngineState {
  status: EngineStatus | null;
  installing: boolean;
  progress: EngineProgress | null;
  error: string | null;
  /** "certificate-..." when the failure was a failed certificate check. */
  errorKind: string | null;
  install: () => void;
  /** `withVersion` also reads yt-dlp's version, which means starting it. */
  refresh: (withVersion?: boolean) => void;
}

/** yt-dlp / FFmpeg availability plus the one-time installation flow. */
export function useEngine(): EngineState {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);

  const refresh = useCallback((withVersion = false) => {
    getEngineStatus(withVersion).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    return onEngineProgress((event) => {
      setProgress(event);
      if (event.stage === "done") {
        setInstalling(false);
        refresh();
      } else if (event.stage === "error") {
        setInstalling(false);
        setError(event.message ?? "Setup failed");
        setErrorKind(event.kind ?? null);
      }
    });
  }, [refresh]);

  const install = useCallback(() => {
    setError(null);
    setErrorKind(null);
    setInstalling(true);
    setProgress({ stage: "yt-dlp", percent: 0, message: null });
    installEngine().catch((e) => {
      setInstalling(false);
      setError(errorMessage(e));
    });
  }, []);

  return { status, installing, progress, error, errorKind, install, refresh };
}
