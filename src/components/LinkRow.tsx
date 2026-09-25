// SPDX-License-Identifier: GPL-3.0-only
import { useRef, useState, type ClipboardEvent } from "react";
import { useT } from "../i18n";
import type { Entry, RowState } from "../views/linkEntries";
import Icon from "./Icons";
import { FormatAndQuality, TrimFields, TrimToggle } from "./LinkOptions";

interface LinkRowProps {
  entry: Entry;
  state: RowState;
  /** Position in the list, for accessible names ("Link 2"). */
  number: number;
  disabled: boolean;
  autoFocus: boolean;
  /** With several rows a row can be removed; with one it can only be cleared. */
  removable: boolean;
  onChange: (patch: Partial<Entry>) => void;
  onRemove: () => void;
  /** Several links were pasted at once; the parent spreads them over rows. */
  onPasteMany: (lines: string[]) => void;
  onEnter: () => void;
}

/** One link with its own format, quality and trim range. */
export default function LinkRow({
  entry,
  state,
  number,
  disabled,
  autoFocus,
  removable,
  onChange,
  onRemove,
  onPasteMany,
  onEnter,
}: LinkRowProps) {
  const t = useT();
  const isSpotify = state.link?.platform === "Spotify";
  const rowRef = useRef<HTMLLIElement>(null);
  const [leaving, setLeaving] = useState(false);

  // A row that goes away folds up first. Clearing the only row has nothing to fold.
  const remove = () => {
    if (!removable) return onRemove();
    rowRef.current?.style.setProperty("--row-height", `${rowRef.current.offsetHeight}px`);
    setLeaving(true);
    window.setTimeout(onRemove, 220);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const lines = event.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      event.preventDefault();
      onPasteMany(lines);
    }
  };

  const canClear = removable || entry.url !== "";

  return (
    <li ref={rowRef} className={`${leaving ? "animate-row-out overflow-hidden" : "animate-fade-up"} py-3 first:pt-0 last:pb-0`}>
      {/* Wraps: in a narrow window the format, quality, trim and remove controls drop under the field. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={entry.url}
          disabled={disabled}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          data-tour={number === 1 ? "link" : undefined}
          aria-label={t("link.aria", { n: number })}
          aria-invalid={state.unsupported}
          placeholder={number === 1 ? t("link.placeholderFirst") : t("link.placeholderNext")}
          onChange={(e) => onChange({ url: e.target.value })}
          onPaste={handlePaste}
          onKeyDown={(e) => e.key === "Enter" && onEnter()}
          className="field h-9 min-w-[12rem] flex-[1_1_14rem] font-url disabled:opacity-50"
        />

        <div className="flex shrink-0 items-center gap-2">
          <FormatAndQuality entry={entry} state={state} number={number} onChange={onChange} tour={number === 1} />
          <TrimToggle entry={entry} number={number} onChange={onChange} tour={number === 1} />

          <button
            type="button"
            className="btn-icon shrink-0"
            aria-label={removable ? t("link.remove", { n: number }) : t("link.clear", { n: number })}
            title={removable ? t("link.removeTitle") : t("link.clearTitle")}
            disabled={!canClear || leaving}
            onClick={remove}
          >
            <Icon name="x" />
          </button>
        </div>
      </div>

      {(state.link || state.unsupported) && (
        <p className="mt-1.5 min-w-0 truncate text-caption" aria-live="polite">
          {state.link ? (
            <span className="inline-flex items-center gap-1.5 text-accent">
              <Icon name="check" className="h-3.5 w-3.5 animate-pop" />
              {state.link.platform}
              {state.link.removedTrackers > 0 && ` · ${t("link.trackersRemoved", { n: state.link.removedTrackers })}`}
              {isSpotify && <span className="text-ink-2">· {t("link.spotifyMp3")}</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-danger">
              <Icon name="alert" className="h-3.5 w-3.5" />
              {t("link.unsupported")}
            </span>
          )}
        </p>
      )}

      {entry.trimOn && <TrimFields entry={entry} state={state} onChange={onChange} onEnter={onEnter} />}
    </li>
  );
}
