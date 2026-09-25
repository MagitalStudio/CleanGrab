// SPDX-License-Identifier: GPL-3.0-only
import { convertFileSrc } from "@tauri-apps/api/core";
import { call, hasTauriRuntime, subscribe } from "./tauri";

/** A file the player can play, as the backend prepares it (see player.rs). */
export interface PlayableMedia {
  /** The file to play: the original, or the converted copy. */
  path: string;
  kind: "video" | "audio";
  /** The file's name without its extension. */
  title: string;
  seconds: number | null;
  /** The original could not be played as it was, and a converted copy is. */
  converted: boolean;
  /** Where the window reads it from. */
  url: string;
}

/** Opens the system's file picker on audio and video files. `null` when cancelled. */
export const pickMediaFile = () => call<string | null>("pick_media_file");

/**
 * Gets a file ready to play. Most files are ready at once; others (AVI, MKV,
 * WMA, HEVC...) are converted first, and `onPlaybackProgress` reports how far along that is.
 */
export async function preparePlayback(path: string): Promise<PlayableMedia> {
  const media = await call<Omit<PlayableMedia, "url">>("prepare_playback", { path });
  // In a browser preview the mock hands back a ready-made address.
  return { ...media, url: hasTauriRuntime() ? convertFileSrc(media.path) : media.path };
}

/** Stops a conversion that is still running. */
export const cancelPlayback = () => call<void>("cancel_playback");

export const onPlaybackProgress = (callback: (progress: { path: string; percent: number }) => void) =>
  subscribe("playback-progress", callback);
