// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import { errorMessage } from "../services/downloader";
import { cancelPlayback, onPlaybackProgress, preparePlayback, type PlayableMedia } from "../services/player";

/** What to play. `nonce` makes choosing the same file again start over. */
export interface PlayRequest {
  path: string;
  /** A better name than the file's, when there is one (a download's title). */
  title?: string;
  nonce: number;
}

/** Where a file is on its way to being played. */
export type PlayerSession =
  | { phase: "idle" }
  | { phase: "preparing"; percent: number | null }
  | { phase: "ready"; media: PlayableMedia }
  | { phase: "failed"; message: string };

/**
 * Gets the requested file ready (converting it first if its format needs it). It lives above the pages,
 * so a conversion, and then the playback, carry on while the person moves between pages.
 */
export function usePlayerSession(request: PlayRequest | null): PlayerSession {
  const [session, setSession] = useState<PlayerSession>({ phase: "idle" });

  useEffect(() => {
    if (!request) {
      setSession({ phase: "idle" });
      // Closing the player must not leave a conversion running.
      void cancelPlayback().catch(() => {});
      return;
    }
    let cancelled = false;
    setSession({ phase: "preparing", percent: null });

    const stopListening = onPlaybackProgress(({ path, percent }) => {
      if (!cancelled && path === request.path) setSession((current) => (current.phase === "preparing" ? { phase: "preparing", percent } : current));
    });
    preparePlayback(request.path)
      .then((media) => !cancelled && setSession({ phase: "ready", media }))
      .catch((error) => !cancelled && setSession({ phase: "failed", message: errorMessage(error) }));

    return () => {
      cancelled = true;
      stopListening();
      // Choosing another file needs no cancel of its own: the backend stops the old conversion
      // when the new one starts. (A cancel sent here could arrive after that start and kill it.)
    };
  }, [request]);

  return session;
}
