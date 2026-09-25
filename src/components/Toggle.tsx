// SPDX-License-Identifier: GPL-3.0-only
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** A switch. The label is announced by screen readers; the visible text lives next to it. */
export default function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 ${
        checked ? "bg-accent-fill" : "bg-control"
      }`}
    >
      <span
        className={`absolute start-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          checked ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
