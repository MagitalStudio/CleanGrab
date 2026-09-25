// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import CertificateNotice, { isCertificateKind } from "../components/CertificateNotice";
import EngineSetup from "../components/EngineSetup";
import Icon from "../components/Icons";
import JobRow, { JOB_TABLE_MIN_WIDTH, JobHeader } from "../components/JobRow";
import LinkRow from "../components/LinkRow";
import UpdateBanner from "../components/UpdateBanner";
import type { EngineState } from "../hooks/useBackend";
import { useElementWidth } from "../hooks/useElementWidth";
import { useT } from "../i18n";
import { readClipboard } from "../services/clipboard";
import {
  SETUP_REQUIRED,
  clearFinished,
  errorMessage,
  parseLink,
  removeJob,
  startDownload,
  type Job,
} from "../services/downloader";
import { chooseFolder, getSaveDir, openSaveDir, type Settings } from "../services/settings";
import type { UpdateState } from "../hooks/useUpdate";
import { analyzeEntry, createEntry, patchEntryFields, type Entry, type Parsed } from "./linkEntries";

interface DownloadsViewProps {
  jobs: Job[];
  engine: EngineState;
  settings: Settings | null;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onOpenSettings: () => void;
  /** Plays a file in the player. */
  onPlayFile: (path: string, title?: string) => void;
  /** The search for a newer version of CleanGrab: shown as a banner while there is one. */
  news?: UpdateState;
}

/** From this width the links and the downloads sit side by side. */
const WIDE_LAYOUT_MIN_WIDTH = 1080;

/**
 * The links being typed, kept when another page is shown: the page is built again each time it
 * is opened, and links pasted and not yet saved must still be there when the person comes back.
 */
let draftEntries: Entry[] | null = null;

export default function DownloadsView({
  jobs,
  engine,
  settings,
  onSettingsChange,
  onOpenSettings,
  onPlayFile,
  news,
}: DownloadsViewProps) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[]>(() => draftEntries ?? [createEntry()]);
  useEffect(() => {
    draftEntries = entries;
  }, [entries]);
  const [parsed, setParsed] = useState<Record<string, Parsed>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The download whose certificate notice was closed.
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);

  // Layout follows the space actually available, not just the window: two
  // columns when there is room for them, and a folded job table in a narrow card.
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const [jobsRef, jobsWidth] = useElementWidth<HTMLElement>();
  const wide = rootWidth >= WIDE_LAYOUT_MIN_WIDTH;
  const compactJobs = jobsWidth > 0 && jobsWidth < JOB_TABLE_MIN_WIDTH;

  const ready = engine.status?.ready ?? false;
  const hasFinished = jobs.some((job) => job.status !== "running");

  // The latest finished download, if it failed on a certificate check: explained on screen.
  const newestFinished = jobs.find((job) => job.status !== "running");
  const certificateKind =
    newestFinished?.status === "error" && isCertificateKind(newestFinished.errorKind) ? newestFinished.errorKind : null;

  useEffect(() => {
    getSaveDir().then(setSaveDir).catch(() => {});
  }, [settings?.saveDir]);

  // yt-dlp's version costs a process launch: read it when the details are opened.
  const refreshEngine = engine.refresh;
  useEffect(() => {
    if (detailsOpen) refreshEngine(true);
  }, [detailsOpen, refreshEngine]);

  // Ask the backend what each typed link is, shortly after typing stops.
  const urlsKey = entries.map((entry) => `${entry.id}\t${entry.url.trim()}`).join("\n");
  useEffect(() => {
    const targets = entries.filter((entry) => entry.url.trim());
    if (targets.length === 0) {
      setParsed({});
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      Promise.all(
        targets.map(async (entry) => {
          const text = entry.url.trim();
          const link = await parseLink(text).catch(() => null);
          return [entry.id, { text, link }] as const;
        }),
      ).then((results) => {
        if (!stale) setParsed(Object.fromEntries(results));
      });
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [urlsKey]);

  const rows = entries.map((entry) => analyzeEntry(entry, parsed[entry.id]));
  const readyCount = rows.filter((row) => row.ready).length;
  // A row with a bad trim range holds everything back until it is fixed.
  const blocked = rows.some((row) => !row.empty && row.trimProblem !== null);
  const canDownload = ready && !busy && readyCount > 0 && !blocked;


  const patchEntry = (id: string, patch: Partial<Entry>) =>
    setEntries((current) => current.map((entry) => (entry.id === id ? patchEntryFields(entry, patch) : entry)));

  // With several rows, remove one. With a single row, just empty it.
  const removeEntry = (id: string) =>
    setEntries((current) =>
      current.length > 1
        ? current.filter((entry) => entry.id !== id)
        : current.map((entry) =>
            entry.id === id ? { ...entry, url: "", quality: "best", trimOn: false, start: "", end: "" } : entry,
          ),
    );

  const addEntry = () => {
    const entry = createEntry(entries[entries.length - 1]?.format ?? "mp3");
    setEntries((current) => [...current, entry]);
    setFocusId(entry.id);
  };

  // Puts several links on separate rows: the first goes in `targetId` (or the
  // first empty row, or a new one), the rest follow right after it.
  const insertLinks = (lines: string[], targetId: string | null) => {
    setEntries((current) => {
      const next = [...current];
      let at = targetId ? next.findIndex((entry) => entry.id === targetId) : next.findIndex((entry) => !entry.url.trim());
      if (at === -1) {
        next.push(createEntry(next[next.length - 1]?.format ?? "mp3"));
        at = next.length - 1;
      }
      next[at] = { ...next[at], url: lines[0] };
      const format = next[at].format;
      next.splice(at + 1, 0, ...lines.slice(1).map((url) => ({ ...createEntry(format), url })));
      return next;
    });
  };

  const submit = async () => {
    if (!canDownload) return;
    setBusy(true);
    setError(null);

    const started = new Set<string>();
    let firstError: string | null = null;
    for (let i = 0; i < entries.length; i++) {
      const row = rows[i];
      if (!row.ready || !row.link) continue;
      try {
        await startDownload(row.link.url, row.format, row.trim, row.quality);
        started.add(entries[i].id);
      } catch (e) {
        const message = errorMessage(e);
        firstError ??= message === SETUP_REQUIRED ? t("home.setupFirst") : message;
      }
    }

    setBusy(false);
    setError(firstError);
    // Keep only what did not start, so it can be fixed and retried.
    setEntries((current) => {
      const left = current.filter((entry) => !started.has(entry.id) && entry.url.trim());
      return left.length > 0 ? left : [createEntry(current[current.length - 1]?.format ?? "mp3")];
    });
  };

  const retry = async (job: Job) => {
    try {
      await startDownload(job.url, job.format, job.trim, job.quality);
      await removeJob(job.id);
    } catch (e) {
      const message = errorMessage(e);
      setError(message === SETUP_REQUIRED ? t("home.setupFirst") : message);
    }
  };

  const paste = async () => {
    try {
      const lines = (await readClipboard())
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length > 0) insertLinks(lines, null);
    } catch {
      setError(t("home.pasteFailed"));
    }
  };

  const choose = async () => {
    const folder = await chooseFolder().catch(() => null);
    if (folder) onSettingsChange({ saveDir: folder });
  };

  return (
    <div ref={rootRef} className="thin-scroll h-full overflow-y-auto">
      <div className={`mx-auto space-y-4 px-6 pb-[calc(2rem+var(--dock,0px))] pt-6 ${wide ? "max-w-[1320px]" : "max-w-[760px]"}`}>
        <header className="flex min-h-8 animate-fade-up items-center justify-between gap-3">
          <h1 className="text-title font-bold text-ink">{t("home.title")}</h1>
          {settings?.allowUntrustedCertificates && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 text-caption font-bold text-danger transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
              title={t("home.certsUncheckedHint")}
            >
              <Icon name="alert" className="h-3.5 w-3.5" />
              {t("home.certsUnchecked")}
            </button>
          )}
        </header>

        <div className={`grid gap-4 ${wide ? "grid-cols-2 items-start" : "grid-cols-1"}`}>
          <div className="min-w-0 space-y-4">
            {news?.banner && <UpdateBanner news={news} />}
            <EngineSetup engine={engine} />

            <section className="card animate-fade-up p-5" style={{ animationDelay: "60ms" }} aria-labelledby="links-label">
              <div className="flex items-center justify-between">
                <h2 id="links-label" className="label">
                  {t("home.links")}
                </h2>
                <button type="button" className="btn btn-secondary" disabled={!ready} onClick={paste}>
                  <Icon name="paste" />
                  {t("home.paste")}
                </button>
              </div>

              <ul className="mt-3 divide-y divide-line/10">
                {entries.map((entry, index) => (
                  <LinkRow
                    key={entry.id}
                    entry={entry}
                    state={rows[index]}
                    number={index + 1}
                    disabled={!ready}
                    autoFocus={entry.id === focusId}
                    removable={entries.length > 1}
                    onChange={(patch) => patchEntry(entry.id, patch)}
                    onRemove={() => removeEntry(entry.id)}
                    onPasteMany={(lines) => insertLinks(lines, entry.url.trim() ? null : entry.id)}
                    onEnter={() => void submit()}
                  />
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line/10 pt-3">
                <button type="button" className="btn btn-ghost -ms-2" disabled={!ready} onClick={addEntry}>
                  <Icon name="plus" />
                  {t("home.addLink")}
                </button>
                {entries.length === 1 && rows[0].empty && (
                  <p className="text-caption text-ink-2">{t("home.copyHint")}</p>
                )}
              </div>
            </section>

            <section
              className="card flex animate-fade-up flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
              style={{ animationDelay: "120ms" }}
              aria-label="Save location"
            >
              <div className="min-w-[12rem] flex-1">
                <span className="label">{t("home.saveTo")}</span>
                <p className="mt-1 break-all text-body text-ink-2">{saveDir}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn btn-secondary" onClick={choose}>
                  {t("home.change")}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void openSaveDir().catch(() => {})}>
                  {t("home.open")}
                </button>
              </div>
            </section>

            {/* The entrance is on a wrapper: an animation on the button itself would override its hover lift. */}
            <div className="animate-fade-up" style={{ animationDelay: "180ms" }}>
              <button type="button" className="btn-cta" disabled={!canDownload} onClick={() => void submit()}>
                <Icon name="download" className="h-[18px] w-[18px]" />
                {readyCount > 1 ? t("home.downloadMany", { n: readyCount }) : t("home.download")}
              </button>
            </div>

            {error && (
              <p role="alert" className="text-body text-danger">
                {error}
              </p>
            )}
          </div>

          <div className={`min-w-0 space-y-4 ${wide ? "sticky top-6" : ""}`}>
            {certificateKind && newestFinished && dismissedNotice !== newestFinished.id && (
              <CertificateNotice
                kind={certificateKind}
                message={newestFinished.error}
                allowed={settings?.allowUntrustedCertificates ?? false}
                onOpenSettings={onOpenSettings}
                onDismiss={() => setDismissedNotice(newestFinished.id)}
              />
            )}

            <section
              ref={jobsRef}
              className="card animate-fade-up overflow-hidden"
              style={{ animationDelay: "100ms" }}
              aria-label="Downloads"
            >
              <JobHeader compact={compactJobs} onClear={hasFinished ? () => void clearFinished().catch(() => {}) : undefined} />
              {jobs.length === 0 ? (
                <div className="flex animate-fade-in flex-col items-center px-6 py-12 text-center">
                  <span className="flex h-10 w-10 animate-float items-center justify-center rounded-full bg-elevated text-ink-2">
                    <Icon name="download" className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-body font-semibold text-ink">{t("home.emptyTitle")}</p>
                  <p className="mt-1 max-w-xs text-body text-ink-2">
                    {t("home.emptyBody")}
                  </p>
                </div>
              ) : (
                <ul className={wide ? "thin-scroll max-h-[calc(100vh-18rem)] overflow-y-auto" : undefined}>
                  {jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      compact={compactJobs}
                      onRetry={retry}
                      onPlay={(played) => played.path && onPlayFile(played.path, played.title ?? undefined)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <div>
              <button
                type="button"
                aria-expanded={detailsOpen}
                aria-controls="details"
                onClick={() => setDetailsOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-md px-1 py-1 text-body text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60"
              >
                <Icon name="chevron" className={`h-4 w-4 transition-transform duration-200 ${detailsOpen ? "" : "-rotate-90 rtl:rotate-90"}`} />
                {detailsOpen ? t("home.hideDetails") : t("home.showDetails")}
              </button>
              <div
                id="details"
                aria-hidden={!detailsOpen}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                  detailsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-1 text-caption text-ink-2">
                    <dt>yt-dlp</dt>
                    <dd>
                      {engine.status?.ytDlpVersion
                        ? t("home.version", { v: engine.status.ytDlpVersion })
                        : engine.status?.ytDlpInstalled
                          ? t("home.installed")
                          : t("home.notInstalled")}
                    </dd>
                    <dt>FFmpeg</dt>
                    <dd>{engine.status?.ffmpegInstalled ? t("home.installed") : t("home.notInstalled")}</dd>
                    <dt>{t("home.processing")}</dt>
                    <dd>{t("home.processingValue")}</dd>
                    <dt>{t("home.security")}</dt>
                    <dd>
                      {settings?.allowUntrustedCertificates
                        ? t("home.certsOff")
                        : t("home.certsOn")}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
