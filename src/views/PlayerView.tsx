// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import Icon from "../components/Icons";
import ProgressBar from "../components/ProgressBar";
import type { PlayRequest, PlayerSession } from "../hooks/usePlayerSession";
import { useT } from "../i18n";

interface PlayerViewProps {
  /** The file to play, or `null` for the page that offers to open one. */
  request: PlayRequest | null;
  /** How far the file is on its way to being played. */
  session: PlayerSession;
  /** Opens the file picker. */
  onOpenFile: () => void;
  /** Lets go of the file and shows the empty page again. */
  onClose: () => void;
  /** Given the box the player goes over, once the file is ready (the player itself lives above the pages). */
  onSlot: (element: HTMLElement | null) => void;
}

/** The name of a file, from its path. */
const fileName = (path: string) => path.split(/[\/]/).pop() || path;

/** The player page. Empty, it offers to open a file; otherwise it shows the one asked for. */
export default function PlayerView({ request, session, onOpenFile, onClose, onSlot }: PlayerViewProps) {
  return request ? (
    <PlayerPage request={request} session={session} onOpenFile={onOpenFile} onClose={onClose} onSlot={onSlot} />
  ) : (
    <EmptyPlayer onOpenFile={onOpenFile} />
  );
}

/** Nothing is playing: a page with one clear thing to do. */
function EmptyPlayer({ onOpenFile }: { onOpenFile: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col gap-4 px-6 pb-6 pt-6">
      <header className="flex min-h-8 animate-fade-up items-center">
        <h1 className="text-title font-bold text-ink">{t("player.title")}</h1>
      </header>
      <section
        className="card flex min-h-0 flex-1 animate-fade-up flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center"
        style={{ animationDelay: "60ms" }}
        aria-label={t("player.openBig")}
      >
        <span className="flex h-24 w-24 animate-float items-center justify-center rounded-full border-[7px] border-accent-fill text-accent">
          <Icon name="play" className="ml-1 h-8 w-8" />
        </span>
        <h2 className="mt-5 text-headline font-bold text-ink">{t("player.emptyTitle")}</h2>
        <p className="mt-1 max-w-sm text-body text-ink-2">{t("player.emptyBody")}</p>
        <button type="button" className="btn btn-primary mt-5" onClick={onOpenFile}>
          <Icon name="folder" />
          {t("player.openBig")}
        </button>
      </section>
    </div>
  );
}

/** A file was asked for: the page says how it is coming along, and keeps room for the player once it is ready. */
function PlayerPage({ request, session, onOpenFile, onClose, onSlot }: Omit<PlayerViewProps, "request"> & { request: PlayRequest }) {
  const t = useT();
  // A file that is ready at once should not flash a "preparing" card.
  const [showPreparing, setShowPreparing] = useState(false);
  useEffect(() => {
    setShowPreparing(false);
    const reveal = setTimeout(() => setShowPreparing(true), 300);
    return () => clearTimeout(reveal);
  }, [request]);

  const title = request.title ?? (session.phase === "ready" ? session.media.title : fileName(request.path));

  return (
    <div className="flex h-full flex-col gap-4 px-6 pb-6 pt-6">
      <header className="flex min-h-8 shrink-0 animate-fade-up items-center gap-3">
        <h1 className="shrink-0 text-title font-bold text-ink">{t("player.title")}</h1>
        <p dir="auto" className="min-w-0 flex-1 truncate text-body text-ink-2" title={title}>
          {title}
        </p>
        <button type="button" className="btn btn-secondary shrink-0" onClick={onOpenFile}>
          <Icon name="folder" />
          {t("player.openFile")}
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {session.phase === "preparing" && showPreparing && (
          <section className="card animate-fade-up p-5" aria-live="polite">
            <h2 className="text-headline font-bold text-ink">{t("player.preparingTitle")}</h2>
            <p className="mt-1 text-body text-ink-2">{t("player.preparingBody")}</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <ProgressBar percent={session.percent} label={t("player.preparingLabel")} />
              </div>
              <span className="w-9 text-end text-caption tabular-nums text-ink-2">
                {session.percent === null ? "" : `${Math.round(session.percent)}%`}
              </span>
              <button type="button" className="btn btn-ghost h-7 px-2" onClick={onClose}>
                {t("common.cancel")}
              </button>
            </div>
          </section>
        )}

        {session.phase === "failed" && (
          <section role="alert" className="card animate-fade-up border-danger/30 bg-danger/[0.06] p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
                <Icon name="alert" className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-headline font-bold text-ink">{t("player.failedTitle")}</h2>
                <p className="mt-1 text-body text-ink-2">{session.message}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn btn-primary" onClick={onOpenFile}>
                    {t("player.chooseAnother")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={onClose}>
                    {t("common.close")}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {session.phase === "ready" && (
          <div className="flex h-full flex-col gap-2">
            {/* The player itself is drawn above the pages, over this box. */}
            <div ref={onSlot} className="min-h-0 flex-1" />
            {session.media.converted && <p className="shrink-0 px-1 text-caption text-ink-3">{t("player.converted")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
