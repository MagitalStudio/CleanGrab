// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Tracks the rendered width of an element. Used instead of window breakpoints
 * so a component adapts to the space it actually has (a narrow column in a
 * wide window is as tight as a narrow window).
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    setWidth(Math.round(element.getBoundingClientRect().width));
    // Measured the same way as above (border box), so the value does not jump by
    // the border's width between the first reading and the later ones.
    const observer = new ResizeObserver(() => {
      setWidth(Math.round(element.getBoundingClientRect().width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
