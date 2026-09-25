// SPDX-License-Identifier: GPL-3.0-only
import { useState, type ReactNode } from "react";
import CertificateNotice, { headline, isCertificateKind } from "../components/CertificateNotice";
import Icon, { Mark } from "../components/Icons";
import ProgressBar from "../components/ProgressBar";
import type { EngineState } from "../hooks/useBackend";
import { useT, type TKey } from "../i18n";

const EXIT_MS = 250;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const FACTS: TKey[] = ["tools.fact.source", "tools.fact.checked", "tools.fact.local"];

interface ToolsSetupProps {
  engine: EngineState;
  /** Leaves this page, with the tools installed or not. */
  onDone: () => void;
}

function ToolRow({ icon, name, purpose, installed, installedLabel }: { icon: "download" | "scissors"; name: string; purpose: string; installed: boolean; installedLabel: string }) {
  return (
    <li className="flex items-start gap-3.5 px-4 py-3.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-body font-bold text-ink">{name}</h2>
        <p className="mt-0.5 text-body text-ink-2">{purpose}</p>
      </div>
      {installed && (
        <span role="img" aria-label={installedLabel} title={installedLabel} className="mt-1 flex h-5 w-5 shrink-0 animate-pop items-center justify-center rounded-full bg-accent-fill text-accent-on">
          <Icon name="check" className="h-3 w-3" />
        </span>
      )}
    </li>
  );
}

/**
 * First launch, after the Terms: what yt-dlp and FFmpeg are, why CleanGrab needs them, where they
 * come from and how they are checked, with the one-time download right here. It can be left for
 * later (the Home page then asks), and a download that is running carries on in the background.
 */
export default function ToolsSetup({ engine, onDone }: ToolsSetupProps) {
  const t = useT();
  const { status, installing, progress, error, errorKind, install } = engine;
  const [leaving, setLeaving] = useState(false);
  const ready = status?.ready ?? false;
  const percent = progress?.percent ?? 0;
  const certificateKind = isCertificateKind(errorKind) ? errorKind : null;

  const leave = async () => {
    setLeaving(true);
    await sleep(EXIT_MS);
    onDone();
  };

  // The line at the bottom left says what is going on: the size, the progress, a problem, or that all is well.
  let summary: ReactNode;
  if (installing) {
    summary = (
      <div className="w-full">
        <ProgressBar percent={percent} label={t("setup.progressLabel")} />
        <p className="mt-1.5 text-caption text-ink-3" aria-live="polite">
          {t("setup.progress", { tool: progress?.stage === "FFmpeg" ? "FFmpeg" : "yt-dlp", n: Math.round(percent) })}
        </p>
      </div>
    );
  } else if (ready) {
    summary = (
      <p className="flex items-center gap-1.5 text-caption text-ink-2" aria-live="polite">
        <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-accent" />
        {t("tools.ready")}
      </p>
    );
  } else if (error && !certificateKind) {
    summary = (
      <p role="alert" className="animate-shake text-caption text-danger">
        {headline(error)}
      </p>
    );
  } else {
    summary = <p className="text-caption text-ink-3">{t("tools.hint")}</p>;
  }

  return (
    <div
      className={`flex h-full flex-col transition-all duration-[250ms] ease-out ${
        leaving ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[460px] flex-col items-center px-6 pb-6 pt-8">
          <div className="animate-settle">
            <Mark className="h-14 w-14" />
          </div>
          <h1 className="mt-4 animate-fade-up text-center text-display font-bold tracking-tight text-ink" style={{ animationDelay: "80ms" }}>
            {t("tools.title")}
          </h1>
          <p className="mt-2 animate-fade-up text-center text-body text-ink-2" style={{ animationDelay: "140ms" }}>
            {t("tools.lead")}
          </p>

          <ul className="card mt-6 w-full animate-fade-up divide-y divide-line/10" style={{ animationDelay: "200ms" }}>
            <ToolRow icon="download" name="yt-dlp" purpose={t("tools.ytdlp.purpose")} installed={status?.ytDlpInstalled ?? false} installedLabel={t("tools.installed")} />
            <ToolRow icon="scissors" name="FFmpeg" purpose={t("tools.ffmpeg.purpose")} installed={status?.ffmpegInstalled ?? false} installedLabel={t("tools.installed")} />
          </ul>

          <ul className="mt-5 w-full animate-fade-up space-y-2" style={{ animationDelay: "280ms" }}>
            {FACTS.map((fact) => (
              <li key={fact} className="flex items-start gap-2.5 text-body text-ink-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>{t(fact)}</span>
              </li>
            ))}
          </ul>

          {error && certificateKind && !installing && (
            <div className="mt-5 w-full">
              <CertificateNotice kind={certificateKind} message={error} scope="setup" />
            </div>
          )}
        </div>
      </main>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/10 bg-surface/60 px-6 py-3">
        <div className="min-w-[12rem] flex-1">{summary}</div>
        {ready ? (
          <button type="button" className="btn btn-primary px-4" disabled={leaving} onClick={() => void leave()}>
            {t("tools.start")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" disabled={leaving} onClick={() => void leave()}>
              {installing ? t("tools.background") : t("tools.later")}
            </button>
            {!installing && (
              <button type="button" className="btn btn-primary px-4" disabled={leaving} onClick={install}>
                {error ? t("setup.retry") : t("setup.download")}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
