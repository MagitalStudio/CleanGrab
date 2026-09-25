// SPDX-License-Identifier: GPL-3.0-only
import type { CSSProperties } from "react";

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; disabled?: boolean; title?: string }[];
  /** Accessible name of the group. */
  label: string;
  /** "sm" is 32px tall for use inside rows; "md" is 36px. */
  size?: "sm" | "md";
  className?: string;
  /** Marks the control for the first-run tour. */
  tourId?: string;
}

/** A segmented control: one choice among a few, with a sliding selection. */
export default function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className = "",
  tourId,
}: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((option) => option.id === value));

  return (
    <div
      role="radiogroup"
      data-tour={tourId}
      aria-label={label}
      className={`relative flex rounded-lg bg-track p-0.5 ${size === "sm" ? "h-8" : "h-9"} ${className}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 start-0.5 translate-x-[calc(var(--i)*100%)] rounded-md bg-pill shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.3,0.64,1)] rtl:translate-x-[calc(var(--i)*-100%)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, "--i": index } as CSSProperties}
      />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.id)}
          className={`relative z-10 flex-1 rounded-md text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60 disabled:cursor-not-allowed disabled:opacity-40 ${
            value === option.id ? "font-bold text-ink" : "font-medium text-ink-2 hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
