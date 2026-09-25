// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside a modal dialog, as `aria-modal` promises:
 * without it, focus walks off into the page behind the dialog.
 */
export function useFocusTrap(dialog: RefObject<HTMLElement>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = dialog.current;
      if (event.key !== "Tab" || !root) return;

      const items = root.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !root.contains(document.activeElement);

      if (event.shiftKey && (outside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog]);
}
