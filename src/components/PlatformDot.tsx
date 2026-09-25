// SPDX-License-Identifier: GPL-3.0-only
import type { Platform } from "../services/downloader";

// Each source has its own color, so the origin of a link reads at a glance.
// The platform name always sits next to the dot: color is never the only cue.
const DOT_COLOR: Record<string, string> = {
  YouTube: "#FF0000",
  // Black on a light window, white on a dark one.
  TikTok: "rgb(var(--ink))",
  Instagram: "#E1306C",
  Spotify: "#1DB954",
};

/** Any other site gets a colour of its own, always the same for the same name. */
function colourOf(platform: string): string {
  if (DOT_COLOR[platform]) return DOT_COLOR[platform];
  let hash = 0;
  for (const character of platform) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return `hsl(${hash} 60% 48%)`;
}

export default function PlatformDot({ platform }: { platform: Platform }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: colourOf(platform) }}
    />
  );
}
