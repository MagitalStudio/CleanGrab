// SPDX-License-Identifier: GPL-3.0-only
interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The text next to the box. It is also the accessible name. */
  label: string;
  disabled?: boolean;
}

/** A checkbox with a label. The tick draws itself in and the box gives a little spring. */
export default function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2.5 rounded-md py-1 text-start text-body font-medium text-ink focus-visible:outline-none disabled:opacity-40"
    >
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-active:scale-90 group-focus-visible:ring-2 group-focus-visible:ring-accent-fill/60 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-surface ${
          checked
            ? "border-accent-fill bg-accent-fill text-accent-on"
            : "border-line/30 bg-field text-transparent group-hover:border-line/50"
        }`}
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path
            d="m3.5 8.5 3 3 6-7"
            style={{
              strokeDasharray: 16,
              strokeDashoffset: checked ? 0 : 16,
              transition: "stroke-dashoffset 220ms ease-out 60ms",
            }}
          />
        </svg>
      </span>
      <span>{label}</span>
    </button>
  );
}
