// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { useT, type TKey } from "../i18n";
import Icon, { Mark } from "./Icons";
import Toggle from "./Toggle";

export type View = "home" | "player" | "settings";

const ITEMS: { view: View; label: TKey; icon: "home" | "play" | "gear"; hint?: string }[] = [
  { view: "home", label: "nav.home", icon: "home" },
  { view: "player", label: "nav.player", icon: "play" },
  { view: "settings", label: "nav.settings", icon: "gear", hint: "Ctrl+," },
];

interface SidebarProps {
  view: View;
  onNavigate: (view: View) => void;
  watching: boolean;
  onWatchingChange: (watching: boolean) => void;
  /** Something is playing in the small player: the Player entry says so. */
  playing?: boolean;
}

/**
 * The menu on the left of the main window, on every page: the logo and name, then Home,
 * Player and Settings, with the clipboard watch switch at the bottom. Below 768px wide it
 * shrinks to icons.
 */
export default function Sidebar({ view, onNavigate, watching, onWatchingChange, playing = false }: SidebarProps) {
  const t = useT();
  const [supportOpen, setSupportOpen] = useState(false);
  return (
    <nav aria-label={t("nav.label")} data-tauri-drag-region className="flex w-14 shrink-0 flex-col border-e border-line/10 px-2 pb-3 pt-4 md:w-52 md:px-3">
      {/* Up in the title bar's place, so it drags the window like the bar does. */}
      <div data-tauri-drag-region className="mb-4 flex select-none items-center justify-center gap-2.5 md:justify-start md:px-1" title="CleanGrab">
        <Mark className="pointer-events-none h-9 w-9 shrink-0" />
        {/* The name and, under it, who makes it: the two lines sit level with the middle of the logo. */}
        <span className="pointer-events-none hidden min-w-0 flex-col md:flex">
          <span className="text-headline font-bold leading-tight text-ink">CleanGrab</span>
          <span className="text-caption leading-tight text-ink-3">by MagitalStudio</span>
        </span>
      </div>

      <ul className="space-y-1">
        {ITEMS.map((item) => {
          const active = item.view === view;
          const label = t(item.label);
          return (
            <li key={item.view}>
              <button
                type="button"
                data-tour={`nav-${item.view}`}
                onClick={() => onNavigate(item.view)}
                aria-current={active ? "page" : undefined}
                title={item.hint ? `${label} (${item.hint})` : label}
                aria-label={label}
                className={`flex h-9 w-full items-center justify-center gap-2.5 rounded-lg text-body font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60 md:justify-start md:px-3 ${
                  active ? "bg-accent-fill/15 text-accent" : "text-ink-2 hover:bg-line/10 hover:text-ink"
                }`}
              >
                <span className="relative flex shrink-0">
                  <Icon name={item.icon} className="h-4 w-4" />
                  {item.view === "player" && playing && !active && (
                    <span aria-hidden="true" className="absolute -right-1 -top-1 h-2 w-2 animate-pop rounded-full bg-accent-fill ring-2 ring-bg" />
                  )}
                </span>
                <span className="hidden md:inline">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div data-tour="watch" className="mt-auto flex flex-col items-center gap-2 py-1 md:flex-row md:gap-2.5 md:rounded-lg md:border md:border-line/10 md:bg-surface md:py-1.5 md:ps-3 md:pe-2">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          {watching && <span className="absolute inset-0 animate-ping rounded-full bg-accent-fill opacity-40 motion-reduce:hidden" />}
          <span className={`relative h-2 w-2 rounded-full ${watching ? "bg-accent-fill" : "bg-control"}`} />
        </span>
        <span className="hidden flex-1 text-body text-ink md:inline">{watching ? t("nav.watching") : t("nav.paused")}</span>
        <Toggle checked={watching} onChange={onWatchingChange} label={t("nav.watchLabel")} />
      </div>
      <div className="hidden md:block">
        <button
          type="button"
          aria-expanded={supportOpen}
          aria-controls="support-detail"
          onClick={() => setSupportOpen((open) => !open)}
          className="flex items-center gap-1 rounded-md px-1 pt-2 text-caption text-ink-3 transition-colors hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60"
        >
          <Icon name="chevron" className={`h-3 w-3 shrink-0 transition-transform duration-200 ${supportOpen ? "" : "-rotate-90 rtl:rotate-90"}`} />
          {t("nav.support")}
        </button>
        <div
          id="support-detail"
          aria-hidden={!supportOpen}
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
            supportOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <p className="px-1 pb-1 pt-1 text-caption text-ink-3">{t("nav.supportDetail")}</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
