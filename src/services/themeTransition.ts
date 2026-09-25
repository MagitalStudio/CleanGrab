// SPDX-License-Identifier: GPL-3.0-only
import { flushSync } from "react-dom";
import { applyAppearance, markLocalChange, type Appearance } from "./appearance";

// Changing between light and dark: a circle of the new palette grows from
// wherever the person clicked and takes over the window (the View Transitions
// API). Where that is not available, or when the system asks for less motion,
// the colours cross-fade instead (see the transitions in index.css) or simply
// change.

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
}
type StartViewTransition = (update: () => void) => ViewTransitionLike;

interface Point {
  x: number;
  y: number;
}

/** The last place the pointer went down, so the circle can start from the button that was pressed. */
let lastPress: (Point & { at: number }) | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPress = { x: event.clientX, y: event.clientY, at: performance.now() };
    },
    { capture: true, passive: true },
  );
}

const prefersLessMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the circle starts: the last click if it was just now, else the focused control, else the centre. */
function originOfChange(): Point {
  if (lastPress && performance.now() - lastPress.at < 1500) return lastPress;
  const focused = document.activeElement;
  if (focused && focused !== document.body) {
    const box = focused.getBoundingClientRect();
    if (box.width > 0) return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** The soft edge animates a registered custom property, which needs `@property`. */
const supportsSoftEdge = () => typeof CSS !== "undefined" && "registerProperty" in CSS;

/** How long the circle takes, from `--theme-ms` in index.css. */
function durationMs(): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--theme-ms"));
  return Number.isFinite(value) ? value : 650;
}

/**
 * Switches the palette to `next`. `save` records the choice (it runs together
 * with the switch, so the screen never shows one without the other).
 */
export function changeAppearance(next: Appearance, save: () => void): void {
  markLocalChange(next);
  const root = document.documentElement;

  const commit = () => {
    applyAppearance(next);
    flushSync(save);
  };

  const start = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== "function" || prefersLessMotion()) {
    commit();
    return;
  }

  const { x, y } = originOfChange();
  // Colours must not fade while the new palette is being captured, or the circle
  // would reveal a half-changed one.
  root.classList.add("theme-switching");

  let transition: ViewTransitionLike;
  try {
    transition = start.call(document, commit);
  } catch {
    commit();
    root.classList.remove("theme-switching");
    return;
  }

  transition.ready
    .then(() => {
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      // `fill` keeps the last frame until the browser takes the transition down.
      // Without it the animation snaps back to its first frame the moment it ends:
      // the mask would hide the new palette for one frame and the old one would
      // flash before the page settles.
      const options: KeyframeAnimationOptions = {
        duration: durationMs(),
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
        pseudoElement: "::view-transition-new(root)",
      };

      if (supportsSoftEdge()) {
        // The circle grows past the farthest corner by the width of its soft edge,
        // so that at the end the whole window is fully the new palette.
        const soft = Math.round(Math.min(460, Math.max(200, radius * 0.3)));
        root.style.setProperty("--theme-x", `${x}px`);
        root.style.setProperty("--theme-y", `${y}px`);
        root.style.setProperty("--theme-soft", `${soft}px`);
        root.animate({ "--theme-r": ["0px", `${radius + soft}px`] }, options);
      } else {
        // No way to animate the mask: a plain circle with a sharp edge.
        root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, options);
      }
    })
    // A newer change replaced this one: the palette is already up to date.
    .catch(() => {});

  transition.finished
    .catch(() => {})
    .finally(() => {
      root.classList.remove("theme-switching");
      for (const name of ["--theme-x", "--theme-y", "--theme-soft"]) root.style.removeProperty(name);
    });
}
