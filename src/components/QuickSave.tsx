// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  cancelJob,
  jobProgress,
  revealJob,
  type DetectedLink,
  type Job,
} from "../services/downloader";
import { useT } from "../i18n";
import { analyzeEntry, type Entry } from "../views/linkEntries";
import Icon, { Mark } from "./Icons";
import { headline, isCertificateKind } from "./CertificateNotice";
import { MenuSpaceContext } from "./Dropdown";
import { FormatAndQuality, TrimFields, TrimToggle } from "./LinkOptions";
import PlatformDot from "./PlatformDot";
import ProgressBar from "./ProgressBar";

/** Left alone for this long, the popup closes itself. */
const IDLE_DISMISS_MS = 5000;
/** After everything has finished. */
const DONE_DISMISS_MS = 4000;

/** How long the popup takes to change size. Quick enough to feel instant, slow enough to be followed. */
export const RESIZE_MS = 220;
/** Room kept after a menu closes, until the popup has finished shrinking over it. */
const HOLD_MS = RESIZE_MS + 30;

/** One link waiting in the popup, with the options chosen for it. */
export interface PopupItem {
  id: string;
  link: DetectedLink;
  /** `entry.url` is the cleaned link, so the same analysis as the main window applies. */
  entry: Entry;
  jobId: string | null;
  /**
   * The job has appeared in the job list. Until it does, a started download is
   * still starting; afterwards, missing from the list means it was removed.
   */
  seen?: boolean;
  /** Set when the download could not even start. */
  failure: { message: string; needsSetup: boolean } | null;
}

interface QuickSaveProps {
  items: PopupItem[];
  jobs: Job[];
  saveDir: string;
  /** Background opacity, 0.5 to 1. Text is never made transparent. */
  opacity: number;
  /** The person has clicked or typed in the popup: it stays until they act. */
  interacted: boolean;
  /** Set while the downloads are being started. */
  starting: boolean;
  onInteract: () => void;
  /**
   * How many pixels of the popup's height are only being kept for a moment
   * (a menu just closed and the popup is sliding back over its room). The
   * window should already treat them as gone.
   */
  onHold?: (pixels: number) => void;
  onChange: (id: string, patch: Partial<Entry>) => void;
  onRemove: (id: string) => void;
  onDownload: () => void;
  onDismiss: () => void;
  onOpenSetup: () => void;
  onChangeFolder: () => void;
  onOpenFolder: () => void;
}

type Phase = "idle" | "running" | "done" | "error";

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");

function phaseOf(item: PopupItem, job: Job | null): Phase {
  if (item.failure) return "error";
  if (!item.jobId) return "idle";
  if (!job) return item.seen ? "done" : "running"; // gone from the list: removed once finished
  if (job.status === "running") return "running";
  return job.status === "done" ? "done" : "error";
}

/**
 * The popup shown when a link is copied: small, but with the same per-link
 * choices as the main window (format, quality, trim). Copying more links while
 * it is open adds them to the list.
 */
export default function QuickSave({
  items,
  jobs,
  saveDir,
  opacity,
  interacted,
  starting,
  onInteract,
  onHold,
  onChange,
  onRemove,
  onDownload,
  onDismiss,
  onOpenSetup,
  onChangeFolder,
  onOpenFolder,
}: QuickSaveProps) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  // Room an open dropdown needs below the popup's content (the window fits its
  // content). When it closes the room is kept a little longer: the popup slides
  // back down over it, instead of its bottom edge jumping up first.
  const [space, setSpace] = useState({ open: 0, held: 0 });
  const setMenuSpace = useCallback((pixels: number) => {
    setSpace((current) => ({ open: pixels, held: pixels < current.open ? current.open - pixels : 0 }));
  }, []);
  useEffect(() => {
    if (space.held === 0) return;
    const timer = setTimeout(() => setSpace((current) => ({ ...current, held: 0 })), HOLD_MS);
    return () => clearTimeout(timer);
  }, [space.held]);
  useLayoutEffect(() => {
    onHold?.(space.held);
  }, [space.held, onHold]);
  const menuSpace = space.open + space.held;
  // Time left before auto-dismiss, kept across hover pauses.
  const budget = useRef<{ key: string | null; left: number }>({ key: null, left: 0 });

  const rows = items.map((item) => {
    const job = item.jobId ? (jobs.find((j) => j.id === item.jobId) ?? null) : null;
    return { item, job, phase: phaseOf(item, job), state: analyzeEntry(item.entry, { text: item.link.url, link: item.link }) };
  });

  const idle = rows.filter((row) => row.phase === "idle");
  const anyRunning = rows.some((row) => row.phase === "running");
  const anyError = rows.some((row) => row.phase === "error");
  const readyCount = idle.filter((row) => row.state.ready).length;
  const blocked = idle.some((row) => row.state.trimProblem !== null);

  // Ignored, it goes away by itself. Once the person interacts it waits for
  // them, and while downloading it stays. Hovering pauses the countdown.
  const dismissAfter = anyRunning
    ? null
    : idle.length > 0
      ? interacted
        ? null
        : IDLE_DISMISS_MS
      : anyError
        ? null
        : DONE_DISMISS_MS;
  // A newly added link starts the countdown again.
  const timerKey = dismissAfter === null ? null : `${dismissAfter}:${items.length}`;

  useEffect(() => {
    if (timerKey === null || dismissAfter === null) return;
    if (budget.current.key !== timerKey) budget.current = { key: timerKey, left: dismissAfter };
    if (hovered) return;

    const startedAt = performance.now();
    const timer = setTimeout(onDismiss, budget.current.left);
    return () => {
      clearTimeout(timer);
      budget.current.left -= performance.now() - startedAt;
    };
  }, [timerKey, dismissAfter, hovered, onDismiss]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") onDismiss();
  };

  const showCountdown = dismissAfter === IDLE_DISMISS_MS && idle.length > 0;

  return (
    <MenuSpaceContext.Provider value={setMenuSpace}>
      <div
        role="dialog"
        aria-label={t("popup.quickSave")}
        data-menu-boundary
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onPointerDown={onInteract}
        onFocusCapture={onInteract}
        onKeyDown={handleKeyDown}
        style={{ "--popup-alpha": opacity } as CSSProperties}
        className="frosted relative animate-toast-in overflow-hidden rounded-2xl border border-line/20 bg-[rgb(var(--surface)/var(--popup-alpha,0.95))] p-3"
      >
        <div className="flex h-7 items-center justify-between">
          <div className="flex items-center gap-2">
            <Mark className="h-5 w-5" />
            <span className="text-body font-bold text-ink">{t("popup.quickSave")}</span>
          </div>
          <div className="-me-1 flex items-center">
            <button
              type="button"
              className="btn-icon h-7 w-7"
              aria-label={t("popup.changeFolder")}
              title={t("popup.changeFolder")}
              onClick={onChangeFolder}
            >
              <Icon name="folderPick" />
            </button>
            <button
              type="button"
              className="btn-icon h-7 w-7"
              aria-label={t("popup.openFolder")}
              title={saveDir ? t("popup.openFolderAt", { path: saveDir }) : t("popup.openFolder")}
              onClick={onOpenFolder}
            >
              <Icon name="folder" />
            </button>
            <button type="button" className="btn-icon h-7 w-7" aria-label={t("common.dismiss")} onClick={onDismiss}>
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <ul
          className="thin-scroll mt-2 space-y-2 overflow-y-auto"
          style={{ maxHeight: Math.max(200, Math.floor(window.screen.availHeight * 0.55)) }}
        >
          {rows.map(({ item, job, phase, state }, index) => {
            const number = index + 1;
            const title = job?.title ?? shortUrl(item.link.url);
            return (
              <li key={item.id} className="animate-fade-up rounded-xl bg-[rgb(var(--bg)/var(--popup-alpha,0.95))] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <PlatformDot platform={item.link.platform} />
                    <span className="text-caption font-bold uppercase tracking-wider text-ink-2">
                      {item.link.platform}
                    </span>
                    {item.link.removedTrackers > 0 && (
                      <span
                        className="flex min-w-0 items-center gap-1 truncate text-caption text-accent"
                        title={t("popup.trackersHint")}
                      >
                        <Icon name="sparkle" className="h-3 w-3 shrink-0" />
                        {t("link.trackersRemoved", { n: item.link.removedTrackers })}
                      </span>
                    )}
                  </div>
                  {phase === "idle" && (
                    <button
                      type="button"
                      className="btn-icon -me-1.5 h-6 w-6 shrink-0"
                      aria-label={t("link.remove", { n: number })}
                      title={t("popup.dontSave")}
                      onClick={() => onRemove(item.id)}
                    >
                      <Icon name="x" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <p
                  className={`mt-1 truncate text-body text-ink ${job?.title ? "font-semibold" : "font-url"}`}
                  title={item.link.url}
                >
                  {title}
                </p>

                {phase === "idle" && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <FormatAndQuality
                        entry={item.entry}
                        state={state}
                        number={number}
                        onChange={(patch) => onChange(item.id, patch)}
                      />
                      <TrimToggle entry={item.entry} number={number} onChange={(patch) => onChange(item.id, patch)} />
                    </div>
                    {item.entry.trimOn && (
                      <TrimFields
                        entry={item.entry}
                        state={state}
                        onChange={(patch) => onChange(item.id, patch)}
                        onEnter={onDownload}
                      />
                    )}
                  </>
                )}

                {phase === "running" && job && (
                  <div className="mt-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <ProgressBar percent={jobProgress(job)} label={t("jobs.downloadingAria", { title })} />
                      <p className="mt-1 text-caption text-ink-2" aria-live="polite">
                        {job.stage === "converting"
                          ? t("popup.converting")
                          : jobProgress(job) === null
                            ? t("popup.downloading")
                            : t("popup.downloadingPct", { n: Math.round(job.percent) })}
                      </p>
                    </div>
                    <button type="button" className="btn btn-ghost h-7 px-2" onClick={() => void cancelJob(job.id).catch(() => {})}>
                      {t("common.cancel")}
                    </button>
                  </div>
                )}

                {phase === "running" && !job && <p className="mt-2 text-caption text-ink-2">{t("popup.starting")}</p>}

                {phase === "done" && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-body font-semibold text-accent" aria-live="polite">
                      <Icon name="check" className="h-4 w-4 animate-pop" />
                      {t("jobs.saved")}
                    </p>
                    {job && (
                      <button
                        type="button"
                        className="btn btn-secondary h-7"
                        onClick={() => revealJob(job.id).catch(() => {})}
                      >
                        <Icon name="folder" />
                        {t("jobs.showInFolder")}
                      </button>
                    )}
                  </div>
                )}

                {phase === "error" && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p role="alert" className="min-w-0 animate-shake text-caption text-danger">
                      {headline(item.failure?.message ?? (job?.status === "canceled" ? t("jobs.canceled") : (job?.error ?? t("jobs.downloadFailed"))))}
                    </p>
                    {/* A failed certificate check is explained in full in the main window. */}
                    {(item.failure?.needsSetup || isCertificateKind(job?.errorKind)) && (
                      <button type="button" className="btn btn-primary h-7 shrink-0" onClick={onOpenSetup}>
                        {item.failure?.needsSetup ? t("popup.openApp") : t("popup.details")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {idle.length > 0 ? (
          <div className="mt-3">
            {saveDir && (
              <p className="mb-2 truncate text-caption text-ink-2" title={saveDir}>
                {t("popup.savesTo", { path: saveDir })}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary h-9 flex-1 text-body font-bold"
                disabled={readyCount === 0 || blocked || starting}
                onClick={onDownload}
              >
                <Icon name="download" />
                {readyCount > 1 ? t("home.downloadMany", { n: readyCount }) : t("home.download")}
              </button>
              <button type="button" className="btn btn-ghost h-9" onClick={onDismiss}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          !anyRunning && (
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn btn-secondary" onClick={onDismiss}>
                {t("common.close")}
              </button>
            </div>
          )
        )}

        {/* Room for an open dropdown, so the window grows to hold its menu. */}
        {menuSpace > 0 && <div aria-hidden="true" style={{ height: menuSpace }} />}

        {showCountdown && (
          <div
            key={timerKey}
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent-fill/60 motion-reduce:hidden"
            style={{
              animation: `drain ${IDLE_DISMISS_MS}ms linear forwards`,
              animationPlayState: hovered ? "paused" : "running",
            }}
          />
        )}
      </div>
    </MenuSpaceContext.Provider>
  );
}
