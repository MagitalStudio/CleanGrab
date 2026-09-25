// SPDX-License-Identifier: GPL-3.0-only
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icons";

/** Height of one row of the menu, and the padding around the rows. */
const ITEM_HEIGHT = 32;
const MENU_PADDING = 8;
const GAP = 4;

/**
 * Lets a container that sizes itself to its content (the quick-save popup) make
 * room for an open menu. The dropdown reports how many pixels it needs below
 * the container's bottom edge, and 0 when it closes.
 */
export const MenuSpaceContext = createContext<(pixels: number) => void>(() => {});

interface DropdownOption<T extends string> {
  id: T;
  label: string;
}

interface DropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name, e.g. "Video quality for link 2". */
  label: string;
  title?: string;
  className?: string;
  /** Marks the control for the first-run tour. */
  tourId?: string;
  /** Width of the button, as a Tailwind class. */
  width?: string;
}

interface Placement {
  top: number;
  left: number;
  minWidth: number;
}

/**
 * A menu of choices that looks like the rest of the app, instead of the
 * system's own list. Keyboard: arrows, Home/End, Enter or Space to choose,
 * Escape to close.
 */
export default function Dropdown<T extends string>({ value, options, onChange, label, title, className = "", tourId, width = "w-40" }: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reserveSpace = useContext(MenuSpaceContext);

  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const menuHeight = options.length * ITEM_HEIGHT + MENU_PADDING;

  const close = useCallback(() => {
    setOpen(false);
    reserveSpace(0);
  }, [reserveSpace]);

  // Where the menu goes, from where the trigger is right now.
  const place = useCallback((): Placement | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();

    let top = rect.bottom + GAP;
    // In a window that fits its content the menu always goes below (the window
    // grows to hold it). Elsewhere it flips up when there is no room below.
    const inFittingWindow = trigger.closest("[data-menu-boundary]") !== null;
    if (!inFittingWindow && top + menuHeight > window.innerHeight - GAP && rect.top - GAP - menuHeight > 0) {
      top = rect.top - GAP - menuHeight;
    }
    return { top, left: rect.left, minWidth: Math.max(rect.width, 144) };
  }, [menuHeight]);

  const openMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const boundary = trigger.closest("[data-menu-boundary]");
    if (boundary) {
      // Ask the container to grow enough to hold the menu below the trigger.
      const menuBottom = trigger.getBoundingClientRect().bottom + GAP + menuHeight + GAP;
      reserveSpace(Math.max(0, Math.ceil(menuBottom - boundary.getBoundingClientRect().bottom)));
    }

    setPlacement(place());
    setActive(selectedIndex);
    setOpen(true);
  };

  const choose = (index: number) => {
    onChange(options[index].id);
    close();
    triggerRef.current?.focus();
  };

  // Close when clicking elsewhere. Layout changes only move the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    // The window can be resized while the menu is open, including by the menu
    // itself (the popup grows to hold it), and the page can scroll. Follow the
    // trigger instead of closing; only close once it has left the screen.
    const onResize = () => setPlacement(place());
    const onScroll = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) close();
      else setPlacement(place());
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close, place]);

  // The popup slides while it resizes, so the button keeps moving for a moment.
  // Move the menu with it on every frame, straight in the DOM: going through
  // React state would always be one frame behind, and the menu would trail the
  // button while it slides.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const follow = () => {
      const next = place();
      const menu = menuRef.current;
      if (menu && next) {
        menu.style.top = `${next.top}px`;
        menu.style.left = `${next.left}px`;
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [open, place]);

  // Never leave space reserved behind if the control disappears while open.
  useEffect(() => () => reserveSpace(0), [reserveSpace]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) return openMenu();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + options.length) % options.length);
        break;
      }
      case "Home":
      case "End":
        if (open) {
          event.preventDefault();
          setActive(event.key === "Home" ? 0 : options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(active);
        else openMenu();
        break;
      case "Escape":
        if (open) {
          // Only close the menu, not the window that contains it.
          event.stopPropagation();
          close();
        }
        break;
      case "Tab":
        if (open) close();
        break;
    }
  };

  const optionId = (index: number) => `${menuId}-${index}`;

  return (
    <div className={`relative shrink-0 ${className}`} data-tour={tourId}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={label}
        title={title}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`field flex h-8 ${width} cursor-pointer items-center py-0 ps-3 pe-8 text-start font-medium`}
      >
        <span className="truncate">{options[selectedIndex]?.label}</span>
      </button>
      <Icon
        name="chevron"
        className={`pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2 transition-transform duration-200 ${
          open ? "rotate-180" : ""
        }`}
      />

      {open &&
        placement &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            aria-label={label}
            style={{ position: "fixed", top: placement.top, left: placement.left, minWidth: placement.minWidth }}
            className="z-[60] animate-toast-in rounded-xl border border-line/15 bg-surface p-1 shadow-xl"
          >
            {options.map((option, index) => {
              const selected = option.id === value;
              return (
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                  style={{ height: ITEM_HEIGHT }}
                  className={`flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-2.5 text-body transition-colors duration-100 ${
                    selected ? "font-semibold text-ink" : "text-ink"
                  } ${index === active ? "bg-line/10" : ""}`}
                >
                  <span className="whitespace-nowrap">{option.label}</span>
                  {selected && <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
