// SPDX-License-Identifier: GPL-3.0-only
import { useEffect } from "react";
import { getSettings, onSettingsChanged } from "./settings";

export type Appearance = "system" | "light" | "dark";

const CACHE_KEY = "cleangrab.appearance";

/**
 * Sets the palette. "system" removes the override so the OS setting decides;
 * light and dark force it via data-theme (see the tokens in index.css).
 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = appearance;

  // Both windows share this origin: remember the choice so the next launch
  // paints in the right palette before the settings file has been read.
  try {
    localStorage.setItem(CACHE_KEY, appearance);
  } catch {
    // Storage can be unavailable; the settings file stays the source of truth.
  }
}

export function cachedAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Fall through to the system setting.
  }
  return "system";
}

// A change made in this window is saved through the backend, which then
// announces it to every window. While one is on its way, announcements about an
// earlier, quicker change must not flip the palette back for a moment.
let pending: { value: Appearance; until: number } | null = null;

/** Called by whoever changes the palette here, before the change is announced. */
export function markLocalChange(value: Appearance): void {
  pending = { value, until: Date.now() + 2000 };
}

function isStale(value: Appearance): boolean {
  if (!pending || Date.now() > pending.until) {
    pending = null;
    return false;
  }
  if (value === pending.value) {
    pending = null; // the change came back: everything is in step again
    return false;
  }
  return true;
}

/** Keeps this window's palette in step with the saved setting. */
export function useAppearanceSync(): void {
  useEffect(() => {
    getSettings()
      .then((settings) => applyAppearance(settings.appearance))
      .catch(() => {});
    return onSettingsChanged((settings) => {
      if (!isStale(settings.appearance)) applyAppearance(settings.appearance);
    });
  }, []);
}
