// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import {
  getUiZoom,
  onUiZoom,
  closeThisWindow,
  minimizeThisWindow,
  toggleMaximizeThisWindow,
  watchMaximized,
} from "../services/tauri";

// The main window's own title bar: no name, just room to drag the window by and
// the three window buttons. Thin 10px strokes, like the system's.

const glyph = "h-[10px] w-[10px]";

function Minimize() {
  return (
    <svg viewBox="0 0 10 10" className={glyph} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <path d="M0 5.5h10" />
    </svg>
  );
}

function Maximize() {
  return (
    <svg viewBox="0 0 10 10" className={glyph} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
    </svg>
  );
}

function Restore() {
  return (
    <svg viewBox="0 0 10 10" className={glyph} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
      <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
    </svg>
  );
}

function Close() {
  return (
    <svg viewBox="0 0 10 10" className={glyph} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  );
}

interface ControlProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}

function Control({ label, onClick, danger = false, children }: ControlProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-full w-[46px] items-center justify-center text-ink-2 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-fill/60 ${
        danger ? "hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/80" : "hover:bg-line/10 hover:text-ink active:bg-line/20"
      }`}
    >
      {children}
    </button>
  );
}

export default function TitleBar() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => watchMaximized(setMaximized), []);

  // The page is enlarged when the window is big, but the window buttons keep their real size:
  // this bar is drawn at the inverse of that zoom.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    getUiZoom().then(setZoom).catch(() => {});
    return onUiZoom(setZoom);
  }, []);

  return (
    // Sits above dialogs, so the window can still be moved and closed while one is open.
    <div
      data-tauri-drag-region
      dir="ltr"
      style={{ zoom: 1 / zoom }}
      className="relative z-[60] flex h-8 shrink-0 select-none items-stretch justify-end bg-bg"
    >
      <Control label={t("window.minimize")} onClick={() => void minimizeThisWindow().catch(() => {})}>
        <Minimize />
      </Control>
      <Control
        label={maximized ? t("window.restore") : t("window.maximize")}
        onClick={() => void toggleMaximizeThisWindow().catch(() => {})}
      >
        {maximized ? <Restore /> : <Maximize />}
      </Control>
      <Control label={t("window.close")} danger onClick={() => void closeThisWindow().catch(() => {})}>
        <Close />
      </Control>
    </div>
  );
}
