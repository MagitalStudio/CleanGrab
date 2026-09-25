// SPDX-License-Identifier: GPL-3.0-only
import { t } from "../i18n";
import { isQualityFor, type DetectedLink, type MediaFormat, type Quality, type Trim } from "../services/downloader";
import { formatTime, parseTime } from "../services/time";

/** One line in the links list, with its own format and trim settings. */
export interface Entry {
  id: string;
  url: string;
  format: MediaFormat;
  /** Bitrate (MP3) or maximum height (MP4); reset when the format changes. */
  quality: Quality;
  trimOn: boolean;
  /** As typed: "1:30", "90", or empty for 0:00. */
  start: string;
  /** As typed; empty means "until the end". */
  end: string;
}

/** The result of asking the backend about the text in a row. */
export interface Parsed {
  text: string;
  link: DetectedLink | null;
}

let counter = 0;

export const createEntry = (format: MediaFormat = "mp3"): Entry => ({
  id: `link-${++counter}`,
  url: "",
  format,
  quality: "best",
  trimOn: false,
  start: "",
  end: "",
});

/** Applies a change to an entry. Bitrates and resolutions don't carry over between MP3 and MP4. */
export function patchEntryFields(entry: Entry, patch: Partial<Entry>): Entry {
  const next = { ...entry, ...patch };
  if (patch.format && patch.format !== entry.format) next.quality = "best";
  return next;
}

export interface RowState {
  text: string;
  empty: boolean;
  /** The backend has not answered for the current text yet. */
  pending: boolean;
  link: DetectedLink | null;
  unsupported: boolean;
  /** The format that will really be used (Spotify is always MP3). */
  format: MediaFormat;
  /** The quality that will really be used for `format`. */
  quality: Quality;
  trim: Trim | null;
  trimProblem: string | null;
  trimNote: string;
  ready: boolean;
}

/** Works out what a row means right now: link, format, trim, and any problem. */
export function analyzeEntry(entry: Entry, parsed: Parsed | undefined): RowState {
  const text = entry.url.trim();
  const pending = text !== "" && parsed?.text !== text;
  const link = !pending && text !== "" ? (parsed?.link ?? null) : null;
  const format: MediaFormat = link?.platform === "Spotify" ? "mp3" : entry.format;
  const quality: Quality = isQualityFor(format, entry.quality) ? entry.quality : "best";

  // Trim: empty Start means 0:00, empty End means "until the end".
  const start = parseTime(entry.start);
  const startSeconds = start ?? 0;
  const end = parseTime(entry.end);
  let trimProblem: string | null = null;
  if (entry.trimOn) {
    if (Number.isNaN(start) || Number.isNaN(end)) trimProblem = t("trim.badFormat");
    else if (end !== null && end <= startSeconds) trimProblem = t("trim.endAfterStart");
  }
  const trim: Trim | null =
    entry.trimOn && !trimProblem && (startSeconds > 0 || end !== null) ? { start: startSeconds, end } : null;
  const trimNote =
    trimProblem ??
    (trim
      ? t("trim.keeps", { from: formatTime(trim.start), to: trim.end === null ? t("trim.theEnd") : formatTime(trim.end) })
      : t("trim.hint"));

  return {
    text,
    empty: text === "",
    pending,
    link,
    unsupported: !pending && text !== "" && link === null,
    format,
    quality,
    trim,
    trimProblem,
    trimNote,
    ready: link !== null && trimProblem === null,
  };
}
