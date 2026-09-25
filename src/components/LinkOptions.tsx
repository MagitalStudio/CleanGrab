// SPDX-License-Identifier: GPL-3.0-only
import { useT } from "../i18n";
import { QUALITY_OPTIONS, type MediaFormat, type Quality } from "../services/downloader";
import type { Entry, RowState } from "../views/linkEntries";
import Dropdown from "./Dropdown";
import Icon from "./Icons";
import Segmented from "./Segmented";

// The per-link options, shared by the main window's link rows and the
// quick-save popup so both offer exactly the same choices.

interface OptionProps {
  entry: Entry;
  state: RowState;
  /** Position in the list, for accessible names ("link 2"). */
  number: number;
  onChange: (patch: Partial<Entry>) => void;
}

/** MP3 | MP4 and the quality that goes with the chosen format. */
export function FormatAndQuality({ entry: _entry, state, number, onChange, tour = false }: OptionProps & { tour?: boolean }) {
  const t = useT();
  const isSpotify = state.link?.platform === "Spotify";

  return (
    <>
      <Segmented<MediaFormat>
        value={state.format}
        onChange={(format) => onChange({ format })}
        label={t("link.format", { n: number })}
        size="sm"
        className="w-[104px] shrink-0"
        tourId={tour ? "format" : undefined}
        options={[
          { id: "mp3", label: "MP3", title: t("link.audioOnly") },
          {
            id: "mp4",
            label: "MP4",
            title: isSpotify ? t("link.spotifyMp3Only") : t("link.video"),
            disabled: isSpotify,
          },
        ]}
      />

      <Dropdown<Quality>
        value={state.quality}
        options={QUALITY_OPTIONS[state.format].map((option) => ({ ...option, label: option.id === "best" ? t("quality.best") : option.label }))}
        onChange={(quality) => onChange({ quality })}
        label={t(state.format === "mp3" ? "link.audioQuality" : "link.videoQuality", { n: number })}
        title={t(state.format === "mp3" ? "link.audioQualityTitle" : "link.videoQualityTitle")}
        tourId={tour ? "quality" : undefined}
      />
    </>
  );
}

/** The scissors button that opens the trim fields. */
export function TrimToggle({ entry, number, onChange, tour = false }: Omit<OptionProps, "state"> & { tour?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      data-tour={tour ? "trim" : undefined}
      aria-pressed={entry.trimOn}
      aria-label={t("trim.aria", { n: number })}
      title={t("trim.title")}
      onClick={() => onChange({ trimOn: !entry.trimOn })}
      className={`btn shrink-0 px-2.5 ${
        entry.trimOn ? "bg-accent-fill/15 text-accent hover:bg-accent-fill/25" : "btn-secondary"
      }`}
    >
      <Icon name="scissors" />
      {t("trim.button")}
    </button>
  );
}

/** From / to fields and the sentence that says what will be kept. */
export function TrimFields({ entry, state, onChange, onEnter }: Omit<OptionProps, "number"> & { onEnter: () => void }) {
  const t = useT();
  const startId = `${entry.id}-start`;
  const endId = `${entry.id}-end`;

  return (
    <div className="mt-2 animate-fade-in rounded-lg bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={startId} className="min-w-10 text-body text-ink-2">
          {t("trim.from")}
        </label>
        <input
          id={startId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={entry.start}
          onChange={(e) => onChange({ start: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onEnter()}
          placeholder="0:00"
          aria-invalid={state.trimProblem !== null}
          dir="ltr"
          className="field h-8 w-24 text-center font-mono"
        />
        <label htmlFor={endId} className="px-1 text-body text-ink-2">
          {t("trim.to")}
        </label>
        <input
          id={endId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={entry.end}
          onChange={(e) => onChange({ end: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onEnter()}
          placeholder={t("trim.endPlaceholder")}
          aria-invalid={state.trimProblem !== null}
          dir="ltr"
          className="field h-8 w-24 text-center font-mono"
        />
        <span className="text-caption text-ink-2">{t("trim.example")}</span>
      </div>
      <p className={`mt-2 text-caption ${state.trimProblem ? "text-danger" : "text-ink-2"}`} aria-live="polite">
        {state.trimNote}
      </p>
    </div>
  );
}
