// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isRtl, useT, type TKey } from "../i18n";
import TourPopupPreview from "./TourPopupPreview";

type Side = "right" | "left" | "bottom" | "top";

interface TourStep {
  /** CSS selectors of what the note is about; the note points at the box around all of them. */
  targets: string[];
  title: TKey;
  body: TKey;
  /** Which side of the target the note prefers. It flips to the other side when there is no room. */
  side: "right" | "bottom";
  /** The note points at a copy of the quick-save popup, shown only while this note is open. */
  popup?: boolean;
}

// The switch first: it is what makes CleanGrab work without opening it, and the popup is what it brings up.
// Then Home and what is on it, then the two other pages.
const STEPS: TourStep[] = [
  { targets: ['[data-tour="watch"]'], title: "tour.watch.title", body: "tour.watch.body", side: "right" },
  { targets: ['[data-tour="popup"]'], title: "tour.popup.title", body: "tour.popup.body", side: "bottom", popup: true },
  { targets: ['[data-tour="nav-home"]'], title: "nav.home", body: "tour.home.body", side: "right" },
  { targets: ['[data-tour="link"]'], title: "tour.link.title", body: "tour.link.body", side: "bottom" },
  {
    targets: ['[data-tour="format"]', '[data-tour="quality"]'],
    title: "tour.format.title",
    body: "tour.format.body",
    side: "bottom",
  },
  { targets: ['[data-tour="trim"]'], title: "tour.trim.title", body: "tour.trim.body", side: "bottom" },
  { targets: ['[data-tour="nav-player"]'], title: "nav.player", body: "tour.player.body", side: "right" },
  { targets: ['[data-tour="nav-settings"]'], title: "nav.settings", body: "tour.settings.body", side: "right" },
];

/** Space around the highlighted control, and between it and the note. */
const HALO = 6;
const GAP = 16;
const MARGIN = 12;
/** The arrow stays at least this far from the note's corners. */
const ARROW_INSET = 22;

interface Layout {
  spot: { top: number; left: number; width: number; height: number };
  note: { top: number; left: number };
  side: Side;
  /** Where the arrow sits along the note's edge. */
  arrow: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/** Where the note goes for this step, or `null` when what it points at is not on the page. */
function place(step: TourStep, note: HTMLElement): Layout | null {
  const found = step.targets.map((selector) => document.querySelector(selector)).filter((el): el is Element => el !== null);
  if (found.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of found) {
    const box = element.getBoundingClientRect();
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  const spot = { top: top - HALO, left: left - HALO, width: right - left + HALO * 2, height: bottom - top + HALO * 2 };

  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = window.innerHeight;
  const noteWidth = note.offsetWidth;
  const noteHeight = note.offsetHeight;
  const centreX = spot.left + spot.width / 2;
  const centreY = spot.top + spot.height / 2;

  if (step.side === "right") {
    // "Right" is the side the text runs towards: the left in a right-to-left language.
    const towardsEnd: Side = isRtl() ? "left" : "right";
    let side: Side = towardsEnd;
    let noteLeft = towardsEnd === "right" ? spot.left + spot.width + GAP : spot.left - GAP - noteWidth;
    if (noteLeft < MARGIN || noteLeft + noteWidth > viewWidth - MARGIN) {
      side = towardsEnd === "right" ? "left" : "right";
      noteLeft = side === "right" ? spot.left + spot.width + GAP : spot.left - GAP - noteWidth;
    }
    const noteTop = clamp(centreY - noteHeight / 2, MARGIN, viewHeight - noteHeight - MARGIN);
    return { spot, note: { top: noteTop, left: noteLeft }, side, arrow: clamp(centreY - noteTop, ARROW_INSET, noteHeight - ARROW_INSET) };
  }

  let side: Side = "bottom";
  let noteTop = spot.top + spot.height + GAP;
  if (noteTop + noteHeight > viewHeight - MARGIN && spot.top - GAP - noteHeight >= MARGIN) {
    side = "top";
    noteTop = spot.top - GAP - noteHeight;
  }
  const noteLeft = clamp(centreX - noteWidth / 2, MARGIN, viewWidth - noteWidth - MARGIN);
  return { spot, note: { top: noteTop, left: noteLeft }, side, arrow: clamp(centreX - noteLeft, ARROW_INSET, noteWidth - ARROW_INSET) };
}

/** The little square that turns the note into a speech bubble: two of its borders show, the ones facing the target. */
function arrowClass(side: Side): string {
  switch (side) {
    case "bottom":
      return "-top-1.5 border-l border-t";
    case "top":
      return "-bottom-1.5 border-b border-r";
    case "right":
      return "-left-1.5 border-b border-l";
    default:
      return "-right-1.5 border-r border-t";
  }
}

interface TourProps {
  /** The tour was finished or skipped. */
  onDone: () => void;
}

/**
 * The first-run tour: a short series of notes, each next to the control it explains,
 * with a soft arrow and an OK button. The rest of the page is dimmed and waits.
 */
export default function Tour({ onDone }: TourProps) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  // The page's own entrance takes a moment; the first note comes after it, not while things are still moving.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 650);
    return () => clearTimeout(timer);
  }, []);
  const noteRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(noteRef);

  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const next = useCallback(() => {
    // The old layout stays until the new one is measured, so the note glides from one control to the next.
    if (index >= STEPS.length - 1) onDone();
    else setIndex(index + 1);
  }, [index, onDone]);

  // Follows the target: it moves when the window is resized or the page scrolls or re-flows.
  useEffect(() => {
    document.querySelector(step.targets[0])?.scrollIntoView({ block: "nearest", inline: "nearest" });

    let frame = 0;
    let shown = "";
    let missing = 0;
    const follow = () => {
      frame = requestAnimationFrame(follow);
      const note = noteRef.current;
      if (!note) return;
      const found = place(step, note);
      if (!found) {
        // What this step points at is not there (a smaller layout, say): move on rather than point at nothing.
        if (++missing > 30) next();
        return;
      }
      missing = 0;
      const key = JSON.stringify(found);
      if (key !== shown) {
        shown = key;
        setLayout(found);
      }
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [step, next]);

  // Focus on OK for each note, so Enter or Space confirms it. Esc leaves the tour.
  const placed = layout !== null;
  useEffect(() => {
    if (placed) okRef.current?.focus({ preventScroll: true });
  }, [index, placed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDone();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  const moves = index > 0 ? "transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none" : "";
  const arrowAxis = layout && (layout.side === "top" || layout.side === "bottom") ? "left" : "top";

  if (!ready) return null;

  return createPortal(
    // Above the title bar. The catcher keeps clicks from reaching the page while a note is open.
    <div className="fixed inset-0 z-[70]" onMouseDown={(event) => event.preventDefault()}>
      {layout && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed rounded-xl ring-2 ring-accent-fill/70 ${moves} animate-fade-in`}
          style={{
            ...layout.spot,
            boxShadow: "0 0 0 100vmax rgb(0 0 0 / 0.4), 0 0 24px 2px rgb(var(--accent-fill) / 0.35)",
          }}
        />
      )}

      {step.popup && <TourPopupPreview />}

      <div
        ref={noteRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={`card fixed w-80 max-w-[calc(100vw-1.5rem)] shadow-2xl ${moves} ${layout ? "" : "invisible"}`}
        style={layout ? { top: layout.note.top, left: layout.note.left } : { top: 0, left: 0 }}
      >
        {layout && (
          <span
            aria-hidden="true"
            className={`absolute h-3 w-3 rotate-45 border-line/10 bg-surface transition-[left,top] duration-300 motion-reduce:transition-none ${arrowClass(layout.side)}`}
            style={{ [arrowAxis]: layout.arrow - 6 }}
          />
        )}

        <div key={index} className="relative animate-fade-in p-4">
          <h2 id="tour-title" className="text-headline font-bold text-ink">
            {t(step.title)}
          </h2>
          <p id="tour-body" className="mt-1.5 text-body text-ink-2">
            {t(step.body)}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex gap-1" aria-hidden="true">
                {STEPS.map((_, dot) => (
                  <span
                    key={dot}
                    className={`h-1.5 rounded-full transition-all duration-300 ${dot === index ? "w-4 bg-accent-fill" : "w-1.5 bg-control"}`}
                  />
                ))}
              </span>
              <span className="text-caption text-ink-3">
                {t("tour.step", { n: index + 1, total: STEPS.length })}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!last && (
                <button type="button" className="btn btn-ghost" onClick={onDone}>
                  {t("common.skip")}
                </button>
              )}
              <button ref={okRef} type="button" className="btn btn-primary min-w-[4.5rem]" onClick={next}>
                {t("common.ok")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
