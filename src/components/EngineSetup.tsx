// SPDX-License-Identifier: GPL-3.0-only
import type { EngineState } from "../hooks/useBackend";
import { useT } from "../i18n";
import CertificateNotice, { headline, isCertificateKind } from "./CertificateNotice";
import ProgressBar from "./ProgressBar";

/** One-time download of yt-dlp and FFmpeg. Renders nothing once they are installed. */
export default function EngineSetup({ engine }: { engine: EngineState }) {
  const t = useT();
  const { status, installing, progress, error, errorKind, install } = engine;
  if (!status || status.ready) return null;

  const percent = progress?.percent ?? 0;
  const certificateKind = isCertificateKind(errorKind) ? errorKind : null;

  return (
    <section className="card animate-fade-up p-4" aria-labelledby="setup-title">
      <h2 id="setup-title" className="text-headline font-bold text-ink">
        {t("setup.title")}
      </h2>
      <p className="mt-1 max-w-prose text-body text-ink-2">{t("setup.body")}</p>

      {installing ? (
        <div className="mt-4">
          <ProgressBar percent={percent} label={t("setup.progressLabel")} />
          <p className="mt-2 text-caption text-ink-3" aria-live="polite">
            {t("setup.progress", { tool: progress?.stage === "FFmpeg" ? "FFmpeg" : "yt-dlp", n: Math.round(percent) })}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" className="btn btn-primary" onClick={install}>
              {error ? t("setup.retry") : t("setup.download")}
            </button>
            {error && !certificateKind && (
              <p role="alert" className="animate-shake text-caption text-danger">
                {headline(error)}
              </p>
            )}
          </div>
          {error && certificateKind && (
            <div className="mt-4">
              <CertificateNotice kind={certificateKind} message={error} scope="setup" />
            </div>
          )}
        </>
      )}
    </section>
  );
}
