// SPDX-License-Identifier: GPL-3.0-only
import { localizeMessage, t } from "../i18n";
import { call, subscribe } from "./tauri";

export type MediaFormat = "mp3" | "mp4";

/** "best", an audio bitrate in kbps (MP3), or a maximum video height (MP4). */
export type Quality = "best" | "320" | "192" | "128" | "2160" | "1440" | "1080" | "720" | "480" | "360";

export const QUALITY_OPTIONS: Record<MediaFormat, { id: Quality; label: string }[]> = {
  mp3: [
    { id: "best", label: "Best quality" },
    { id: "320", label: "320 kbps" },
    { id: "192", label: "192 kbps" },
    { id: "128", label: "128 kbps" },
  ],
  mp4: [
    { id: "best", label: "Best quality" },
    { id: "2160", label: "4K · 2160p" },
    { id: "1440", label: "2K · 1440p" },
    { id: "1080", label: "1080p" },
    { id: "720", label: "720p" },
    { id: "480", label: "480p" },
    { id: "360", label: "360p" },
  ],
};

export const isQualityFor = (format: MediaFormat, quality: Quality) =>
  QUALITY_OPTIONS[format].some((option) => option.id === quality);

/** Short text for a non-default quality ("192 kbps", "720p"); null for "best". */
export function qualityLabel(format: MediaFormat, quality: Quality): string | null {
  if (quality === "best") return null;
  return QUALITY_OPTIONS[format].find((option) => option.id === quality)?.label ?? null;
}
/** The site a link is from: YouTube, TikTok, Instagram, Spotify, another site CleanGrab knows, or the address of any other website. */
export type Platform = string;

export interface DetectedLink {
  /** Link with tracking parameters removed: what is actually downloaded. */
  url: string;
  platform: Platform;
  removedTrackers: number;
}

/** Part of the media to keep, in seconds. `end: null` means "until the end". */
export interface Trim {
  start: number;
  end: number | null;
}

export type JobStatus = "running" | "done" | "error" | "canceled";
export type JobStage = "starting" | "downloading" | "converting";

export interface Job {
  id: string;
  url: string;
  platform: Platform;
  format: MediaFormat;
  title: string | null;
  status: JobStatus;
  stage: JobStage;
  percent: number;
  path: string | null;
  error: string | null;
  /** "certificate-untrusted", "certificate-expired" or "certificate-site" when the check on the site's certificate failed. */
  errorKind?: string | null;
  createdAt: number;
  trim: Trim | null;
  quality: Quality;
}

/** Error message the backend returns when yt-dlp / FFmpeg are not installed. */
export const SETUP_REQUIRED = "SETUP_REQUIRED";

// Runs yt-dlp + FFmpeg locally (src-tauri/src/media.rs). Resolves with the job
// id as soon as the download has started; follow it through onJobsChanged.
export function startDownload(
  url: string,
  format: MediaFormat,
  trim: Trim | null = null,
  quality: Quality = "best",
): Promise<string> {
  return call<string>("start_download", { url, format, trim, quality });
}

/**
 * Progress to draw, 0-100, or null when the amount of work is unknown:
 * before the first bytes arrive, while converting, or when a trimmed download
 * reports no progress.
 */
export function jobProgress(job: Job): number | null {
  if (job.stage === "starting" || job.stage === "converting") return null;
  return job.percent > 0 ? job.percent : null;
}

export const parseLink = (text: string) => call<DetectedLink | null>("parse_link", { text });
export const listJobs = () => call<Job[]>("list_jobs");
export const cancelJob = (id: string) => call<void>("cancel_job", { id });
export const removeJob = (id: string) => call<void>("remove_job", { id });
export const clearFinished = () => call<void>("clear_finished");
export const revealJob = (id: string) => call<void>("reveal_job", { id });
export const openMain = (view?: "home" | "settings") => call<void>("open_main", { view });

export const onJobsChanged = (callback: (jobs: Job[]) => void) => subscribe("jobs-changed", callback);
export const onClipboardMediaDetected = (callback: (link: DetectedLink) => void) =>
  subscribe("clipboard-media-detected", callback);
export const onNavigate = (callback: (view: "home" | "settings") => void) =>
  subscribe("navigate", callback);

/** What went wrong, in words the person can read (in their language when the engine's message is a known one). */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return localizeMessage(error);
  if (error instanceof Error) return localizeMessage(error.message);
  return t("common.wrong");
}
