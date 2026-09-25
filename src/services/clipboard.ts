// SPDX-License-Identifier: GPL-3.0-only
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { hasTauriRuntime } from "./tauri";

/** Reads the clipboard when the person presses Paste (never in the background). */
export async function readClipboard(): Promise<string> {
  if (hasTauriRuntime()) return (await readText()) ?? "";
  return navigator.clipboard.readText();
}
