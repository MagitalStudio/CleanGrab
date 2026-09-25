// SPDX-License-Identifier: GPL-3.0-only
import { call } from "./tauri";

// The quick-save popup is a separate window that sizes itself to its content
// (src-tauri/src/windows.rs).

/** Sizes the popup to `height` (logical px) and shows it if it is hidden. */
export const presentToast = (height: number) => call<void>("present_toast", { height });

/** Shows the popup with a sample link, to judge its look from Settings. */
export const previewToast = () => call<void>("preview_toast");

/** Lets the popup take keyboard focus, for typing trim times. Call on first click. */
export const activateToast = () => call<void>("activate_toast");
