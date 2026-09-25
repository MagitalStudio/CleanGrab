// SPDX-License-Identifier: GPL-3.0-only
import { useRef, useState } from "react";
import { cancelJob, errorMessage, jobProgress, qualityLabel, removeJob, revealJob, type Job } from "../services/downloader";
import { t, useT } from "../i18n";
import { formatTime } from "../services/time";
import { headline } from "./CertificateNotice";
import Icon from "./Icons";
import ProgressBar from "./ProgressBar";

/** Below this card width the table folds into two lines per download. */
export const JOB_TABLE_MIN_WIDTH = 560;

/** Shared by the header row and every job row so the columns line up. */
const TABLE_COLUMNS = "grid grid-cols-[minmax(0,1fr)_6rem_7.5rem_6.5rem] items-center gap-3 px-5";

interface JobRowProps {
  job: Job;
  /** Narrow card: title and actions on top, status and progress underneath. */
  compact: boolean;
  onRetry: (job: Job) => void;
  /** Opens the saved file in the player. */
  onPlay: (job: Job) => void;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");

function statusLabel(job: Job): string {
  switch (job.status) {
    case "running":
      if (job.stage === "starting") return t("jobs.starting");
      return job.stage === "converting" ? t("jobs.converting") : t("jobs.downloading");
    case "done":
      return t("jobs.saved");
    case "canceled":
      return t("jobs.canceled");
    default:
      return t("jobs.failed");
  }
}

export function JobHeader({ compact, onClear }: { compact: boolean; onClear?: () => void }) {
  const t = useT();
  const clear = onClear && (
    <button type="button" className="btn btn-ghost h-7 px-2" title={t("jobs.clearTitle")} onClick={onClear}>
      {t("common.clear")}
    </button>
  );

  if (compact) {
    return (
      <div className="flex h-10 items-center justify-between border-b border-line/10 px-5">
        <span className="label">{t("jobs.title")}</span>
        {clear}
      </div>
    );
  }

  return (
    <div className={`${TABLE_COLUMNS} h-10 border-b border-line/10`}>
      <span className="label" aria-hidden="true">{t("jobs.colLink")}</span>
      <span className="label" aria-hidden="true">{t("jobs.colStatus")}</span>
      <span className="label" aria-hidden="true">{t("jobs.colProgress")}</span>
      <span className="flex justify-end">{clear}</span>
    </div>
  );
}

export default function JobRow({ job, compact, onRetry, onPlay }: JobRowProps) {
  const t = useT();
  const [revealError, setRevealError] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const [leaving, setLeaving] = useState(false);
  const running = job.status === "running";
  const failed = job.status === "error";

  const reveal = () => {
    setRevealError(null);
    revealJob(job.id).catch((e) => setRevealError(errorMessage(e)));
  };

  // Removing a download: the row folds away first, then it is taken off the list.
  const remove = () => {
    rowRef.current?.style.setProperty("--row-height", `${rowRef.current.offsetHeight}px`);
    setLeaving(true);
    window.setTimeout(() => void removeJob(job.id).catch(() => setLeaving(false)), 230);
  };
  const motion = leaving ? "animate-row-out overflow-hidden" : "animate-fade-up";

  const title = job.title ?? shortUrl(job.url);
  const range = job.trim ? ` · ${formatTime(job.trim.start)}–${job.trim.end === null ? t("trim.endShort") : formatTime(job.trim.end)}` : "";
  const quality = qualityLabel(job.format, job.quality);
  const detail =
    revealError ??
    (failed
      ? (job.error ? headline(job.error) : t("jobs.downloadFailed"))
      : `${job.platform} · ${job.format.toUpperCase()}${quality ? ` · ${quality}` : ""}${range}`);
  const progress = jobProgress(job);
  const detailIsError = failed || revealError !== null;

  const titleBlock = (
    <div className="min-w-0">
      <p className="truncate text-body font-semibold text-ink" title={job.url}>
        {title}
      </p>
      <p className={`truncate text-caption ${detailIsError ? "text-danger" : "text-ink-2"}`} title={failed && job.error ? job.error : detail}>
        {detail}
      </p>
    </div>
  );

  const status = (
    // Keyed by status, so each change of state plays its little entrance again.
    <p
      key={job.status}
      className={`flex items-center gap-1 text-body ${failed ? "animate-shake font-semibold text-danger" : "animate-fade-in text-ink"}`}
      aria-live="polite"
    >
      {job.status === "done" && <Icon name="check" className="h-3.5 w-3.5 animate-pop text-accent" />}
      {statusLabel(job)}
    </p>
  );

  const bar = running ? (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ProgressBar percent={progress} label={t("jobs.downloadingAria", { title })} />
      <span className="w-8 shrink-0 text-end text-caption tabular-nums text-ink-2">
        {progress === null ? "" : `${Math.round(progress)}%`}
      </span>
    </div>
  ) : null;

  const actions = (
    <div className="flex items-center justify-end gap-0.5">
      {running && (
        <button type="button" className="btn btn-ghost h-7 px-2" onClick={() => void cancelJob(job.id).catch(() => {})}>
          {t("common.cancel")}
        </button>
      )}
      {job.status === "done" && job.path && (
        <button type="button" className="btn-icon" aria-label={t("jobs.playAria", { title })} title={t("jobs.play")} onClick={() => onPlay(job)}>
          <Icon name="play" className="h-3.5 w-3.5" />
        </button>
      )}
      {job.status === "done" && (
        <button type="button" className="btn-icon" aria-label={t("jobs.showAria", { title })} title={t("jobs.showInFolder")} onClick={reveal}>
          <Icon name="folder" />
        </button>
      )}
      {(failed || job.status === "canceled") && (
        <button type="button" className="btn-icon" aria-label={t("jobs.retryAria", { title })} title={t("jobs.retry")} onClick={() => onRetry(job)}>
          <Icon name="retry" />
        </button>
      )}
      {!running && (
        <button type="button" className="btn-icon" aria-label={t("jobs.removeAria", { title })} title={t("jobs.removeTitle")} onClick={remove}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );

  if (compact) {
    return (
      <li ref={rowRef} className={`${motion} border-b border-line/10 px-5 py-3 last:border-b-0`}>
        <div className="flex items-center justify-between gap-3">
          {titleBlock}
          {actions}
        </div>
        <div className="mt-2 flex items-center gap-3">
          {status}
          {bar}
        </div>
      </li>
    );
  }

  return (
    <li ref={rowRef} className={`${TABLE_COLUMNS} ${motion} border-b border-line/10 py-3 last:border-b-0`}>
      {titleBlock}
      {status}
      <div>{bar ?? <span className="text-caption text-ink-2">{job.status === "done" ? "100%" : "–"}</span>}</div>
      {actions}
    </li>
  );
}
