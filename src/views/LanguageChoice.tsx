// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Icon, { Mark } from "../components/Icons";
import { LANGUAGES, loadAllLanguages, textIn, useT, useLanguage, type LanguageCode } from "../i18n";

const EXIT_MS = 250;
/** How long each language's "Choose your language" stays up before the next one. */
const CYCLE_MS = 2400;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface LanguageChoiceProps {
  /** A language was picked: the interface switches to it right away. */
  onPick: (code: LanguageCode) => void;
  onContinue: () => void;
}

/**
 * The very first screen, before the Terms of Use and the tour: the language. The one the computer
 * uses is already selected, and the interface follows each pick at once, so the next screens are
 * already in the language chosen. Until something is picked, the heading says "Choose your
 * language" in each of the ten languages in turn, for people who cannot read the one shown first.
 */
export default function LanguageChoice({ onPick, onContinue }: LanguageChoiceProps) {
  const t = useT();
  const current = useLanguage();
  const [leaving, setLeaving] = useState(false);
  const [picked, setPicked] = useState(false);
  // The language the heading is shown in while it cycles: the current one first, then the others in turn.
  const [shown, setShown] = useState<LanguageCode>(current);
  const groupRef = useRef<HTMLDivElement>(null);
  // Nudges a re-draw once every language is loaded: the heading cycles through all of them.
  const [, setAllLoaded] = useState(false);
  useEffect(() => {
    void loadAllLanguages().then(() => setAllLoaded(true));
  }, []);

  useEffect(() => {
    if (picked || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setShown((now) => LANGUAGES[(LANGUAGES.findIndex((entry) => entry.code === now) + 1) % LANGUAGES.length].code);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [picked]);

  const pick = (code: LanguageCode) => {
    setPicked(true);
    setShown(code);
    onPick(code);
  };

  // Arrow keys move through the choices, as in any group of radio buttons.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !backward) return;
    event.preventDefault();
    const index = LANGUAGES.findIndex((entry) => entry.code === current);
    const next = LANGUAGES[(index + (forward ? 1 : LANGUAGES.length - 1)) % LANGUAGES.length];
    pick(next.code);
    groupRef.current?.querySelector<HTMLElement>(`[data-code="${next.code}"]`)?.focus();
  };

  const proceed = async () => {
    setLeaving(true);
    await sleep(EXIT_MS);
    onContinue();
  };

  const heading = picked ? current : shown;
  const headingRtl = LANGUAGES.find((entry) => entry.code === heading)?.rtl ?? false;

  return (
    <div
      className={`flex h-full flex-col transition-all duration-[250ms] ease-out ${
        leaving ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[460px] flex-col items-center px-6 pb-6 pt-8">
          <div className="animate-settle">
            <Mark className="h-14 w-14" />
          </div>

          {/* One heading for a screen reader; the changing words are only for the eyes. */}
          <h1 aria-label={t("language.title")} className="mt-4 flex min-h-[2.5rem] items-center justify-center text-center text-display font-bold tracking-tight text-ink">
            <span key={heading} lang={heading} dir={headingRtl ? "rtl" : "ltr"} aria-hidden="true" className="animate-fade-up">
              {textIn(heading, "language.title")}
            </span>
          </h1>

          <div
            ref={groupRef}
            role="radiogroup"
            aria-label={t("settings.language")}
            onKeyDown={onKeyDown}
            className="mt-6 grid w-full animate-fade-up grid-cols-2 gap-2"
            style={{ animationDelay: "120ms" }}
          >
            {LANGUAGES.map((entry) => {
              const selected = entry.code === current;
              return (
                <button
                  key={entry.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-code={entry.code}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => pick(entry.code)}
                  className={`flex h-10 items-center justify-between gap-2 rounded-lg border px-3.5 text-body transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60 ${
                    selected
                      ? "border-accent-fill/60 bg-accent-fill/10 font-bold text-ink"
                      : "border-line/10 bg-surface font-medium text-ink-2 hover:border-line/25 hover:text-ink"
                  }`}
                >
                  <span lang={entry.code} dir={entry.rtl ? "rtl" : "ltr"} className="min-w-0 truncate">
                    {entry.name}
                  </span>
                  {selected && <Icon name="check" className="h-4 w-4 shrink-0 animate-pop text-accent" />}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/10 bg-surface/60 px-6 py-3">
        <p className="min-w-[12rem] flex-1 text-caption text-ink-3">{t("language.hint")}</p>
        <button type="button" className="btn btn-primary px-4" disabled={leaving} onClick={() => void proceed()}>
          {t("language.continue")}
        </button>
      </footer>
    </div>
  );
}
