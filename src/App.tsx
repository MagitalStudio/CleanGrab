// SPDX-License-Identifier: GPL-3.0-only
import { useLanguageSync } from "./i18n/sync";
import { useAppearanceSync } from "./services/appearance";
import { windowLabel } from "./services/tauri";
import MainWindow from "./windows/MainWindow";
import ToastWindow from "./windows/ToastWindow";

// One frontend serves both windows: the floating quick-save toast and the
// main window (welcome, downloads, settings).
export default function App() {
  useAppearanceSync();
  useLanguageSync();
  return windowLabel() === "toast" ? <ToastWindow /> : <MainWindow />;
}
