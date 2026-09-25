// SPDX-License-Identifier: GPL-3.0-only
import { call, subscribe } from "./tauri";

// Looking for a newer CleanGrab, and downloading and installing it, is done by the backend
// (src-tauri/src/updates.rs): it asks GitHub for the latest release of the project's repository,
// downloads the installer from it, checks it, and runs it when the person says so.

/** A version newer than the running one, as published on GitHub. */
export interface Update {
  /** "0.2.0" */
  version: string;
  /** What the release says is new. */
  notes: string;
  /** The release's page on github.com. */
  url: string;
  /** CleanGrab can download and install it itself (otherwise the person is sent to the page). */
  installable: boolean;
}

export interface UpdateStatus {
  /** The version running now. */
  current: string;
  update: Update | null;
}

/** Where the update stands: nothing yet, downloading, downloaded and checked, or failed. */
export interface UpdateProgress {
  stage: "idle" | "downloading" | "ready" | "error";
  percent: number;
  message: string | null;
}

export const checkForUpdate = () => call<UpdateStatus>("check_for_update");
export const latestUpdate = () => call<Update | null>("latest_update");
export const updateProgress = () => call<UpdateProgress>("update_progress");
/** Downloads the installer and checks it. Progress arrives on `update-progress`. */
export const downloadUpdate = () => call<void>("download_update");
/** Runs the installer that was downloaded: CleanGrab quits, and starts again when it is done. */
export const installUpdate = () => call<void>("install_update");
/** For an update CleanGrab cannot install itself: opens the release's page in the browser. */
export const openUpdatePage = () => call<void>("open_update_page");
/** The installer has just started CleanGrab again after an update. */
export const launchedAfterUpdate = () => call<boolean>("launched_after_update");

export const onUpdateAvailable = (callback: (update: Update) => void) => subscribe("update-available", callback);
export const onUpdateProgress = (callback: (progress: UpdateProgress) => void) => subscribe("update-progress", callback);

const DISMISSED_KEY = "cleangrab.updateDismissed";

/** The version whose banner the person closed with "Later" (it comes back for the next version). */
export function dismissedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function dismissUpdateVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Storage can be unavailable: the banner then simply comes back next time.
  }
}
