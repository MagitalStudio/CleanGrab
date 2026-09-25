// SPDX-License-Identifier: GPL-3.0-only
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Every backend call goes through here so the UI can also run in a plain
// browser (`npm run dev`) against the in-memory mock in devMock.ts.

/** How much the window's page is enlarged (1 = normal). Only the main window changes it. */
export const getUiZoom = () => call<number>("ui_zoom");
export const onUiZoom = (callback: (zoom: number) => void) => subscribe("ui-zoom", callback);

export const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (hasTauriRuntime()) return invoke<T>(command, args);
  if (import.meta.env.DEV) {
    const { mockInvoke } = await import("./devMock");
    return mockInvoke(command, args) as Promise<T>;
  }
  throw new Error("CleanGrab backend is not available");
}

/** Subscribes to a backend event. Returns a synchronous unsubscribe function. */
export function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  if (!hasTauriRuntime()) {
    if (!import.meta.env.DEV) return () => {};
    const handler = (e: Event) => callback((e as CustomEvent<T>).detail);
    window.addEventListener(`mock:${event}`, handler);
    return () => window.removeEventListener(`mock:${event}`, handler);
  }

  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen<T>(event, (e) => callback(e.payload))
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export type WindowLabel = "main" | "toast";

/** Which window this page is running in. `?view=toast` selects it in a browser. */
export function windowLabel(): WindowLabel {
  if (hasTauriRuntime()) return getCurrentWindow().label === "toast" ? "toast" : "main";
  return new URLSearchParams(window.location.search).get("view") === "toast" ? "toast" : "main";
}

export async function showThisWindow(): Promise<void> {
  if (!hasTauriRuntime()) return;
  const current = getCurrentWindow();
  await current.show();
  await current.setFocus();
}

export async function hideThisWindow(): Promise<void> {
  if (!hasTauriRuntime()) return;
  await getCurrentWindow().hide();
}

/**
 * Windows and Linux draw the main window's title bar themselves (the system's is
 * turned off); macOS keeps its own traffic lights. A plain browser preview shows it.
 */
export const usesCustomTitleBar = () =>
  !(hasTauriRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent));

/** macOS pins the quick-save popup to the top of the screen, so it grows downwards; elsewhere it sits at the bottom and grows upwards. */
export const POPUP_AT_TOP = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

export const minimizeThisWindow = async () => {
  if (hasTauriRuntime()) await getCurrentWindow().minimize();
};

export const toggleMaximizeThisWindow = async () => {
  if (hasTauriRuntime()) await getCurrentWindow().toggleMaximize();
};

/** Closing the main window sends CleanGrab to the tray; the backend decides. */
export const closeThisWindow = async () => {
  if (hasTauriRuntime()) await getCurrentWindow().close();
};

/** Calls back with whether the window is maximized, now and whenever its size changes. */
export function watchMaximized(callback: (maximized: boolean) => void): () => void {
  if (!hasTauriRuntime()) return () => {};
  const current = getCurrentWindow();
  let active = true;
  const check = () =>
    current
      .isMaximized()
      .then((maximized) => active && callback(maximized))
      .catch(() => {});
  check();
  const unlisten = current.onResized(check);
  return () => {
    active = false;
    void unlisten.then((stop) => stop());
  };
}
