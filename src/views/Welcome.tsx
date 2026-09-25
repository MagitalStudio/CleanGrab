// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useRef, useState } from "react";
import Icon, { Mark } from "../components/Icons";
import LegalBody from "../components/LegalBody";
import { KEY_POINTS } from "../content/terms";
import { TERMS_AND_CONDITIONS } from "../content/legal";
import { useT } from "../i18n";
import { errorMessage } from "../services/downloader";
import { acceptTerms, declineTerms } from "../services/terms";

const EXIT_MS = 250;
/** How close to the end (in pixels) the text has to be scrolled to count as read to the end. */
const END_SLACK = 12;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface WelcomeProps {
  onAccepted: () => void;
}

/**
 * First launch, after the language. Three plain-language points up front, then the full legal text,
 * which has to be scrolled to the end before "Agree" can be pressed. Agreeing is one deliberate
 * button press, and declining just quits.
 */
export default function Welcome({ onAccepted }: WelcomeProps) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the end of the Terms has been reached it stays reached, even if the window is resized after.
  const [readToEnd, setReadToEnd] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const checkEnd = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight <= END_SLACK) setReadToEnd(true);
  }, []);

  useEffect(() => {
    const box = scrollRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    // A tall window (or a small text) may show everything without scrolling: that counts as read.
    checkEnd();
    const observer = new ResizeObserver(checkEnd);
    observer.observe(box);
    observer.observe(content);
    // Focus lets the arrow keys, Page Down and Space scroll the text without a click first.
    box.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [checkEnd]);

  const leave = async (action: () => Promise<void>, after?: () => void) => {
    setError(null);
    setLeaving(true);
    await sleep(EXIT_MS);
    try {
      await action();
      if (after) after();
      else setLeaving(false); // Declining quits the app; only a preview survives it.
    } catch (e) {
      setError(errorMessage(e));
      setLeaving(false);
    }
  };

  return (
    <div
      className={`flex h-full flex-col transition-all duration-[250ms] ease-out ${
        leaving ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      <main
        ref={scrollRef}
        tabIndex={0}
        onScroll={checkEnd}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto focus:outline-none"
      >
        <div ref={contentRef} className="mx-auto flex max-w-[460px] flex-col items-center px-6 pb-8 pt-12">
          <div className="animate-settle">
            <Mark className="h-16 w-16" />
          </div>

          <h1
            className="mt-6 animate-fade-up text-center text-display font-bold tracking-tight text-ink"
            style={{ animationDelay: "80ms" }}
          >
            {t("welcome.title")}
          </h1>
          <p className="mt-2 animate-fade-up text-center text-headline text-ink-2" style={{ animationDelay: "140ms" }}>
            {t("welcome.tagline")}
          </p>

          <ul className="mt-9 w-full space-y-5">
            {KEY_POINTS.map((point, index) => (
              <li
                key={point.title}
                className="flex animate-fade-up items-start gap-3.5"
                style={{ animationDelay: `${220 + index * 90}ms` }}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <Icon name={point.icon} className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <h2 className="text-body font-bold text-ink">{t(point.title)}</h2>
                  <p className="mt-0.5 text-body text-ink-2">{t(point.body)}</p>
                </div>
              </li>
            ))}
          </ul>

          <section className="mt-10 w-full animate-fade-up" style={{ animationDelay: "520ms" }} aria-labelledby="full-terms-title">
            <h2 id="full-terms-title" className="label mb-3 text-center">
              {t("welcome.termsHeading")}
            </h2>
            <div className="card p-5">
              <LegalBody doc={TERMS_AND_CONDITIONS} />
            </div>
          </section>
        </div>
      </main>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/10 bg-surface/60 px-6 py-3">
        <p id="welcome-hint" className="flex min-w-[12rem] flex-1 items-center gap-1.5 text-caption text-ink-3" aria-live="polite">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : readToEnd ? (
            t("welcome.footer")
          ) : (
            <>
              <Icon name="chevron" className="h-3.5 w-3.5 shrink-0 animate-float" />
              {t("welcome.scrollHint")}
            </>
          )}
        </p>
        <button type="button" className="btn btn-ghost" disabled={leaving} onClick={() => leave(declineTerms)}>
          {t("welcome.quit")}
        </button>
        <button
          type="button"
          className="btn btn-primary px-4"
          disabled={leaving || !readToEnd}
          aria-describedby="welcome-hint"
          onClick={() => leave(acceptTerms, onAccepted)}
        >
          {t("welcome.agree")}
        </button>
      </footer>
    </div>
  );
}
