// SPDX-License-Identifier: GPL-3.0-only
interface ProgressBarProps {
  /** 0–100, or null when the amount of work is unknown. */
  percent: number | null;
  /** Accessible name, e.g. "Downloading". */
  label: string;
}

export default function ProgressBar({ percent, label }: ProgressBarProps) {
  const clamped = percent === null ? null : Math.min(100, Math.max(0, percent));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === null ? undefined : Math.round(clamped)}
      dir="ltr"
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-track"
    >
      {clamped === null ? (
        <div className="absolute inset-y-0 left-0 w-2/5 animate-indeterminate rounded-full bg-accent-fill" />
      ) : (
        <div
          className="bar-shine h-full origin-left rounded-full bg-accent-fill transition-transform duration-200 ease-out"
          style={{ transform: `scaleX(${clamped / 100})` }}
        />
      )}
    </div>
  );
}
