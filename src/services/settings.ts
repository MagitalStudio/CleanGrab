// SPDX-License-Identifier: GPL-3.0-only
import type { LanguageSetting } from "../i18n";
import type { Appearance } from "./appearance";
import { call, subscribe } from "./tauri";

export interface Settings {
  appearance: Appearance;
  /** Start in the tray without opening the main window. */
  startInBackground: boolean;
  /** Background opacity of the quick-save popup, 0.5 to 1. */
  popupOpacity: number;
  watchClipboard: boolean;
  saveDir: string | null;
  removeWatermark: boolean;
  vertical916: boolean;
  trimAudioSilence: boolean;
  /**
   * Download even when a site's certificate can't be trusted. Off unless the
   * person turns it on knowingly. Never applies to setting up yt-dlp and FFmpeg.
   */
  allowUntrustedCertificates: boolean;
  /** The first-run tour has been seen or skipped. */
  tutorialDone: boolean;
  /** Once a day, ask GitHub whether a newer version of CleanGrab is out. */
  checkForUpdates: boolean;
  /** Offer to save any web link that is copied, not only the ones from the sites CleanGrab knows. */
  offerAnyLink: boolean;
  /** The language of the interface, or "system" to follow the computer's. */
  language: LanguageSetting;
}

export const getSettings = () => call<Settings>("get_settings");
export const updateSettings = (settings: Settings) => call<Settings>("update_settings", { settings });
export const getSaveDir = () => call<string>("get_save_dir");
export const chooseFolder = () => call<string | null>("choose_folder");
export const openSaveDir = () => call<void>("open_save_dir");
export const onSettingsChanged = (callback: (settings: Settings) => void) =>
  subscribe("settings-changed", callback);
