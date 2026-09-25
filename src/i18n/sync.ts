// SPDX-License-Identifier: GPL-3.0-only
import { useEffect } from "react";
import { getSettings, onSettingsChanged } from "../services/settings";
import { call } from "../services/tauri";
import { setLanguageSetting, t, useLanguage } from "./index";

/** Keeps this window's language in step with the saved setting. */
export function useLanguageSync(): void {
  useEffect(() => {
    getSettings()
      .then((settings) => setLanguageSetting(settings.language))
      .catch(() => {});
    return onSettingsChanged((settings) => setLanguageSetting(settings.language));
  }, []);
}

/**
 * Gives the tray icon's menu the words of the current language (the menu belongs to the backend).
 * While a newer version is out (`updateVersion`), the menu also offers to update to it.
 */
export function useTrayLabels(updateVersion: string | null = null): void {
  const language = useLanguage();
  useEffect(() => {
    void call("set_tray_labels", {
      open: t("tray.open"),
      watch: t("tray.watch"),
      quit: t("tray.quit"),
      update: updateVersion ? t("tray.update", { version: updateVersion }) : "",
    }).catch(() => {});
  }, [language, updateVersion]);
}
