// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useLayoutEffect, useState } from "react";
import type { PlayRequest, PlayerSession } from "../hooks/usePlayerSession";
import MediaPlayer, { miniDock, type Box } from "./MediaPlayer";

/** Where an element is in the window, kept up to date while it changes size or the window does. */
function useBox(element: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    if (!element) {
      setBox(null);
      return;
    }
    const measure = () => {
      const { left, top, width, height } = element.getBoundingClientRect();
      setBox((current) =>
        current && current.left === left && current.top === top && current.width === width && current.height === height
          ? current
          : { left, top, width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);

  return box;
}

interface PlayerHostProps {
  request: PlayRequest | null;
  session: PlayerSession;
  /** Whether the Player page is the one showing. */
  onPlayerPage: boolean;
  /** The room the Player page keeps for the player, when it has one. */
  slot: HTMLElement | null;
  onExpand: () => void;
  onClose: () => void;
  /** Told how much room the small player takes at the bottom of the window (0 when it is not there). */
  onDock: (pixels: number) => void;
}

/**
 * Keeps the player alive above the pages. On the Player page it fills the room the page keeps for it;
 * on any other page it shrinks to a small player in the corner, so the music or the video carries on.
 */
export default function PlayerHost({ request, session, onPlayerPage, slot, onExpand, onClose, onDock }: PlayerHostProps) {
  const box = useBox(slot);
  const media = request && session.phase === "ready" ? session.media : null;

  // A player that is put down straight onto the Player page is not shown until that page has said where it goes.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (media) setShown(true);
    else setShown(false);
  }, [media]);

  const mode = onPlayerPage ? (box ? "full" : shown ? "mini" : "pending") : "mini";
  const dock = media && mode === "mini" ? miniDock(media.kind) : 0;
  useEffect(() => {
    onDock(dock);
  }, [dock, onDock]);

  if (!media || !request) return null;

  return (
    <MediaPlayer
      key={media.path}
      media={media}
      title={request.title ?? media.title}
      mode={mode}
      slot={box}
      // Ready while another page is showing: it waits for Play rather than making sound out of nowhere.
      autoPlay={onPlayerPage}
      onExpand={onExpand}
      onClose={onClose}
    />
  );
}
