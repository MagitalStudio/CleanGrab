// SPDX-License-Identifier: GPL-3.0-only
/**
 * Reads a time typed by a person: "90", "1:30", "01:02:03", "1:30.5" (a comma works as the
 * decimal mark too, as in "1,5").
 * Returns seconds, `null` when the field is empty, or `NaN` when it can't be read.
 */
export function parseTime(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (value === "") return null;

  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);

  const match = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!match) return Number.NaN;

  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  // With hours, minutes must be below 60; seconds always are.
  if (seconds >= 60 || (match[1] !== undefined && minutes >= 60)) return Number.NaN;

  return hours * 3600 + minutes * 60 + seconds;
}

/** 75 -> "1:15", 3725 -> "1:02:05". Fractions are kept to one decimal. */
export function formatTime(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds * 10) / 10;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const secondsText = (Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)).padStart(
    Number.isInteger(seconds) ? 2 : 4,
    "0",
  );

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secondsText}`
    : `${minutes}:${secondsText}`;
}
